"""After each firmware build, write a single merged flash image and a manifest to
web/public/firmware/ so the website can flash the board over WebSerial (esptool-js)."""
import json
import os
import subprocess

Import("env")  # noqa: F821 (provided by PlatformIO)

OUT_DIR = os.path.join(env.subst("$PROJECT_DIR"), "..", "web", "public", "firmware")  # noqa: F821
IMAGE = "camera-esp.bin"
IMAGE_SOURCES = ["src", "platformio.ini"]


def git_version(project_dir):
    """Last commit touching what goes into the image (src/, platformio.ini), "-dirty" if those
    have uncommitted edits. Tools, scripts and the exported files don't change the version."""
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=project_dir, text=True).strip()
    try:
        version = git("log", "-1", "--format=%h", "--", *IMAGE_SOURCES) or "uncommitted"
        return version + ("-dirty" if git("status", "--porcelain", "--", *IMAGE_SOURCES) else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def export(source, target, env):
    build_dir = env.subst("$BUILD_DIR")
    esptool = os.path.join(env.PioPlatform().get_package_dir("tool-esptoolpy"), "esptool.py")
    # Same images and offsets `pio run -t upload` flashes: bootloader, partitions, boot_app0, app.
    images = [(offset, env.subst(path)) for offset, path in env.get("FLASH_EXTRA_IMAGES", [])]
    images.append((env.subst("$ESP32_APP_OFFSET"), os.path.join(build_dir, "firmware.bin")))

    os.makedirs(OUT_DIR, exist_ok=True)
    cmd = [env.subst("$PYTHONEXE"), esptool, "--chip", env.BoardConfig().get("build.mcu"),
           "merge_bin", "-o", os.path.join(OUT_DIR, IMAGE),
           "--flash_mode", "keep", "--flash_freq", "keep", "--flash_size", "keep"]
    for offset, path in images:
        cmd += [offset, path]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)

    # No build timestamp: identical sources give an identical export (and a clean git tree).
    manifest = {
        "name": "camera-esp",
        "version": git_version(env.subst("$PROJECT_DIR")),
        "chip": "ESP32-S3",
        "board": env.subst("$BOARD"),
        "image": IMAGE,
        "offset": 0,  # merged image: flash the whole file at 0x0
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"Exported {IMAGE} ({manifest['version']}) to web/public/firmware/")


def export_if_built(source, target, env):
    if os.path.exists(os.path.join(env.subst("$BUILD_DIR"), "firmware.bin")):
        export(source, target, env)


# Export when the app binary is (re)built, and also on up-to-date builds (the size check always
# runs, but on a clean build it runs before firmware.bin exists), so the export never goes stale.
env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", export)  # noqa: F821
env.AddPostAction("checkprogsize", export_if_built)  # noqa: F821

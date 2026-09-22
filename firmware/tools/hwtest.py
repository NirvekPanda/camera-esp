"""Hardware check for the flashed camera firmware over USB, independent of the browser.

    make hwtest [PORT=/dev/cu.usbmodemXXXX]

Speaks the protocol in docs/plan.md: syncs the clock, streams at every resolution (checking real
JPEG sizes and measuring fps and throughput), toggles mirror, then captures, lists and downloads a
photo if an SD card is present. Exits non-zero on any failure.
"""
import json
import struct
import sys
import time

import serial
from serial.tools import list_ports

MAGIC = b"\xa5\x5a"
FRAME, CAPTURED, FILE_LIST, FILE_DATA, OK, PIXELS, ERROR = 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x7F
SET_TIME, CAPTURE, LIST, GET_FILE, STREAM, MIRROR, RESOLUTION, FPS, VFLIP, PHOTO_PIXELS, DELETE_FILE = range(0x81, 0x8C)
USB_VENDOR_IDS = {0x303A, 0x2886}  # Espressif USB Serial/JTAG, Seeed

# (requested, expected sensor frame): 480x480 and 720x720 arrive as VGA/HD for the site to crop.
RESOLUTIONS = [
    ((240, 240), (240, 240)), ((480, 480), (640, 480)), ((720, 720), (1280, 720)),
    ((320, 240), (320, 240)), ((640, 480), (640, 480)), ((800, 600), (800, 600)),
    ((1280, 720), (1280, 720)), ((1600, 1200), (1600, 1200)), ((1920, 1080), (1920, 1080)),
]


class DeviceError(Exception):
    pass


class Camera:
    def __init__(self, port):
        self.serial = serial.Serial(port, 115200, timeout=0.1)
        self.buffer = b""

    def packet(self, timeout=5.0):
        deadline = time.monotonic() + timeout
        while True:
            start = self.buffer.find(MAGIC)
            if start < 0:
                self.buffer = self.buffer[-1:]  # keep a trailing A5
            elif len(self.buffer) >= start + 7:
                kind, length = struct.unpack_from("<BI", self.buffer, start + 2)
                end = start + 7 + length
                if len(self.buffer) >= end:
                    payload = self.buffer[start + 7:end]
                    self.buffer = self.buffer[end:]
                    return kind, payload
            if time.monotonic() > deadline:
                raise TimeoutError("no reply from the camera (is the firmware flashed?)")
            self.buffer += self.serial.read(max(1, self.serial.in_waiting))

    def request(self, kind, payload=b"", expect=OK, timeout=5.0):
        self.serial.write(MAGIC + struct.pack("<BI", kind, len(payload)) + payload)
        while True:
            reply, data = self.packet(timeout)
            if reply == FRAME:
                continue  # frames interleave with replies while streaming
            if reply == ERROR and expect != ERROR:
                raise DeviceError(data.decode(errors="replace"))
            if reply != expect:
                raise AssertionError(f"expected reply 0x{expect:02x}, got 0x{reply:02x}")
            return data

    def frames(self, seconds):
        sizes, dims = [], set()
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            kind, data = self.packet()
            if kind == FRAME:
                if not (data.startswith(b"\xff\xd8") and data.rstrip(b"\x00").endswith(b"\xff\xd9")):
                    raise AssertionError("frame is not a complete JPEG")
                sizes.append(len(data))
                dims.add(jpeg_size(data))
        return sizes, dims


def jpeg_size(data):
    """(width, height) from the JPEG's SOF marker."""
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack_from(">HH", data, i + 5)
            return width, height
        i += 2 + struct.unpack_from(">H", data, i + 2)[0]
    raise AssertionError("JPEG has no SOF marker")


def find_port():
    ports = [p.device for p in list_ports.comports() if p.vid in USB_VENDOR_IDS]
    if not ports:
        sys.exit("No XIAO ESP32-S3 found. Plug it in or pass PORT=...")
    return ports[0]


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else find_port()
    print(f"Camera on {port}")
    try:
        cam = Camera(port)
    except serial.SerialException as e:
        sys.exit(f"Can't open {port}: {e.strerror or e}. If the site is connected, click Disconnect first.")
    failures = 0

    def check(name, fn):
        nonlocal failures
        try:
            result = fn()
            print(f"  ok    {name}{f': {result}' if result else ''}")
        except DeviceError as e:
            print(f"  skip  {name}: {e}")
        except (AssertionError, TimeoutError) as e:
            failures += 1
            print(f"  FAIL  {name}: {e}")

    local_time = int(time.time()) + time.localtime().tm_gmtoff  # the site also sends local wall-clock time
    check("sync clock", lambda: cam.request(SET_TIME, struct.pack("<I", local_time)) and None)
    check("stream on", lambda: cam.request(STREAM, b"\x01") and None)
    check("30 fps target", lambda: cam.request(FPS, bytes([30])) and None)

    print("\n  resolution   frame        fps   KB/frame   KB/s")
    for (w, h), expected in RESOLUTIONS:
        def stream(w=w, h=h, expected=expected):
            cam.request(RESOLUTION, struct.pack("<HH", w, h))
            cam.frames(0.5)  # let the sensor settle on the new size
            sizes, dims = cam.frames(2.0)
            if not sizes:
                raise AssertionError("no frames")
            if expected not in dims:
                raise AssertionError(f"frames were {sorted(dims)}, expected {expected}")
            kb = sum(sizes) / 1024
            return f"{expected[0]}×{expected[1]}  {len(sizes) / 2:5.1f}  {kb / len(sizes):8.1f}  {kb / 2:6.0f}"
        check(f"{w}×{h}".ljust(11), stream)
    cam.request(RESOLUTION, struct.pack("<HH", 240, 240))
    print()

    check("mirror on/off", lambda: (cam.request(MIRROR, b"\x01"), cam.request(MIRROR, b"\x00")) and None)
    check("vertical flip on/off", lambda: (cam.request(VFLIP, b"\x01"), cam.request(VFLIP, b"\x00")) and None)

    def photos():
        photo = json.loads(cam.request(CAPTURE, expect=CAPTURED))
        names = [f["name"] for f in json.loads(cam.request(LIST, expect=FILE_LIST))]
        if not names or names[0] != photo["name"]:
            raise AssertionError(f"{photo['name']} isn't first in LIST (newest first): {names[:3]}")
        data = cam.request(GET_FILE, photo["name"].encode(), expect=FILE_DATA, timeout=30)
        if len(data) != photo["size"] or not data.startswith(b"\xff\xd8"):
            raise AssertionError("downloaded photo doesn't match")
        # Photos use the sensor's largest size whatever the stream is set to (240x240 here).
        size = jpeg_size(data)
        if size not in ((2048, 1536), (1600, 1200)):
            raise AssertionError(f"photo is {size[0]}x{size[1]}, not the sensor's full resolution")
        return f"{photo['name']} {size[0]}x{size[1]} ({photo['size'] // 1024} KB), {len(names)} on card"
    check("capture → list → download", photos)

    def decoded_on_device():
        # The device UI's Pictures page (thumbnails, viewer) decodes photos from the SD card itself.
        name = json.loads(cam.request(LIST, expect=FILE_LIST))[0]["name"]
        for w, h in ((64, 64), (240, 177)):
            data = cam.request(PHOTO_PIXELS, struct.pack("<HH", w, h) + name.encode(), expect=PIXELS, timeout=30)
            if struct.unpack_from("<HH", data) != (w, h) or len(data) != 4 + w * h * 2:
                raise AssertionError(f"{w}x{h}: got {len(data)} bytes")
            pixels = struct.unpack_from(f"<{w * h}H", data, 4)
            if len(set(pixels)) < 8:
                raise AssertionError(f"{w}x{h}: {len(set(pixels))} distinct colors, looks undecoded")
            # Photos are smooth; byte-swapped or garbled RGB565 is noise (measured: ~1 vs ~10+).
            green = [(p >> 5) & 63 for p in pixels]
            rough = sum(abs(green[i] - green[i + 1]) for i in range(len(green) - 1) if (i + 1) % w) / len(green)
            if rough > 3:
                raise AssertionError(f"{w}x{h}: pixels look scrambled (roughness {rough:.1f}, byte order?)")
        return f"{name} → 64×64 and 240×177 RGB565"
    check("SD photo decoded on the device", decoded_on_device)

    taken = []  # photos this test takes and then deletes, never the user's

    def preview_ready():
        # Capture saves a 240x180 preview next to the photo, so showing it skips the full decode.
        name = json.loads(cam.request(CAPTURE, expect=CAPTURED))["name"]
        taken.append(name)
        start = time.monotonic()
        cam.request(PHOTO_PIXELS, struct.pack("<HH", 64, 64) + name.encode(), expect=PIXELS, timeout=30)
        took = time.monotonic() - start
        if took > 1:  # measured ~0.3 s from the preview; a full decode takes 2-4 s
            raise AssertionError(f"{took:.2f} s: no ready-made preview?")
        return f"{name} in {took * 1000:.0f} ms"
    check("new photo shows from its preview", preview_ready)

    def delete():
        if not taken:
            raise AssertionError("no test photo to delete")
        name = taken[0]
        cam.request(DELETE_FILE, name.encode())
        if any(f["name"] == name for f in json.loads(cam.request(LIST, expect=FILE_LIST))):
            raise AssertionError(f"{name} is still listed")
        cam.request(GET_FILE, name.encode(), expect=ERROR)
        # Pixels come from the preview first: an error means the preview is gone too.
        cam.request(PHOTO_PIXELS, struct.pack("<HH", 64, 64) + name.encode(), expect=ERROR)
        cam.request(DELETE_FILE, name.encode(), expect=ERROR)
        for bad in (b"", b"previews", b"../x.jpg", b"previews\\x.jpg"):  # never a folder or a path
            cam.request(DELETE_FILE, bad, expect=ERROR)
        return f"{name}: photo and preview"
    check("delete", delete)
    check("stream off", lambda: cam.request(STREAM, b"\x00") and None)

    print("\nAll checks passed." if not failures else f"\n{failures} check(s) failed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()

# ESP32-S3 Camera: Project Plan

## 1. Major elements

| Element | What it is | Lives in |
|---|---|---|
| **Camera device** | Xiao ESP32-S3 + Sense camera (OV2640/OV3660), microSD, SPI 240×240 display, 5-way switch, MPU-6050, battery | hardware |
| **Firmware** | Arduino/ESP-IDF sketch: captures frames, streams them over USB, saves JPEGs to SD, serves file list/downloads, later drives the SPI display and buttons | `firmware/` (PlatformIO, Arduino) |
| **Transport** | How the site talks to the device. **Phase 1: USB serial (WebSerial).** Phase 2: WiFi (feature, added later) | `web/src/lib/camera/` + firmware |
| **Device UI** | Wii-inspired UI for the camera's own 240×240 display (Camera / Pictures / Settings), portable C++ with an ST7789 driver. Also compiled to WASM for the site's Device tab. Design and research: [`docs/wii-theme.md`](wii-theme.md) | `firmware/lib/ui/` |
| **Website** | Static Next.js app. **Camera** tab: live preview, take-picture button, file browser + image modal. **Device** tab: the device UI emulated on a virtual ST7789. Also serves the firmware image for WebSerial flashing | `web/` |
| **Deployment** | Static export → nginx on Proxmox host (**port 8888**) → Cloudflare Tunnel → `camera.nirvek.xyz` | `start.sh`, `deploy/nginx.conf`, `Makefile`, `cloudflare-domain-setup.md` |
| **Pipeline** | Feature branches, unit + integration tests, pre-push hook, CI, code review before PR | `CLAUDE.md`, `.githooks/`, `.github/workflows/` |

### Ports

- **8888**: the camera site. `npm run dev` serves on it locally. In production, nginx listens on
  8888 and the Cloudflare tunnel's public hostname `camera.nirvek.xyz` points at
  `http://<host>:8888`.
- **3100**: integration tests serve the static build (`out/`) here, so tests check exactly what
  gets deployed and never collide with a running `npm run dev` (Next 16 allows one dev server per
  project).

### Toolchain

- **Node 24.21.0** (latest LTS): pinned in `web/.nvmrc` and enforced by `engines` +
  `engine-strict` (`web/.npmrc`). CI and `start.sh` both read `.nvmrc`. Vitest 5 needs Node ≥ 22.
- Dependencies are on their latest stable versions, except **ESLint 9** and **TypeScript 6.0**:
  `eslint-config-next@16.3` doesn't support ESLint 10 yet, and its typescript-eslint requires
  TypeScript < 6.1. Bump these when `eslint-config-next` does.
- **PlatformIO** with `espressif32@7.1.3` (pinned). PlatformIO Core 6.2.0 needs
  `~/.platformio/penv/bin/python -m pip install intelhex` once for this platform.

### Commands (repo root)

| Command | Does |
|---|---|
| `make` / `make help` | list all targets (default goal) |
| `make flash` / `make upload` `[PORT=/dev/cu.usbmodemXXXX]` | build + flash firmware over USB (port auto-detected) |
| `make build` | build firmware only; also exports `web/public/firmware/` |
| `make hwtest [PORT=…]` | test the flashed camera over USB (no browser): frames, every resolution, mirror, SD photos |
| `make monitor` | serial monitor (raw protocol bytes while streaming) |
| `make web` = `./start.sh` | git pull, stop other copies on 8888, build, publish to nginx, health check |
| `make stop` = `./start.sh stop` | remove the site from nginx, free port 8888 |
| `make restart` = `./start.sh restart` | stop + start, without pulling |
| `make uitest` | device UI native tests: framebuffer, ST7789 driver/emulator, screens, golden frames |
| `make ui-preview` | print the real device UI frames in the terminal (`OUT=dir` also writes PPMs) |
| `make wasm` | build `web/public/wasm/device-ui.wasm` for the Device tab (needs `emcc`) |
| `make check` | `uitest`, then web lint, types, unit and integration tests |

`start.sh` works on both the Debian host (`/etc/nginx/sites-available`, `/var/www/camera`, sudo)
and macOS Homebrew nginx (`servers/camera.conf`, no sudo). It tests the nginx config before every
reload, so a bad config never takes down other sites. It re-runs itself if a pull changed
`start.sh`.

### Transport decisions

- **USB first.** WebSerial works from the HTTPS site (no mixed-content problem), needs no backend,
  and matches the "plugged in device" workflow. Chromium browsers only (Chrome/Edge/Arc).
- **WiFi later.** Adds `WifiSource` implementing the same `CameraSource` interface (section 3). The
  UI does not change. Mixed-content must be solved then (ESP on LAN is plain `http://`); options are
  opening the site from the ESP itself, or a relay through the Proxmox host.
- Serial port is shared between streaming and flashing (esptool-js). Only one at a time; the UI will
  need a "disconnect stream → flash → reconnect" flow.
- Firmware logging is off (`CORE_DEBUG_LEVEL=0`): log text on the USB port would corrupt the
  binary stream. Boot-ROM text before the first packet is fine; both parsers skip it.

### USB IDs

| VID:PID | When |
|---|---|
| **`303A:1001`** | Espressif built-in USB Serial/JTAG. The camera firmware runs on this (the board's default `ARDUINO_USB_MODE=1`, CDC on boot). Confirmed on the connected board. |
| `2886:0056` / `2886:8056` | Seeed XIAO ESP32-S3 IDs, seen with TinyUSB firmware or the UF2 bootloader |

The site's port picker (`USB_FILTERS` in `serial-source.ts`) and `make hwtest` accept both
vendors (`0x303A`, `0x2886`).

### Conventions

- **Filenames:** `YYYYMMDD-HHMMSS.jpg` (e.g. `20260921-142305.jpg`). FAT32 forbids `:`, and this
  format sorts chronologically and filters by date with a prefix check. Same-second duplicates get
  `_02`, `_03`, … (`20260921-142305_02.jpg`), zero-padded so `_10` sorts after `_09`. Sort with
  plain code-unit order (`newestFirst` in `lib/filename.ts`), not `localeCompare`: locale collation
  puts `_` before `.` and would list the original above its newer duplicates. Firmware must use the
  same naming.
- **Newest first** (`ui::newerPhoto` on the device, `newestFirst` on the site, which must agree):
  dated `YYYYMMDD-HHMMSS` names by time, then undated `IMG_0001.jpg` names (saved before the
  clock was set).
- **Time:** the ESP has no RTC. On connect the site sends `SET_TIME` with *local wall-clock* seconds
  (Unix time + the browser's UTC offset), and the firmware formats it as if it were UTC. That way
  photo names are in local time without timezone support on the device. Photos taken before a sync
  fall back to `IMG_0001.jpg` counters.
- **Photos on the device** are stored in `/photos/` on the SD card.
- **Reproducible firmware:** `-ffile-prefix-map=$PROJECT_DIR=.` keeps absolute paths out of the
  ELF, whose hash is stamped into the image. So the same sources give a byte-identical image in
  any checkout (verified with two different checkout paths).
- **Mirror & vertical flip:** both buttons are camera settings (`setMirror` → `set_hmirror`,
  `setVflip` → `set_vflip`), not CSS transforms, so saved photos match the preview. The site
  re-applies them after every reconnect. OV3660 modules are mounted upside down, so the firmware
  keeps a base `vflip` and the button toggles relative to it.
- **Resolution & frame rate:** picked in the dropdowns under the preview (`lib/camera/settings.ts`).
  - Resolutions: 240×240 (matches the SPI display), 480×480, 720×720, 320×240 (QVGA),
    640×480 (VGA), 800×600 (SVGA), 1280×720 (HD), 1600×1200 (UXGA, OV2640 max) and 1920×1080 (FHD,
    OV3660/OV5640 only). The ESP32 camera driver has no 480×480 or 720×720 frame size, so the
    firmware streams VGA and HD for those, and the site center-crops the preview (`coverCrop`).
    Photos aren't cropped: they're full-resolution sensor frames (see *Photos* below), so the
    framing can be applied when viewing.
  - Frame rates: 10, 15 (default), 24, 30 and 60 fps. This is a *target*. The UI shows the actual
    measured fps next to it, because USB caps high resolutions well below 60 fps (measured below).
  - **Photos always use the camera's best resolution and quality**, whatever the stream is set to:
    2048×1536 (QXGA) on an OV3660, 1600×1200 (UXGA) on an OV2640, JPEG quality 10 (stream: 12).
    The viewport takes the stream's aspect ratio.
  - **Default: 1920×1080.** If the camera rejects it on connect (an OV2640 tops out at UXGA), the
    site connects at 240×240 (`FALLBACK_RESOLUTION`, which every sensor supports) and shows the
    sensor's error rather than failing the connection.
  - Settings can be chosen before connecting and are re-applied on every connect.
- **Viewer size:** drag the ↘ handle in the viewer's bottom-right corner, or focus it and use the
  arrow keys (Shift = 100px steps, Home/End = min/max). It's a `role="slider"` in pixels.
  - Width ranges from 360px, which keeps the stacked shutter + flip buttons clear of the handle at
    16:9, to 1280px, and is never wider than the page. It starts at 640px.
  - The height follows the stream's aspect ratio. A drag picks the width whose corner lands
    closest to the pointer (`dragWidth`).
  - The page column is left-aligned, so the corner tracks the pointer. The settings row matches
    the viewer's width, and the photo list is at most 720px wide.

## 2. Serial protocol (v1)

Binary packets, so JPEGs need no base64:

```
+------+------+--------+-------------+-----------+
| 0xA5 | 0x5A | type:u8 | len:u32 LE | payload   |
+------+------+--------+-------------+-----------+
```

| Dir | Type | Name | Payload |
|---|---|---|---|
| ESP → site | `0x01` | `FRAME` | JPEG bytes |
| ESP → site | `0x02` | `CAPTURED` | JSON `{name,size}` |
| ESP → site | `0x03` | `FILE_LIST` | JSON `[{name,size}]` |
| ESP → site | `0x04` | `FILE_DATA` | JPEG bytes |
| ESP → site | `0x06` | `PIXELS` | u16 LE width, u16 LE height, then RGB565 LE pixels |
| ESP → site | `0x05` | `OK` | none: reply to `SET_TIME`, `STREAM`, `MIRROR`, `VFLIP`, `RESOLUTION`, `FPS` |
| ESP → site | `0x7F` | `ERROR` | UTF-8 message |
| site → ESP | `0x81` | `SET_TIME` | u32 LE unix seconds |
| site → ESP | `0x82` | `CAPTURE` | none |
| site → ESP | `0x83` | `LIST` | none |
| site → ESP | `0x84` | `GET_FILE` | UTF-8 filename |
| site → ESP | `0x85` | `STREAM` | u8 (1 = on, 0 = off) |
| site → ESP | `0x86` | `MIRROR` | u8 (1 = flipped); firmware calls the sensor's `set_hmirror` |
| site → ESP | `0x87` | `RESOLUTION` | u16 LE width, u16 LE height (one of `RESOLUTIONS`) |
| site → ESP | `0x88` | `FPS` | u8 target frames per second |
| site → ESP | `0x89` | `VFLIP` | u8 (1 = upside down, relative to the sensor's mounting) |
| site → ESP | `0x8A` | `PHOTO_PIXELS` | u16 LE width, u16 LE height (≤ 240), UTF-8 file name. The photo from the SD card, decoded on the device, center-cropped and scaled: reply `PIXELS`. This is what the device UI shows, and how the emulator gets it |

- **Every command gets exactly one reply, in order:** `OK`, its data packet (`CAPTURED`,
  `FILE_LIST`, `FILE_DATA`), or `ERROR` with a message for the UI. `FRAME`s are unsolicited and can
  arrive between replies. So `SerialSource` matches each reply to the oldest pending command.
- **A missing reply means a broken link.** If a command times out (5 s, 30 s for `GET_FILE`) or a
  write fails, later replies can no longer be matched safely. So the site disconnects with an
  error: "Camera stopped responding", or "No camera firmware detected" if the very first command
  gets no answer.
- The firmware stops streaming when a USB write comes back short (the host stopped reading). Every
  connect sends `STREAM 1` again.
- Both parsers (`protocol.ts`, `firmware/src/protocol.h`) scan for `A5 5A` and resync after noise or
  a corrupted header (length > 4 MB from the device, > 255 B for commands).
- Streaming pauses while a `GET_FILE` reply is sent, because the firmware loop sends one packet at a
  time.
- The site drops frames while one is still decoding, so a slow decode can't build a backlog.

### Measured on the connected board (`make hwtest`, 30 fps target, JPEG quality 12)

| Resolution | Sensor frame | fps | KB/frame | KB/s |
|---|---|---|---|---|
| 240×240 | 240×240 | 30.5 | 4.2 | 127 |
| 480×480 | 640×480 (site crops) | 28.0 | 13.6 | 381 |
| 720×720 | 1280×720 (site crops) | 17.5 | 30.9 | 540 |
| 320×240 | 320×240 | 28.0 | 5.0 | 141 |
| 640×480 | 640×480 | 28.0 | 13.4 | 375 |
| 800×600 | 800×600 | 28.0 | 18.8 | 525 |
| 1280×720 | 1280×720 | 17.5 | 30.3 | 530 |
| 1600×1200 | 1600×1200 | 14.0 | 57.4 | 804 |
| 1920×1080 | 1920×1080 | 13.5 | 60.8 | 820 |

The USB Serial/JTAG link tops out at about **820 KB/s**, which is what limits the large sizes.
FHD streamed, so this module is an OV3660-class sensor (OV2640 tops out at UXGA). On an OV2640,
`RESOLUTION` 1920×1080 returns an `ERROR` that the site shows, and the dropdown reverts. The
firmware rejects sizes above UXGA on the OV2640 and checks `status.framesize` after every change,
because some drivers clamp an oversized request instead of failing.

## 3. Website scaffolding

Next.js (App Router, TypeScript) with `output: "export"`: no server, no API routes. Everything
talks to the device from the browser.

```
web/
├── next.config.ts              # output: "export", trailingSlash: true
├── vitest.config.mts           # unit tests: src/**/*.test.ts
├── playwright.config.ts        # integration tests: e2e/ against the static build on port 3100
├── package.json                # dev (8888), build, test, test:e2e, typecheck, check; engines
├── public/firmware/            # camera-esp.bin + manifest.json, exported by `make build` (committed)
├── public/wasm/                # device-ui.wasm (19.8 KB, no imports), built by `make wasm` (committed)
├── .nvmrc / .npmrc             # Node 24.21.0, engine-strict
├── e2e/
│   ├── live-view.spec.ts       # preview renders frames, fps, disconnect, flip
│   ├── photos.spec.ts          # capture, file list, modal navigation, persistence, mirrored photos
│   ├── stream-settings.spec.ts # resolution/fps options, resize, photo size, pre-connect settings
│   ├── viewer.spec.ts          # resizable viewer: drag, clamps, keyboard, button placement, vflip
│   ├── device.spec.ts          # Device tab: WASM golden in the browser, keys/pad, USB icon, tabs
│   ├── firmware-update.spec.ts # Update firmware: releases the camera, reports failures, recovers
│   ├── serial.spec.ts          # USB camera end to end against the fake device (below)
│   ├── fake-serial-device.js   # fake ESP32 on navigator.serial speaking the firmware protocol
│   └── firmware.spec.ts        # site serves /firmware/manifest.json + a valid flash image
└── src/
    ├── app/
    │   ├── layout.tsx          # html shell, CameraProvider + ConnectBar (shared by both tabs)
    │   ├── device/page.tsx     # Device tab
    │   ├── globals.css         # design tokens (light/dark), all styles
    │   └── page.tsx            # Camera tab: LiveView + FileList
    ├── components/
    │   ├── ConnectBar.tsx      # Camera/Device tabs, source picker, connect/disconnect, status, errors
    │   ├── LiveView.tsx        # canvas preview, shutter + flips, resolution/fps dropdowns, size
    │   ├── ResizeHandle.tsx    # ↘ corner handle: pointer drag + keyboard slider
    │   ├── FileList.tsx        # saved photos, refresh, click to open
    │   ├── ImageModal.tsx      # <dialog> viewer, ← → navigation, download, Esc/backdrop close
    │   ├── DeviceScreen.tsx    # Device tab: WASM device UI → canvas (2×), d-pad + A/B below, flash ring, USB icon,
    │   │                       #   live camera frames into the device's Camera app
    │   └── FirmwareButton.tsx  # header: Update firmware (esptool-js), progress, result
    ├── context/
    │   └── camera-context.tsx  # SOURCE_OPTIONS, source, status, files, mirror/vflip/resolution/fps
    └── lib/
        ├── camera/
        │   ├── types.ts        # CameraSource interface, FileEntry, FrameListener
        │   ├── settings.ts     # RESOLUTIONS, FPS_OPTIONS, defaults, coverCrop, key/label helpers
        │   ├── settings.test.ts
        │   ├── protocol.ts     # packet types, encodePacket, incremental PacketParser
        │   ├── protocol.test.ts
        │   ├── serial-source.ts# USB camera over WebSerial: USB_FILTERS, request/reply queue, frames
        │   └── mock-source.ts  # webcam or test pattern frames, in-memory "SD card"
        ├── firmware.ts         # parseManifest, checkImage, updateFirmware (injectable flasher), esptoolFlasher
        ├── firmware.test.ts
        ├── device-ui.ts        # WASM wrapper (createDeviceUi), rgb565ToRgba, KEY_TO_BUTTON
        ├── device-ui.test.ts   # runs the committed .wasm: golden == native, == golden.h
        ├── viewer-size.ts      # MIN/MAX/DEFAULT viewer width, clampViewerWidth, dragWidth
        ├── viewer-size.test.ts
        ├── filename.ts         # YYYYMMDD-HHMMSS formatting/parsing
        └── filename.test.ts
```

Outside `web/`:

```
Makefile                        # help (default), build, flash/upload, hwtest, monitor, web, stop, restart, check
start.sh                        # deploy / stop / restart the site on nginx
deploy/nginx.conf               # server block template (__PORT__, __ROOT__)
firmware/
├── platformio.ini              # seeed_xiao_esp32s3, espressif32@7.1.3, logs off, export script
├── src/
│   ├── main.cpp                # camera init, command handling, streaming loop, SD photos
│   ├── protocol.h              # packet types, send helpers, command Parser (mirrors protocol.ts)
│   └── camera_pins.h           # XIAO ESP32-S3 Sense camera + SD pins
├── lib/ui/src/                 # device UI (portable C++17, no Arduino, no heap)
│   ├── framebuffer.*           # 240×240 RGB565, rounded rects, circles, 4-bit AA text, palette
│   ├── st7789.*                # SpiBus interface, init sequence, flush (CASET/RASET/RAMWR, BE RGB565)
│   ├── st7789_emulator.*       # decodes that SPI stream into panel memory, as the glass shows it
│   ├── ui.*                    # screens, 5-way input, eased animations (fixed-point, deterministic)
│   ├── font.h, fonts.cpp       # M PLUS Rounded 1c 12/16 px, generated; OFL.txt beside it
├── test_ui/                    # `make uitest`: native tests + golden session (shared with WASM)
├── wasm/device_ui.cpp          # C API exported to the site
├── scripts/export_web.py       # post-build: merged image + manifest → web/public/firmware/
└── tools/
    ├── hwtest.py               # `make hwtest`: protocol-level hardware test (pyserial)
    ├── ui_preview.cpp          # `make ui-preview`: frames in the terminal
    └── make_font.py            # regenerate fonts.cpp (dev-time, needs Pillow)
```

### Firmware

- **Camera:** OV2640/OV3660 on the Sense board, JPEG quality 12 for the stream, 2 frame buffers in
  PSRAM, `CAMERA_GRAB_LATEST`. Buffers are sized at init and can't grow later, so they're sized
  for the largest photo: UXGA first, and if the sensor is an OV3660, it restarts with QXGA
  buffers.
- **Photos (`CAPTURE`):** switch the sensor to its largest size and JPEG quality 10, skip the frames
  still in the old size, save the full-resolution JPEG straight from the sensor (no re-encode),
  then restore the stream size and quality. `make hwtest` checks the saved JPEG's dimensions. FHD has about 8% more pixels than UXGA. That's fine for JPEG: a UXGA
  JPEG buffer is about 384 KB, and measured FHD frames are about 61 KB. Allocating for FHD instead
  could fail init on an OV2640.
- **Out-of-date firmware** answers new commands with `ERROR "Unknown command 0x.."`. The site
  shows "Camera firmware is out of date". Per `CLAUDE.md`, errors state the problem and never
  give instructions. OV3660 modules get `vflip` because they're mounted upside down relative to
  the OV2640.
- **Loop:** handle any received commands, then send a `FRAME` whenever streaming and the fps
  interval has passed. Streaming starts only when the site sends `STREAM 1`, so an idle port gets no
  binary data.
- **Photo library (`firmware/src/sd_photo_library.*`):** `SdPhotoLibrary` implements the device UI's
  `PhotoLibrary` on the microSD card:
  - Scans all of `/photos` and keeps the newest 128 (`keepNewest`): the card's folder order is
    arbitrary, and cutting off before sorting would drop the newest.
  - Decodes JPEGs with the camera library's `jpg2rgb565`, using its built-in 1/2, 1/4 or 1/8 scale
    that best covers the target, then `scaleCover` for the exact size.
  - Caches the last 8 decoded images in PSRAM (a screen of thumbnails plus the viewer image).

  `LIST` and `PHOTO_PIXELS` already use it, so `make hwtest` exercises the same SD code the device
  UI will use once the display is wired.
- **SD card:** SPI, CS = GPIO21 (shared with the user LED, so the LED is unused). With no card,
  `CAPTURE` / `LIST` / `GET_FILE` reply `ERROR "No SD card"`, and streaming still works. A failed
  write deletes the partial file.
- **Flashing:** **Update firmware** on the site (header, every tab) or `make flash` / `make upload`
  from the CLI. The site button:
  1. Asks for the port first, because the browser only allows that right after the click.
  2. Fetches and checks `/firmware/manifest.json` and the image (chip ESP32-S3, ESP magic `0xE9`,
     size), *before* touching the board or the camera connection.
  3. Releases the camera's serial port.
  4. Flashes with **esptool-js** (Espressif's browser flasher, Apache-2.0, loaded only on click):
     it refuses a board whose detected chip isn't the firmware's, writes the merged image at its
     offset, then hard-resets into the new firmware.

  Connect and Update firmware are disabled while the other holds the port. Progress shows in the button ("Updating 42%"), and the outcome next to it. Every build also exports
  `web/public/firmware/camera-esp.bin`. That's a merged image (bootloader, partitions, boot_app0,
  app) to write at `0x0`, the same parts and offsets `pio run -t upload` uses. `manifest.json` next
  to it records `version`: the last commit touching the image's sources (`firmware/src/`,
  `platformio.ini`), plus `-dirty` for uncommitted edits to them. The site serves both files, ready for the WebSerial flashing UI (esptool-js, next
  step). **Workflow:** commit firmware source changes, run `make build`, then commit the exported
  files, so the served image matches a real commit.

### The `CameraSource` interface

Every transport (mock, USB, WiFi) implements this. The UI only ever sees this interface.

```ts
interface CameraSource {
  readonly kind: "mock" | "serial" | "wifi";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onFrame(listener: (frame: ImageBitmap) => void): () => void; // returns unsubscribe
  onClose(listener: (error: Error) => void): () => void; // camera went away on its own (unplugged)
  setMirror(mirrored: boolean): Promise<void>; // horizontal flip, preview and photos
  setVflip(flipped: boolean): Promise<void>; // vertical flip, preview and photos
  setResolution(resolution: Resolution): Promise<void>; // stream and photo size
  setFps(fps: number): Promise<void>; // target rate; the transport may deliver less
  capture(): Promise<FileEntry>;
  listFiles(): Promise<FileEntry[]>;
  getFile(name: string): Promise<Blob>;
}
```

The frame bitmap is closed once every listener has returned, so listeners must draw it right away
and not keep a reference.

### Page layout

```
┌─────────────────────────────────────────────┐
│ ESP Camera  [USB camera ▾] [Connect] ● connected │  ConnectBar
├─────────────────────────────────────────────┤
│ ┌───────────────────────────────┐           │
│ │                          [◉]  │           │  LiveView: shutter,
│ │                          [⇋]  │           │  horizontal flip,
│ │   live view (1920×1080)  [⇅]  │           │  vertical flip
│ │                           ↘   │           │  resize handle (360–1280px)
│ └───────────────────────────────┘           │
│ [1920×1080 ▾] [15 fps ▾]     15 fps actual  │
├─────────────────────────────────────────────┤
│ Photos (3)                       [Refresh]  │  FileList
│  20260921-142305.jpg   11 KB   2:23 PM      │
└─────────────────────────────────────────────┘
            ImageModal (<dialog>) on click
```

## 4. Development pipeline

The full rules live in `CLAUDE.md`. In short:

1. One branch per feature (`feature/<name>`, `fix/<name>`). No commits or pushes to `main`.
2. New code ships with **unit tests** (Vitest, `*.test.ts`) and **integration tests** (Playwright,
   `web/e2e/`). USB behavior is tested against `fake-serial-device.js`. Keep it in step with the
   firmware whenever the protocol changes. Firmware changes are also checked on the real board with
   `make flash && make hwtest`.
3. `make check` = `make uitest` (device UI, native C++) then `npm run check` (lint → typecheck →
   unit → build → integration). Both run locally in the
   **pre-push hook** (`.githooks/pre-push`, which also blocks pushes to `main`) and in **CI**
   (`.github/workflows/web.yml`) on every PR.
4. Review `docs/` and update them in the same commit.
5. Run `/code-review` on the branch and resolve its findings **before** `gh pr create`.

## 5. Build order

**Phase 1a: mock site (no hardware)**
1. [x] Scaffold Next.js static export in `web/`
2. [x] `CameraSource` types + `MockSource` (webcam, test pattern fallback)
3. [x] **LiveView: camera preview working first**
4. [x] Shutter button → capture into in-memory files
5. [x] FileList + ImageModal
6. [x] Unit + integration tests, pre-push hook, CI, dev server on port 8888
7. [x] Horizontal flip button (`setMirror`, mirrored photos)
8. [x] `start.sh` deploy/stop/restart, `Makefile` (`make flash`, `make web`), Node 24 LTS pin
9. [x] Resolution and frame-rate dropdowns; custom select chevron

**Phase 1b: USB**
10. [x] Firmware: stream `FRAME` packets over USB CDC, `MIRROR` → `set_hmirror`, `RESOLUTION`, `FPS`
11. [x] `protocol.ts` + `SerialSource`, live view from the real camera (stream verified with `make hwtest`)
12. [x] Firmware: `CAPTURE` to SD, `LIST`, `GET_FILE`, `SET_TIME` (SD path untested on hardware: no card inserted yet)
13. [x] `make flash` / `make upload`, `make hwtest`, firmware image + manifest exported to the site
14. [x] Flash firmware from the site over WebSerial (esptool-js, using `/firmware/manifest.json`); real-board flash pending
15. [x] Photos at the sensor's best resolution (QXGA on OV3660), whatever the stream size (untested on hardware: needs an SD card)
16. [x] Resizable viewer (↘ handle, 360–1280px), vertical flip (`VFLIP`), 1920×1080 default with fallback
17. [x] Wii-inspired device UI (`docs/wii-theme.md`): research, CLI mockups, portable C++ UI + ST7789
    driver/emulator, `make uitest`/`ui-preview`/`wasm`, site **Device** tab
18. [x] Device UI: full-screen camera (Center shoot, A flash, B back), Grid + 12h/24h clock settings,
    flash ring around the emulated display; both site pages centered, emulator controls below the display

**Phase 2: device + deploy**
19. [ ] Wire the ST7789 + 5-way switch and run `ui::Ui` on the device (a `SpiBus` over Arduino `SPI`
    + DC pin); Camera page shows the live sensor preview and the shutter takes real photos
20. [ ] Pictures page shows real SD photos (thumbnails, full view); battery level (`Link::Battery`)
21. [ ] Deploy to `camera.nirvek.xyz`: run `./start.sh` on the Proxmox host, add the tunnel
    hostname → `http://<host>:8888` (fix the garbled `cloudflare-domain-setup.md` first)
22. [ ] Date range filter, camera animations (README step 3)

**Phase 3: features**
- [ ] WiFi transport (`WifiSource`)
- [ ] Orientation via MPU-6050, OTA image upload/backup

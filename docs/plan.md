# ESP32-S3 Camera: Project Plan

## 1. Major elements

| Element | What it is | Lives in |
|---|---|---|
| **Camera device** | Xiao ESP32-S3 + Sense camera (OV2640/OV3660), microSD, SPI 240×240 display, 5-way switch, MPU-6050, battery | hardware |
| **Firmware** | Arduino/ESP-IDF sketch: captures frames, streams them over USB, saves JPEGs to SD, serves file list/downloads, later drives the SPI display and buttons | `firmware/` (PlatformIO; placeholder sketch until phase 1b) |
| **Transport** | How the site talks to the device. **Phase 1: USB serial (WebSerial).** Phase 2: WiFi (feature, added later) | `web/src/lib/camera/` + firmware |
| **Website** | Static Next.js app: live preview, take-picture button, file browser + image modal, later flashing via esptool-js | `web/` |
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
| `make flash [PORT=/dev/cu.usbmodemXXXX]` | build + flash firmware (port auto-detected) |
| `make monitor` / `make build` | serial monitor / build firmware only |
| `make web` = `./start.sh` | git pull, stop other copies on 8888, build, publish to nginx, health check |
| `make stop` = `./start.sh stop` | remove the site from nginx, free port 8888 |
| `make restart` = `./start.sh restart` | stop + start, without pulling |
| `make check` | web lint, types, unit and integration tests |

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
- Firmware debug logs must go to UART0, **not** the USB CDC port carrying the binary stream.

### Conventions

- **Filenames:** `YYYYMMDD-HHMMSS.jpg` (e.g. `20260921-142305.jpg`). FAT32 forbids `:`, and this
  format sorts chronologically and filters by date with a prefix check. Same-second duplicates get
  `_2`, `_3`, … (`20260921-142305_2.jpg`). `_` sorts after `.`, so newest-first order holds.
- **Time:** the ESP has no RTC. On connect the site sends `SET_TIME(epoch)`. Photos taken before a
  sync fall back to `IMG_0001.jpg` counters.
- **Mirror:** the flip button is a camera setting (`setMirror`), not a CSS transform, so saved
  photos match the preview. The site re-applies it after every reconnect.
- **Preview resolution:** stream at `FRAMESIZE_240X240` (matches the SPI display), shown at 480×480
  on the site (2× CSS scale). Stills may later use a higher resolution.

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
| ESP → site | `0x02` | `CAPTURED` | UTF-8 filename |
| ESP → site | `0x03` | `FILE_LIST` | JSON `[{name,size}]` |
| ESP → site | `0x04` | `FILE_DATA` | JPEG bytes |
| ESP → site | `0x7F` | `ERROR` | UTF-8 message |
| site → ESP | `0x81` | `SET_TIME` | u32 LE unix seconds |
| site → ESP | `0x82` | `CAPTURE` | none |
| site → ESP | `0x83` | `LIST` | none |
| site → ESP | `0x84` | `GET_FILE` | UTF-8 filename |
| site → ESP | `0x85` | `STREAM` | u8 (1 = on, 0 = off) |
| site → ESP | `0x86` | `MIRROR` | u8 (1 = flipped); firmware calls the sensor's `set_hmirror` |

- The parser scans for `A5 5A` and resyncs after a corrupted packet.
- Streaming pauses during `GET_FILE` so file transfers aren't slowed down by frames.
- Budget: USB full speed ≈ 0.5–1 MB/s real throughput. At ~10 KB/frame, target 10–15 fps.

## 3. Website scaffolding

Next.js (App Router, TypeScript) with `output: "export"`: no server, no API routes. Everything
talks to the device from the browser.

```
web/
├── next.config.ts              # output: "export", trailingSlash: true
├── vitest.config.mts           # unit tests: src/**/*.test.ts
├── playwright.config.ts        # integration tests: e2e/ against the static build on port 3100
├── package.json                # dev (8888), build, test, test:e2e, typecheck, check; engines
├── .nvmrc / .npmrc             # Node 24.21.0, engine-strict
├── e2e/
│   ├── live-view.spec.ts       # preview renders frames, fps, disconnect, flip
│   └── photos.spec.ts          # capture, file list, modal navigation, persistence, mirrored photos
└── src/
    ├── app/
    │   ├── layout.tsx          # html shell, fonts, metadata
    │   ├── globals.css         # design tokens (light/dark), all styles
    │   └── page.tsx            # CameraProvider + page layout
    ├── components/
    │   ├── ConnectBar.tsx      # source picker, connect/disconnect, status dot, errors
    │   ├── LiveView.tsx        # canvas preview, shutter + flash, flip button, fps stats
    │   ├── FileList.tsx        # saved photos, refresh, click to open
    │   └── ImageModal.tsx      # <dialog> viewer, ← → navigation, download, Esc/backdrop close
    ├── context/
    │   └── camera-context.tsx  # SOURCE_OPTIONS, active source, status, files, mirror, actions
    └── lib/
        ├── camera/
        │   ├── types.ts        # CameraSource interface, FileEntry, FrameListener
        │   └── mock-source.ts  # webcam or test pattern frames, in-memory "SD card"
        ├── filename.ts         # YYYYMMDD-HHMMSS formatting/parsing
        └── filename.test.ts
```

Outside `web/`:

```
Makefile                        # flash, monitor, build, web, stop, restart, check
start.sh                        # deploy / stop / restart the site on nginx
deploy/nginx.conf               # server block template (__PORT__, __ROOT__)
firmware/
├── platformio.ini              # seeed_xiao_esp32s3, espressif32@7.1.3
└── src/main.cpp                # placeholder: blink + serial hello
```

Phase 1b adds `lib/camera/protocol.ts` (packet encode/decode and streaming parser) and
`lib/camera/serial-source.ts` (WebSerial `CameraSource`), plus a USB entry in `SOURCE_OPTIONS`.

### The `CameraSource` interface

Every transport (mock, USB, WiFi) implements this. The UI only ever sees this interface.

```ts
interface CameraSource {
  readonly kind: "mock" | "serial" | "wifi";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onFrame(listener: (frame: ImageBitmap) => void): () => void; // returns unsubscribe
  setMirror(mirrored: boolean): Promise<void>; // horizontal flip, preview and photos
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
│ ESP Camera   [Mock ▾] [Connect]  ● connected   │  ConnectBar
├─────────────────────────────────────────────┤
│   ┌───────────────────────────────┐         │
│   │                          [◉]  │         │  LiveView (shutter overlay)
│   │                          [⇋]  │         │  flip (mirror) below shutter
│   │      live view 480×480        │         │
│   └───────────────────────────────┘         │
│   12 fps · 240×240                          │
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
   `web/e2e/`).
3. `npm run check` = lint → typecheck → unit → build → integration. It runs locally in the
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

**Phase 1b: USB**
9. [ ] Firmware: stream `FRAME` packets over USB CDC, `MIRROR` → `set_hmirror`
10. [ ] `protocol.ts` + `SerialSource`, live view from the real camera
11. [ ] Firmware: `CAPTURE` to SD, `LIST`, `GET_FILE`, `SET_TIME`

**Phase 2: device + deploy**
12. [ ] SPI display shows live view; 5-way switch takes pictures
13. [ ] On-device file preview menu (240×240)
14. [ ] Deploy to `camera.nirvek.xyz`: run `./start.sh` on the Proxmox host, add the tunnel
    hostname → `http://<host>:8888` (fix the garbled `cloudflare-domain-setup.md` first)
15. [ ] Date range filter, camera animations (README step 3)

**Phase 3: features**
- [ ] WiFi transport (`WifiSource`)
- [ ] Flash firmware from the site (esptool-js)
- [ ] Orientation via MPU-6050, OTA image upload/backup

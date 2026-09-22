// The device's own UI (firmware/lib/ui) compiled to WebAssembly (`make wasm`). Frames come out of
// an emulated ST7789 fed by the real driver's SPI bytes: this is what the physical panel shows.

export const PANEL_SIZE = 240;
// The Camera app's picture area under the nav bar (ui::PREVIEW_* in firmware/lib/ui/src/ui.h).
export const PREVIEW_Y = 28;
export const PREVIEW_W = 240;
export const PREVIEW_H = PANEL_SIZE - PREVIEW_Y;
export const THUMB_SIZE = 64; // ui::THUMB_SIZE
export const VIEWER_H = 177; // ui::VIEWER_H: the viewer's picture is PANEL_SIZE x VIEWER_H
export const MAX_PHOTOS = 128; // HostLibrary::MAX in firmware/wasm/device_ui.cpp
const NAME_MAX = 24; // ui::PHOTO_NAME_MAX, including the NUL

// Must match ui::Button, ui::Screen and ui::Link in firmware/lib/ui/src/ui.h.
export const Button = { Up: 0, Down: 1, Left: 2, Right: 3, Center: 4, A: 5, B: 6 } as const;
export const Screen = { Home: 0, Camera: 1, Pictures: 2, Settings: 3, Viewer: 4 } as const;
export const Link = { None: 0, Usb: 1, Battery: 2 } as const;

export const KEY_TO_BUTTON: Record<string, number> = {
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  Enter: Button.Center,
  " ": Button.Center,
  a: Button.A,
  b: Button.B,
  A: Button.A, // Caps Lock / Shift
  B: Button.B,
};

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  ui_init(): void;
  ui_press(button: number): void;
  ui_set_time(minutes: number): void;
  ui_set_link(link: number, batteryPercent: number): void;
  ui_frame(elapsedMs: number): number;
  ui_screen(): number;
  ui_focus(): number;
  ui_animating(): number;
  ui_flash(): number;
  ui_preview_buffer(): number;
  ui_library_name(index: number): number;
  ui_library_set_count(count: number): void;
  ui_library_thumb(index: number): number;
  ui_library_thumb_ready(index: number): void;
  ui_library_image(): number;
  ui_library_image_ready(index: number): void;
  ui_library_wanted_image(): number;
  ui_take_capture_requests(): number;
  ui_take_delete_request(): number;
  ui_set_preview(on: number): void;
  ui_golden(): number;
  ui_golden_expected(): number;
}

export async function createDeviceUi(wasm: BufferSource) {
  const { instance } = await WebAssembly.instantiate(wasm, {}); // no imports: standalone build
  const e = instance.exports as unknown as Exports;
  e._initialize();
  e.ui_init();
  return {
    press: (button: number) => e.ui_press(button),
    setTime: (minutesSinceMidnight: number) => e.ui_set_time(minutesSinceMidnight),
    setLink: (link: number, batteryPercent = 0) => e.ui_set_link(link, batteryPercent),
    /** Advances time and returns the panel (240×240 RGB565), valid until the next call. */
    frame: (elapsedMs: number) => new Uint16Array(e.memory.buffer, e.ui_frame(elapsedMs), PANEL_SIZE * PANEL_SIZE),
    screen: () => e.ui_screen(),
    focus: () => e.ui_focus(),
    animating: () => e.ui_animating() !== 0,
    /** Live camera frame (PREVIEW_W x PREVIEW_H RGB565) for the Camera app; null shows its color bars. */
    setPreview: (frame: Uint16Array | null) => {
      if (frame) new Uint16Array(e.memory.buffer, e.ui_preview_buffer(), PREVIEW_W * PREVIEW_H).set(frame);
      e.ui_set_preview(frame ? 1 : 0);
    },
    /** The camera's photos, newest first (thumbnails and the viewer image follow). */
    setPhotos: (names: string[]) => {
      const bytes = new TextEncoder();
      names.slice(0, MAX_PHOTOS).forEach((name, i) => {
        const slot = new Uint8Array(e.memory.buffer, e.ui_library_name(i), NAME_MAX);
        slot.fill(0);
        slot.set(bytes.encode(name).slice(0, NAME_MAX - 1));
      });
      e.ui_library_set_count(Math.min(names.length, MAX_PHOTOS));
    },
    /** THUMB_SIZE x THUMB_SIZE RGB565 for photo index. */
    setThumbnail: (index: number, pixels: Uint16Array) => {
      new Uint16Array(e.memory.buffer, e.ui_library_thumb(index), THUMB_SIZE * THUMB_SIZE).set(pixels);
      e.ui_library_thumb_ready(index);
    },
    /** PANEL_SIZE x VIEWER_H RGB565 for the viewer, for photo index. */
    setImage: (index: number, pixels: Uint16Array) => {
      new Uint16Array(e.memory.buffer, e.ui_library_image(), PANEL_SIZE * VIEWER_H).set(pixels);
      e.ui_library_image_ready(index);
    },
    /** The photo the viewer is waiting for, or -1. */
    wantedImage: () => e.ui_library_wanted_image(),
    /** The photo the user confirmed deleting, once; null if none. */
    takeDeleteRequest: () => {
      const ptr = e.ui_take_delete_request();
      if (!ptr) return null;
      const bytes = new Uint8Array(e.memory.buffer, ptr, NAME_MAX);
      return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
    },
    /** Shutter presses since the last call: the page saves that many photos. */
    takeCaptureRequests: () => e.ui_take_capture_requests(),
    /** Flash on: a light ring around the physical display, outside the panel. */
    flashOn: () => e.ui_flash() !== 0,
    golden: () => e.ui_golden() >>> 0,
    goldenExpected: () => e.ui_golden_expected() >>> 0,
  };
}

export type DeviceUi = Awaited<ReturnType<typeof createDeviceUi>>;

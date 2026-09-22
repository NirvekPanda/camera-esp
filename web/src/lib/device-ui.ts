// The device's own UI (firmware/lib/ui) compiled to WebAssembly (`make wasm`). Frames come out of
// an emulated ST7789 fed by the real driver's SPI bytes: this is what the physical panel shows.

export const PANEL_SIZE = 240;
// The Camera app's picture area under the nav bar (ui::PREVIEW_* in firmware/lib/ui/src/ui.h).
export const PREVIEW_Y = 28;
export const PREVIEW_W = 240;
export const PREVIEW_H = PANEL_SIZE - PREVIEW_Y;

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
    /** Flash on: a light ring around the physical display, outside the panel. */
    flashOn: () => e.ui_flash() !== 0,
    golden: () => e.ui_golden() >>> 0,
    goldenExpected: () => e.ui_golden_expected() >>> 0,
  };
}

export type DeviceUi = Awaited<ReturnType<typeof createDeviceUi>>;

/** RGBA8888 → RGB565 (drops the low bits, like the camera's own RGB565 output). */
export function rgbaToRgb565(src: Uint8ClampedArray, dst: Uint16Array) {
  for (let i = 0; i < dst.length; i++) {
    dst[i] = ((src[4 * i] >> 3) << 11) | ((src[4 * i + 1] >> 2) << 5) | (src[4 * i + 2] >> 3);
  }
}

/** RGB565 → RGBA8888 with bit replication, so full white/black map to 255/0. */
export function rgb565ToRgba(src: Uint16Array, dst: Uint8ClampedArray) {
  for (let i = 0; i < src.length; i++) {
    const p = src[i];
    const r = p >> 11, g = (p >> 5) & 0x3f, b = p & 0x1f;
    dst[4 * i] = (r << 3) | (r >> 2);
    dst[4 * i + 1] = (g << 2) | (g >> 4);
    dst[4 * i + 2] = (b << 3) | (b >> 2);
    dst[4 * i + 3] = 255;
  }
}

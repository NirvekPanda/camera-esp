import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  Button,
  KEY_TO_BUTTON,
  Link,
  PANEL_SIZE,
  PREVIEW_H,
  PREVIEW_W,
  PREVIEW_Y,
  Screen,
  THUMB_SIZE,
  createDeviceUi,
} from "./device-ui";
import { rgb565ToRgba, rgbaToRgb565 } from "./rgb565";

// The committed build (`make wasm`): a stale or broken build fails here, not just in the browser.
const wasm = readFileSync(path.join(__dirname, "../../public/wasm/device-ui.wasm"));
// The golden hash in the C++ sources: if the UI changed but `make wasm` wasn't rerun, they differ.
const sourceGolden = Number(
  /EXPECTED_HASH = (0x[0-9a-f]+)/.exec(readFileSync(path.join(__dirname, "../../../firmware/test_ui/golden.h"), "utf8"))![1],
);

describe("rgb565ToRgba", () => {
  it("expands 5/6/5-bit channels to full range", () => {
    const out = new Uint8ClampedArray(4 * 5);
    rgb565ToRgba(Uint16Array.of(0xf800, 0x07e0, 0x001f, 0xffff, 0x0000), out);
    expect([...out]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it("keeps the nav bar gray neutral", () => {
    const out = new Uint8ClampedArray(4);
    rgb565ToRgba(Uint16Array.of(0xf7be), out); // #F7F7F7
    expect([...out]).toEqual([247, 247, 247, 255]);
  });
});

describe("rgbaToRgb565", () => {
  it("packs RGBA into RGB565 and round-trips exact RGB565 colors", () => {
    const colors = Uint16Array.of(0xf800, 0x07e0, 0x001f, 0xffff, 0x0000, 0x35fd, 0xce7a);
    const rgba = new Uint8ClampedArray(colors.length * 4);
    rgb565ToRgba(colors, rgba);
    const back = new Uint16Array(colors.length);
    rgbaToRgb565(rgba, back);
    expect([...back]).toEqual([...colors]);
  });
});

describe("KEY_TO_BUTTON", () => {
  it("maps arrows and Enter/Space onto the 5-way switch", () => {
    expect(KEY_TO_BUTTON).toMatchObject({
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
    });
  });
});

describe("createDeviceUi (real WASM build)", () => {
  it("reproduces the native golden session bit for bit", async () => {
    const ui = await createDeviceUi(wasm);
    expect(ui.golden()).toBe(ui.goldenExpected());
    expect(ui.goldenExpected()).toBe(sourceGolden); // the .wasm is built from the current sources
  });

  it("renders the nav bar through the emulated ST7789", async () => {
    const ui = await createDeviceUi(wasm);
    ui.setTime(14 * 60 + 23);
    const panel = ui.frame(16);
    expect(panel).toHaveLength(PANEL_SIZE * PANEL_SIZE);
    expect(panel[27 * PANEL_SIZE + 120]).toBe(0xce7a); // divider under the nav bar
  });

  it("drives screens with 5-way presses", async () => {
    const ui = await createDeviceUi(wasm);
    expect(ui.screen()).toBe(Screen.Home);
    ui.press(Button.Right);
    ui.frame(200);
    expect(ui.focus()).toBe(1);
    ui.press(Button.Center);
    ui.frame(300);
    expect(ui.screen()).toBe(Screen.Pictures);
  });

  it("ignores negative time steps instead of rewinding animations", async () => {
    const ui = await createDeviceUi(wasm);
    ui.press(Button.Right);
    ui.frame(200); // slide finished
    expect(ui.animating()).toBe(false);
    ui.frame(-3); // e.g. rAF's frame time is earlier than when the module loaded
    expect(ui.animating()).toBe(false);
  });

  it("camera: Center shoots, A toggles the flash, B goes back home", async () => {
    const ui = await createDeviceUi(wasm);
    ui.press(Button.Center);
    ui.frame(300);
    expect(ui.screen()).toBe(Screen.Camera);
    const nav = (panel: Uint16Array) => panel.slice(0, 27 * PANEL_SIZE);
    const before = nav(ui.frame(16));
    ui.press(Button.A);
    expect(nav(ui.frame(16))).not.toEqual(before); // flash icon in the nav bar
    expect(ui.flashOn()).toBe(true); // the page draws the light ring around the display
    ui.press(Button.Center);
    expect(ui.animating()).toBe(true); // shutter blink
    ui.press(Button.B);
    ui.frame(16);
    expect(ui.screen()).toBe(Screen.Home);
  });

  it("the Camera app shows live preview frames when set, color bars otherwise", async () => {
    const ui = await createDeviceUi(wasm);
    ui.press(Button.Center);
    ui.frame(300); // Camera
    const frame = new Uint16Array(PREVIEW_W * PREVIEW_H).fill(0x07e0); // all green
    ui.setPreview(frame);
    let panel = ui.frame(16);
    expect(panel[(PREVIEW_Y + 100) * PANEL_SIZE + 5]).toBe(0x07e0);
    expect(panel[(PREVIEW_Y + 100) * PANEL_SIZE + 235]).toBe(0x07e0);
    ui.setPreview(null);
    panel = ui.frame(16);
    expect(panel[(PREVIEW_Y + 30) * PANEL_SIZE + 5]).toBe(0xffff); // first color bar is white
  });

  it("the Pictures page and viewer show the photos the page loads", async () => {
    const ui = await createDeviceUi(wasm);
    ui.setPhotos(["20260621-094107.jpg", "20260620-120000.jpg"]);
    ui.setThumbnail(0, new Uint16Array(THUMB_SIZE * THUMB_SIZE).fill(0x07e0)); // green
    ui.press(Button.Right);
    ui.press(Button.Center);
    let panel = ui.frame(300); // Pictures
    expect(ui.screen()).toBe(Screen.Pictures);
    expect(panel[(38 + 32) * PANEL_SIZE + 12 + 32]).toBe(0x07e0); // thumbnail 0
    expect(panel[(38 + 32) * PANEL_SIZE + 12 + 74 + 32]).toBe(0xffff); // thumbnail 1 not loaded yet: tile
    ui.press(Button.Center); // view photo 0
    ui.frame(16);
    expect(ui.wantedImage()).toBe(0); // the viewer asks for it
    ui.setImage(0, new Uint16Array(PREVIEW_W * PREVIEW_H).fill(0xf800)); // red
    panel = ui.frame(16);
    expect(ui.wantedImage()).toBe(-1);
    expect(panel[(PREVIEW_Y + 100) * PANEL_SIZE + 120]).toBe(0xf800);
  });

  it("shutter presses are handed to the page to save photos", async () => {
    const ui = await createDeviceUi(wasm);
    ui.press(Button.Center);
    ui.frame(300); // Camera
    ui.press(Button.Center);
    ui.press(Button.Center);
    expect(ui.takeCaptureRequests()).toBe(2);
    expect(ui.takeCaptureRequests()).toBe(0);
  });

  it("shows the USB icon only when linked", async () => {
    const ui = await createDeviceUi(wasm);
    const corner = (panel: Uint16Array) => panel.slice(13 * PANEL_SIZE + 200, 13 * PANEL_SIZE + 240); // icon row
    const plain = corner(ui.frame(16));
    ui.setLink(Link.Usb);
    expect(corner(ui.frame(16))).not.toEqual(plain);
  });
});

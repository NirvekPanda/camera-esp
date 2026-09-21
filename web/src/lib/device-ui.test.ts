import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Button, KEY_TO_BUTTON, Link, PANEL_SIZE, Screen, createDeviceUi, rgb565ToRgba } from "./device-ui";

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

describe("KEY_TO_BUTTON", () => {
  it("maps arrows and Enter/Space onto the 5-way switch", () => {
    expect(KEY_TO_BUTTON).toMatchObject({
      ArrowUp: Button.Up,
      ArrowDown: Button.Down,
      ArrowLeft: Button.Left,
      ArrowRight: Button.Right,
      Enter: Button.Center,
      " ": Button.Center,
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

  it("shows the USB icon only when linked", async () => {
    const ui = await createDeviceUi(wasm);
    const corner = (panel: Uint16Array) => panel.slice(13 * PANEL_SIZE + 200, 13 * PANEL_SIZE + 240); // icon row
    const plain = corner(ui.frame(16));
    ui.setLink(Link.Usb);
    expect(corner(ui.frame(16))).not.toEqual(plain);
  });
});

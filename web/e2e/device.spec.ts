import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// RGB565 → RGB888 the way the page converts it (bit replication).
function expand(r8: number, g8: number, b8: number) {
  const r = r8 >> 3, g = g8 >> 2, b = b8 >> 3;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
const LINE = expand(0xc9, 0xcd, 0xd2); // nav bar divider
const INK = expand(0x3a, 0x40, 0x48); // icons
const BG = expand(0xee, 0xf0, 0xf2); // page background

const pixel = (page: Page, x: number, y: number) =>
  page.locator(".device-screen").evaluate(
    (c: HTMLCanvasElement, [x, y]) => [...c.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3)],
    [x, y],
  );

// Does a canvas region contain this exact color?
const regionHas = (page: Page, [x, y, w, h]: number[], rgb: number[]) =>
  page.locator(".device-screen").evaluate(
    (c: HTMLCanvasElement, { box, rgb }) => {
      const d = c.getContext("2d")!.getImageData(box[0], box[1], box[2], box[3]).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) return true;
      return false;
    },
    { box: [x, y, w, h], rgb },
  );

// Pictures (with no camera: "No photos") is open: its Back button bottom-left, and empty page
// background where Settings would draw rows.
const onPictures = async (page: Page) => {
  const back = await pixel(page, 15, 223);
  const content = await pixel(page, 120, 60);
  return back.every((v) => v === 255) && content.every((v, i) => v === BG[i]);
};

// The viewer's Delete button, bottom-right (the Pictures page has no primary button).
const onViewer = async (page: Page) => (await pixel(page, 194, 214)).every((v) => v === 255);

async function openDeviceTab(page: Page) {
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page).toHaveURL(/\/device\/$/);
  await expect.poll(() => pixel(page, 120, 27)).toEqual(LINE); // first frame painted
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the Device tab sits next to Camera and shows the emulated screen", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Camera" })).toHaveAttribute("aria-current", "page");
  await openDeviceTab(page);
  await expect(page.getByRole("link", { name: "Device" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".device-screen")).toBeVisible();
  expect(await page.locator(".device-screen").evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([240, 240]);
});

test("the browser's WASM build reproduces the native golden session", async ({ page }) => {
  const [hash, expected] = await page.evaluate(async () => {
    const bytes = await (await fetch("/wasm/device-ui.wasm")).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const e = instance.exports as Record<string, () => number>;
    e._initialize();
    return [e.ui_golden() >>> 0, e.ui_golden_expected() >>> 0];
  });
  expect(hash).toBe(expected);
});

test("arrow keys and Enter drive the 5-way switch", async ({ page }) => {
  await openDeviceTab(page);
  await page.locator(".device-screen").focus();
  await page.keyboard.press("ArrowRight"); // focus Pictures (input isn't blocked while the row slides)
  await page.keyboard.press("Enter"); // open it
  await expect.poll(() => onPictures(page)).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); // below the grid: Back, bottom-left as on every page
  await page.keyboard.press("Enter");
  await expect.poll(() => onPictures(page)).toBe(false); // home again
});

test("arrow keys, Space and Enter work without clicking the display first", async ({ page }) => {
  await openDeviceTab(page);
  await page.keyboard.press("ArrowRight"); // focus is on the page, not the canvas
  await page.keyboard.press(" "); // Space = Center: open Pictures
  await expect.poll(() => onPictures(page)).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); // Back
  await page.keyboard.press("Enter"); // Enter = Center
  await expect.poll(() => onPictures(page)).toBe(false);
  expect(await page.evaluate(() => window.scrollY)).toBe(0); // arrows/Space didn't scroll the page
});

test("after clicking a pad button, Space still means Center", async ({ page }) => {
  await openDeviceTab(page);
  await page.getByRole("button", { name: "Right" }).click(); // focus stays on that button
  await page.keyboard.press(" "); // must press Center once, not click "Right" again
  await expect.poll(() => onPictures(page)).toBe(true); // Pictures, not Settings
});

test("keys typed into other controls don't reach the emulator", async ({ page }) => {
  await openDeviceTab(page);
  await page.getByLabel("Camera source").focus();
  await page.keyboard.press("ArrowDown"); // changes the select, not the device
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect(await onPictures(page)).toBe(false);
});

test("the on-screen pad works like the keys", async ({ page }) => {
  await openDeviceTab(page);
  await page.getByRole("button", { name: "Right" }).click();
  await page.getByRole("button", { name: "Center" }).click();
  await expect.poll(() => onPictures(page)).toBe(true);
});

test("the display is centered, with the d-pad centered below it and A/B to its right", async ({ page }) => {
  await openDeviceTab(page);
  const screen = (await page.locator(".device-screen").boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  const pad = (await page.getByRole("group", { name: "5-way switch" }).boundingBox())!;
  const face = (await page.getByRole("group", { name: "A and B buttons" }).boundingBox())!;
  const mid = (b: { x: number; width: number }) => b.x + b.width / 2;
  expect(mid(screen)).toBeCloseTo(mid(main), 0);
  expect(pad.y).toBeGreaterThan(screen.y + screen.height);
  expect(Math.abs(mid(pad) - mid(screen))).toBeLessThan(face.width); // the pad + A/B pair is centered
  expect(face.x).toBeGreaterThan(pad.x + pad.width);
  const body = (await page.locator(".device-controls").boundingBox())!; // one NES-style rectangle holds both
  for (const b of [pad, face]) {
    expect(b.x).toBeGreaterThan(body.x);
    expect(b.y).toBeGreaterThan(body.y);
    expect(b.x + b.width).toBeLessThan(body.x + body.width);
    expect(b.y + b.height).toBeLessThan(body.y + body.height);
  }
  const fontSize = (name: string) =>
    page.getByRole("button", { name, exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await fontSize("A")).toBeGreaterThan(await fontSize("Up")); // A/B labels are the larger face-button size
});

test("camera: Center shoots, A lights the ring outside the display, B goes back home", async ({ page }) => {
  await openDeviceTab(page);
  const frame = page.locator(".device-frame");
  await page.getByRole("button", { name: "Center" }).click(); // open Camera
  await expect.poll(() => pixel(page, 5, 60)).toEqual([255, 255, 255]); // camera picture shown (zoom done)
  await page.getByRole("button", { name: "A", exact: true }).click();
  await expect(frame).toHaveAttribute("data-flash", "on");
  await expect.poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Center" }).click();
  await expect.poll(() => pixel(page, 120, 150)).toEqual([255, 255, 255]); // shutter blink on the panel
  await page.keyboard.press("a"); // keys work too
  await expect(frame).toHaveAttribute("data-flash", "off");
  await page.keyboard.press("b"); // Back: home
  await page.getByRole("button", { name: "Right" }).click();
  await page.getByRole("button", { name: "Center" }).click();
  await expect.poll(() => onPictures(page)).toBe(true); // Pictures opened from home
});

test("shows the USB icon while the camera is connected over WebSerial", async ({ page }) => {
  await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
  await page.goto("/");
  const iconArea = [200, 4, 40, 20];
  await openDeviceTab(page);
  expect(await regionHas(page, iconArea, INK)).toBe(false);

  await page.getByRole("link", { name: "Camera" }).click();
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
  await openDeviceTab(page);
  await expect.poll(() => regionHas(page, iconArea, INK)).toBe(true);
  await expect(page.getByRole("status")).toHaveText("connected"); // the connection survived the tab switch
});

test("the Camera app shows the connected camera's live stream", async ({ page }) => {
  await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click(); // fake board: red band on the left, green elsewhere
  await expect(page.getByRole("status")).toHaveText("connected");
  await openDeviceTab(page);
  await page.keyboard.press("Enter"); // open Camera
  const isGreen = ([r, g, b]: number[]) => g > 200 && r < 60 && b < 60;
  const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
  await expect.poll(async () => isGreen(await pixel(page, 180, 120))).toBe(true);
  expect(isRed(await pixel(page, 8, 120))).toBe(true); // the frame is center-cropped, not squashed
  await page.getByRole("link", { name: "Camera" }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await openDeviceTab(page);
  await page.keyboard.press("Enter");
  await expect.poll(() => pixel(page, 5, 60)).toEqual([255, 255, 255]); // no camera: color bars
});

test.describe("Pictures page with the camera's SD card", () => {
  const isGreen = ([r, g, b]: number[]) => g > 190 && r < 70 && b < 70;
  const isRed = ([r, g, b]: number[]) => r > 190 && g < 70 && b < 70;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
    await page.goto("/");
  });

  test("shows 'No photos' with no camera", async ({ page }) => {
    await openDeviceTab(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    const labelPixels = () =>
      page.locator(".device-screen").evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext("2d")!.getImageData(0, 90, 240, 30).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 140 && d[i] > 80) n++; // gray label pixels
        return n;
      });
    await expect.poll(labelPixels).toBeGreaterThan(20); // "No photos", once the page has opened
  });

  test("thumbnails and the viewer show the board's photos, decoded on the board", async ({ page }) => {
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("status")).toHaveText("connected");
    await page.getByRole("button", { name: "Take picture" }).click();
    await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
    await openDeviceTab(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Pictures
    // Thumbnail 0 at (12, 38): the photo's red left band survives the center crop at its edge.
    await expect.poll(async () => isGreen(await pixel(page, 12 + 44, 38 + 32))).toBe(true);
    expect(isRed(await pixel(page, 12 + 5, 38 + 32))).toBe(true);
    await page.keyboard.press("Enter"); // viewer
    await expect.poll(async () => isGreen(await pixel(page, 180, 120))).toBe(true);
    expect(await regionHas(page, [70, 0, 120, 27], INK)).toBe(true); // "- <Month>, <day>, <year>"
  });

  test("an unreadable photo isn't re-requested in a loop", async ({ page }) => {
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Take picture" }).click();
    await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { fakeCamera: { failPixels: boolean } }).fakeCamera.failPixels = true;
    });
    await openDeviceTab(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Pictures (the thumbnail fails: a tile)
    await expect.poll(() => onPictures(page)).toBe(true); // opened (input is ignored while zooming)
    await page.keyboard.press("Enter"); // viewer (the image fails)
    await expect.poll(() => onViewer(page)).toBe(true);
    await page.waitForTimeout(1500);
    const requests = await page.evaluate(
      () => (window as unknown as { fakeCamera: { commands: number[] } }).fakeCamera.commands.filter((c) => c === 0x8a).length,
    );
    expect(requests).toBeLessThanOrEqual(2); // the thumbnail and the image, once each
  });

  test("the emulated shutter saves a photo on the board", async ({ page }) => {
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("status")).toHaveText("connected");
    await openDeviceTab(page);
    await page.keyboard.press("Enter"); // Camera
    await expect.poll(async () => isGreen(await pixel(page, 180, 120))).toBe(true); // live view
    await page.keyboard.press("Enter"); // shutter
    await page.keyboard.press("b");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Pictures
    await expect.poll(async () => isGreen(await pixel(page, 12 + 44, 38 + 32))).toBe(true);
    await page.getByRole("link", { name: "Camera" }).click();
    await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible(); // same photo, same list
  });

  test("Delete, then Confirm, deletes the photo on the board", async ({ page }) => {
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Take picture" }).click();
    await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
    await openDeviceTab(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Pictures
    await expect.poll(async () => isGreen(await pixel(page, 12 + 44, 38 + 32))).toBe(true);
    await page.keyboard.press("Enter"); // viewer
    await expect.poll(() => onViewer(page)).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Delete: turns into a red Confirm
    await expect.poll(async () => isRed(await pixel(page, 194, 214))).toBe(true);
    const files = () => page.evaluate(() => (window as unknown as { fakeCamera: { files: Map<string, Uint8Array> } }).fakeCamera.files.size);
    expect(await files()).toBe(1);
    await page.keyboard.press("Enter"); // Confirm
    await expect.poll(files).toBe(0);
    await expect.poll(() => onPictures(page)).toBe(true); // nothing left to view
    await page.getByRole("link", { name: "Camera" }).click();
    await expect(page.getByRole("heading", { name: "Photos (0)" })).toBeVisible();
  });
});

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// RGB565 → RGB888 the way the page converts it (bit replication).
function expand(r8: number, g8: number, b8: number) {
  const r = r8 >> 3, g = g8 >> 2, b = b8 >> 3;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
const LINE = expand(0xc9, 0xcd, 0xd2); // nav bar divider
const INK = expand(0x3a, 0x40, 0x48); // icons
const FIRST_THUMB = expand(0x8e, 0xc5, 0xe8); // Pictures page, first thumbnail

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
  await expect.poll(() => pixel(page, 22, 48)).toEqual(FIRST_THUMB);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); // below the grid: Back, bottom-left as on every page
  await page.keyboard.press("Enter");
  await expect.poll(() => pixel(page, 22, 48)).not.toEqual(FIRST_THUMB); // home again
});

test("the on-screen pad works like the keys", async ({ page }) => {
  await openDeviceTab(page);
  await page.getByRole("button", { name: "Right" }).click();
  await page.getByRole("button", { name: "Center" }).click();
  await expect.poll(() => pixel(page, 22, 48)).toEqual(FIRST_THUMB);
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
});

test("camera: A shoots, B lights the ring outside the display, Center returns home", async ({ page }) => {
  await openDeviceTab(page);
  const frame = page.locator(".device-frame");
  await page.getByRole("button", { name: "Center" }).click(); // open Camera
  await expect.poll(() => pixel(page, 5, 60)).toEqual([255, 255, 255]); // camera picture shown (zoom done)
  await page.getByRole("button", { name: "B" }).click();
  await expect(frame).toHaveAttribute("data-flash", "on");
  await expect.poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  await page.getByRole("button", { name: "A" }).click();
  await expect.poll(() => pixel(page, 120, 150)).toEqual([255, 255, 255]); // shutter blink on the panel
  await page.locator(".device-screen").focus();
  await page.keyboard.press("b"); // keys work too
  await expect(frame).toHaveAttribute("data-flash", "off");
  await page.getByRole("button", { name: "Center" }).click(); // MENU: back home
  await page.getByRole("button", { name: "Right" }).click();
  await page.getByRole("button", { name: "Center" }).click();
  await expect.poll(() => pixel(page, 22, 48)).toEqual(FIRST_THUMB); // Pictures opened from home
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

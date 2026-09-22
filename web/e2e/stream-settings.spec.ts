import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function connect(page: Page) {
  await page.getByLabel("Camera source").selectOption({ label: "Mock: test pattern" });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
}

const canvasSize = (page: Page) =>
  page.locator(".viewport canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);

const viewportRatio = (page: Page) =>
  page.locator(".viewport").evaluate((el) => el.clientWidth / el.clientHeight);

const measuredFps = async (page: Page) =>
  Number((await page.locator(".stats").textContent())?.match(/^(\d+) fps/)?.[1] ?? 0);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("defaults to 480×480 at 15 fps", async ({ page }) => {
  await expect(page.getByLabel("Resolution")).toHaveValue("480x480");
  await expect(page.getByLabel("Frame rate")).toHaveValue("15");
});

test("lists square and common resolutions and the fps options", async ({ page }) => {
  const resolutions = await page.getByLabel("Resolution").locator("option").allTextContents();
  expect(resolutions).toEqual(expect.arrayContaining(["240×240", "480×480", "720×720", "640×480", "1280×720", "1920×1080"]));
  const rates = await page.getByLabel("Frame rate").locator("option").allTextContents();
  expect(rates).toEqual(expect.arrayContaining(["24 fps", "30 fps", "60 fps"]));
});

test("changing resolution resizes the stream and viewport; photos stay at the best resolution", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Resolution").selectOption("1280x720");
  await expect.poll(() => canvasSize(page)).toEqual([1280, 720]);
  await expect.poll(() => viewportRatio(page)).toBeCloseTo(16 / 9, 1);

  // Photos use the camera's best resolution (the pattern's 1920x1080), whatever the stream size.
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>(".viewport canvas")!;
    return c.getContext("2d")!.getImageData(5, 5, 1, 1).data[3] === 255;
  });
  await page.getByRole("button", { name: "Take picture" }).click();
  await page.locator(".files li button").first().click();
  const img = page.getByRole("dialog").getByRole("img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1920, 1080]);
});

test("settings chosen before connecting are applied on connect", async ({ page }) => {
  await page.getByLabel("Resolution").selectOption("480x480");
  await page.getByLabel("Frame rate").selectOption("30");
  await connect(page);
  await expect.poll(() => canvasSize(page)).toEqual([480, 480]);
  await expect.poll(() => measuredFps(page), { timeout: 5000 }).toBeGreaterThanOrEqual(20);
});

test("frame rate changes the delivered fps", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Frame rate").selectOption("10");
  await expect.poll(() => measuredFps(page), { timeout: 5000 }).toBeLessThanOrEqual(11);
  await page.getByLabel("Frame rate").selectOption("30");
  await expect.poll(() => measuredFps(page), { timeout: 5000 }).toBeGreaterThanOrEqual(20);
});

// Size and top-left pixel of the newest photo, read from the image modal.
async function newestPhoto(page: Page) {
  await page.locator(".files li button").first().click();
  const img = page.getByRole("dialog").getByRole("img");
  await expect(img).toHaveJSProperty("complete", true);
  const result = await img.evaluate((el: HTMLImageElement) => {
    const canvas = new OffscreenCanvas(el.naturalWidth, el.naturalHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    return { size: [el.naturalWidth, el.naturalHeight], pixel: [...ctx.getImageData(5, 5, 1, 1).data.slice(0, 3)] };
  });
  await page.keyboard.press("Escape");
  return result;
}

test("settings changed while connecting are applied to the camera", async ({ page }) => {
  // The fake USB camera reports the stream size it was set to; a slow port stands in for the prompt.
  await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { fakeCamera: { connectDelayMs: number } }).fakeCamera.connectDelayMs = 1500;
  });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connecting");
  await page.getByLabel("Resolution").selectOption("1280x720");
  await expect(page.getByRole("status")).toHaveText("connected");
  expect(await page.evaluate(() => (window as unknown as { fakeCamera: { size: number[] } }).fakeCamera.size)).toEqual([1280, 720]);
});

test("a photo taken right after a resolution change is not blank", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Frame rate").selectOption("10"); // widen the gap between ticks
  await page.getByLabel("Resolution").selectOption("640x480");
  await page.getByRole("button", { name: "Take picture" }).click();
  const photo = await newestPhoto(page);
  expect(photo.size).toEqual([1920, 1080]); // photos use the best resolution
  // Test pattern's first bar is white; a cleared canvas would be black.
  expect(Math.min(...photo.pixel)).toBeGreaterThan(200);
});

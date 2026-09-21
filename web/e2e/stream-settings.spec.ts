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

test("defaults to 240×240 at 15 fps", async ({ page }) => {
  await expect(page.getByLabel("Resolution")).toHaveValue("240x240");
  await expect(page.getByLabel("Frame rate")).toHaveValue("15");
});

test("lists square and common resolutions and the fps options", async ({ page }) => {
  const resolutions = await page.getByLabel("Resolution").locator("option").allTextContents();
  expect(resolutions).toEqual(expect.arrayContaining(["240×240", "480×480", "720×720", "640×480", "1280×720", "1920×1080"]));
  const rates = await page.getByLabel("Frame rate").locator("option").allTextContents();
  expect(rates).toEqual(expect.arrayContaining(["24 fps", "30 fps", "60 fps"]));
});

test("changing resolution resizes the stream, viewport and photos", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Resolution").selectOption("1280x720");
  await expect.poll(() => canvasSize(page)).toEqual([1280, 720]);
  await expect.poll(() => viewportRatio(page)).toBeCloseTo(16 / 9, 1);

  // Photo is taken at the stream resolution.
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>(".viewport canvas")!;
    return c.getContext("2d")!.getImageData(5, 5, 1, 1).data[3] === 255;
  });
  await page.getByRole("button", { name: "Take picture" }).click();
  await page.locator(".files li button").first().click();
  const img = page.getByRole("dialog").getByRole("img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1280, 720]);
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

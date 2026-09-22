import { expect, test, type Page } from "@playwright/test";

async function connect(page: Page, source: string) {
  await page.goto("/");
  await page.getByLabel("Camera source").selectOption({ label: source });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
}

// Sum of RGB across the canvas; 0 means nothing has been drawn.
const canvasBrightness = (page: Page) =>
  page.locator(".viewport canvas").evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum;
  });

for (const source of ["Mock: test pattern", "Mock: webcam"]) {
  test(`live preview renders frames from ${source}`, async ({ page }) => {
    await connect(page, source);
    await expect.poll(() => canvasBrightness(page)).toBeGreaterThan(0);
    await expect(page.locator(".stats")).toHaveText(/^[1-9]\d* fps actual$/, { timeout: 5000 });
  });
}

test("disconnect clears the preview and disables the shutter", async ({ page }) => {
  await connect(page, "Mock: test pattern");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator(".viewport").getByText("No camera connected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Take picture" })).toBeDisabled();
  expect(await canvasBrightness(page)).toBe(0);
});

// Test pattern bars run white (left) to blue (right), so a flip swaps the top-left corner color.
const topLeftPixel = (page: Page) =>
  page.locator(".viewport canvas").evaluate((canvas: HTMLCanvasElement) => [
    ...canvas.getContext("2d")!.getImageData(5, 5, 1, 1).data.slice(0, 3),
  ]);

test("flip button mirrors the preview and persists across reconnects", async ({ page }) => {
  await connect(page, "Mock: test pattern");
  const flip = page.getByRole("button", { name: "Flip horizontally" });
  await expect.poll(() => topLeftPixel(page)).toEqual([255, 255, 255]);

  await flip.click();
  await expect(flip).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => topLeftPixel(page)).toEqual([0, 0, 255]);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => topLeftPixel(page)).toEqual([0, 0, 255]);

  await flip.click();
  await expect(flip).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => topLeftPixel(page)).toEqual([255, 255, 255]);
});

test("double-clicking flip toggles twice and stays in sync", async ({ page }) => {
  await connect(page, "Mock: test pattern");
  const flip = page.getByRole("button", { name: "Flip horizontally" });
  await flip.dblclick();
  await expect(flip).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => topLeftPixel(page)).toEqual([255, 255, 255]);
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Camera source").selectOption({ label: "Mock: test pattern" });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
});

test("taking a picture adds a YYYYMMDD-HHMMSS.jpg file", async ({ page }) => {
  await expect(page.getByText("No photos yet")).toBeVisible();
  await page.getByRole("button", { name: "Take picture" }).click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  await expect(page.locator(".files li .file-name")).toHaveText(/^\d{8}-\d{6}(_\d+)?\.jpg$/);
});

test("modal opens the photo, navigates, and closes", async ({ page }) => {
  const shutter = page.getByRole("button", { name: "Take picture" });
  await shutter.click();
  await shutter.click();
  await expect(page.getByRole("heading", { name: "Photos (2)" })).toBeVisible();
  const [newest, oldest] = await page.locator(".files li .file-name").allTextContents();

  await page.getByRole("button", { name: newest }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveJSProperty("complete", true);
  expect(await dialog.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
  await expect(dialog.getByRole("button", { name: "Previous photo" })).toBeDisabled();

  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", oldest);
  await expect(dialog.getByRole("button", { name: "Next photo" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute("download", oldest);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("photos persist across reconnects like an SD card", async ({ page }) => {
  await page.getByRole("button", { name: "Take picture" }).click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Photos (0)" })).toBeVisible();
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
});

test("photos taken while flipped are mirrored", async ({ page }) => {
  await page.getByRole("button", { name: "Flip horizontally" }).click();
  // Wait until a mirrored frame (blue bar on the left) is on screen.
  await expect
    .poll(() =>
      page
        .locator(".viewport canvas")
        .evaluate((c: HTMLCanvasElement) => [...c.getContext("2d")!.getImageData(5, 5, 1, 1).data]),
    )
    .toEqual([0, 0, 255, 255]);
  await page.getByRole("button", { name: "Take picture" }).click();
  await page.locator(".files li button").first().click();
  const img = page.getByRole("dialog").getByRole("img");
  await expect(img).toHaveJSProperty("complete", true);
  const [r, g, b] = await img.evaluate((el: HTMLImageElement) => {
    const canvas = new OffscreenCanvas(el.naturalWidth, el.naturalHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(5, 5, 1, 1).data.slice(0, 3)];
  });
  // JPEG is lossy, so check "blue-ish" rather than exact values.
  expect(b).toBeGreaterThan(200);
  expect(r + g).toBeLessThan(80);
});

import path from "node:path";
import { expect, test } from "@playwright/test";

// The fake ESP32 speaks the camera protocol but not the ROM bootloader's, so esptool fails
// against it: this covers everything around the flash itself (which is verified on hardware).
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
  await page.goto("/");
});

test("Update firmware sits in the header on every tab", async ({ page }) => {
  await expect(page.locator(".bar").getByRole("button", { name: "Update firmware" })).toBeEnabled();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.locator(".bar").getByRole("button", { name: "Update firmware" })).toBeEnabled();
});

test("the header stays one row with the status at the far right, even with a result shown", async ({ page }) => {
  const bar = page.locator(".bar");
  const before = (await bar.boundingBox())!.height;
  await page.getByRole("button", { name: "Update firmware" }).click();
  await expect(page.locator(".firmware-result")).toHaveText(/^Firmware update failed: /, { timeout: 30_000 });
  expect((await bar.boundingBox())!.height).toBe(before); // no extra row
  const status = (await page.getByRole("status").boundingBox())!;
  for (const el of await bar.locator(":scope > *, .bar-controls > *").all()) {
    const b = (await el.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(status.x + status.width + 0.5); // nothing right of the status
    expect(Math.abs(b.y + b.height / 2 - (status.y + status.height / 2))).toBeLessThan(12); // same row
  }
});

test("frees the camera's port first, then reports a failed flash and recovers", async ({ page }) => {
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
  await page.getByRole("button", { name: "Update firmware" }).click();
  await expect(page.getByRole("status")).toHaveText("disconnected"); // the port can only have one user
  await expect(page.locator(".firmware-result")).toHaveText(/^Firmware update failed: /, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Update firmware" })).toBeEnabled(); // ready to retry
});

test("Update firmware waits while a connection is being set up", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { fakeCamera: { silent: boolean } }).fakeCamera.silent = true; // connect hangs until timeout
  });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connecting");
  await expect(page.getByRole("button", { name: "Update firmware" })).toBeDisabled();
});

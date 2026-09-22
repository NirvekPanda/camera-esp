import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// A fake ESP32 on navigator.serial that speaks the firmware's protocol (see fake-serial-device.js).
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(__dirname, "fake-serial-device.js") });
  await page.goto("/");
});

declare global {
  interface Window {
    fakeCamera: {
      silent: boolean;
      dropNextReply: boolean;
      oldFirmware: boolean;
      streaming: boolean;
      sensor: "OV3660" | "OV2640";
      mirrored: boolean;
      vflip: boolean;
      size: [number, number];
      fps: number;
      clock: number | null;
      unplug(): void;
    };
  }
}

// Scoped to the header: Next.js adds its own role="alert" route announcer to the page.
const errorBanner = (page: Page) => page.locator(".bar").getByRole("alert");

async function connectUsb(page: Page) {
  await expect(page.getByLabel("Camera source")).toHaveValue("usb"); // USB is the default source
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("connected");
}

// RGB at a point in the preview canvas, as a fraction of its size.
const previewPixel = (page: Page, fx: number, fy: number) =>
  page.locator(".viewport canvas").evaluate(
    (c: HTMLCanvasElement, [fx, fy]) => [...c.getContext("2d")!.getImageData(c.width * fx, c.height * fy, 1, 1).data.slice(0, 3)],
    [fx, fy],
  );
const isRed = async (pixel: Promise<number[]>) => {
  const [r, g, b] = await pixel;
  return r > 200 && g < 60 && b < 60;
};
const isGreen = async (pixel: Promise<number[]>) => {
  const [r, g, b] = await pixel;
  return g > 200 && r < 60 && b < 60;
};

test("connects over USB, syncs the clock and streams frames", async ({ page }) => {
  await connectUsb(page);
  const clock = await page.evaluate(() => window.fakeCamera.clock);
  const expected = Date.now() / 1000 - new Date().getTimezoneOffset() * 60; // local wall-clock seconds
  expect(Math.abs((clock ?? 0) - expected)).toBeLessThan(5);
  expect(await page.evaluate(() => window.fakeCamera.streaming)).toBe(true);
  await expect.poll(() => isRed(previewPixel(page, 0.05, 0.5))).toBe(true);
  await expect(page.locator(".stats")).toHaveText(/^[1-9]\d* fps actual$/, { timeout: 5000 });
});

test("applies resolution, fps and mirror on the device", async ({ page }) => {
  await page.getByLabel("Frame rate").selectOption("30"); // before connecting
  await connectUsb(page);
  expect(await page.evaluate(() => window.fakeCamera.fps)).toBe(30);

  await page.getByLabel("Resolution").selectOption("1280x720");
  await expect.poll(() => page.evaluate(() => window.fakeCamera.size)).toEqual([1280, 720]);

  await page.getByRole("button", { name: "Flip horizontally" }).click();
  await expect.poll(() => page.evaluate(() => window.fakeCamera.mirrored)).toBe(true);
  await page.getByRole("button", { name: "Flip vertically" }).click();
  await expect.poll(() => page.evaluate(() => window.fakeCamera.vflip)).toBe(true);
});

test("streams the 1920×1080 default on an OV3660", async ({ page }) => {
  await connectUsb(page);
  expect(await page.evaluate(() => window.fakeCamera.size)).toEqual([1920, 1080]);
  await expect(page.getByLabel("Resolution")).toHaveValue("1920x1080");
  await expect(errorBanner(page)).toHaveCount(0);
});

test("an OV2640 connects at 240×240 when it can't do the 1920×1080 default", async ({ page }) => {
  await page.evaluate(() => {
    window.fakeCamera.sensor = "OV2640";
  });
  await connectUsb(page);
  expect(await page.evaluate(() => window.fakeCamera.size)).toEqual([240, 240]);
  await expect(page.getByLabel("Resolution")).toHaveValue("240x240");
  await expect(errorBanner(page)).toHaveText("1920×1080 isn't supported by this camera sensor");
});

test("center-crops the VGA frames the device sends for 480×480", async ({ page }) => {
  await connectUsb(page);
  await page.getByLabel("Resolution").selectOption("480x480");
  await expect.poll(() => page.evaluate(() => window.fakeCamera.size)).toEqual([640, 480]);
  // The frame's left 25% (160px) is red; cropping 80px off each side leaves a red band of 80/480.
  await expect.poll(() => isRed(previewPixel(page, 0.08, 0.5))).toBe(true);
  await expect.poll(() => isGreen(previewPixel(page, 0.25, 0.5))).toBe(true);
  expect(await page.locator(".viewport canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([480, 480]);
});

test("shows the sensor's error for an unsupported resolution and keeps the old one", async ({ page }) => {
  await page.evaluate(() => {
    window.fakeCamera.sensor = "OV2640";
  });
  await page.getByLabel("Resolution").selectOption("640x480");
  await connectUsb(page);
  await page.getByLabel("Resolution").selectOption("1920x1080");
  await expect(errorBanner(page)).toHaveText("1920×1080 isn't supported by this camera sensor");
  await expect(page.getByLabel("Resolution")).toHaveValue("640x480");
});

test("captures to the device, lists and opens the photo", async ({ page }) => {
  await connectUsb(page);
  await page.getByRole("button", { name: "Take picture" }).click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  const name = await page.locator(".files li .file-name").textContent();
  expect(name).toMatch(/^\d{8}-\d{6}\.jpg$/);

  await page.getByRole("button", { name: name! }).click();
  const img = page.getByRole("dialog").getByRole("img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1920);
});

test("unplugging shows an error and returns to disconnected", async ({ page }) => {
  await connectUsb(page);
  await page.evaluate(() => window.fakeCamera.unplug());
  await expect(page.getByRole("status")).toHaveText("disconnected");
  await expect(errorBanner(page)).toHaveText("Camera disconnected: The device has been lost.");
});

test("disconnect stops the stream on the device", async ({ page }) => {
  await connectUsb(page);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("status")).toHaveText("disconnected");
  await expect.poll(() => page.evaluate(() => window.fakeCamera.streaming)).toBe(false);
});

test("a lost reply disconnects cleanly instead of mismatching later replies", async ({ page }) => {
  await connectUsb(page);
  await page.evaluate(() => {
    window.fakeCamera.dropNextReply = true;
  });
  await page.getByLabel("Frame rate").selectOption("30"); // this command's reply is lost
  await page.getByLabel("Frame rate").selectOption("10"); // queued behind it; must not take its reply
  await expect(page.getByRole("status")).toHaveText("disconnected", { timeout: 8000 });
  await expect(errorBanner(page)).toContainText("Camera stopped responding");
});

test("tells the user to reflash when the board runs older firmware", async ({ page }) => {
  await page.evaluate(() => {
    window.fakeCamera.oldFirmware = true;
  });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(errorBanner(page)).toHaveText("Camera firmware is out of date");
  await expect(page.getByRole("status")).toHaveText("disconnected");
});

test("explains a board without camera firmware", async ({ page }) => {
  await page.evaluate(() => {
    window.fakeCamera.silent = true;
  });
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(errorBanner(page)).toHaveText("No camera firmware detected", { timeout: 8000 });
  await expect(page.getByRole("status")).toHaveText("disconnected");
});

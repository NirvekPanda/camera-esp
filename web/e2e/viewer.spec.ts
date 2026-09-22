import { expect, test, type Page } from "@playwright/test";

const viewport = (page: Page) => page.locator(".viewport");
const handle = (page: Page) => page.getByRole("slider", { name: "Viewer size" });

async function box(page: Page) {
  const b = await viewport(page).boundingBox();
  if (!b) throw new Error("viewer not visible");
  return b;
}

// Drag the resize handle by (dx, dy) with a real pointer.
async function dragHandle(page: Page, dx: number, dy: number) {
  const h = await handle(page).boundingBox();
  if (!h) throw new Error("handle not visible");
  const [x, y] = [h.x + h.width / 2, h.y + h.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}

const mainWidth = (page: Page) => page.locator("main").evaluate((el) => el.clientWidth);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("starts 640px wide in the square shape of the 480×480 default, centered", async ({ page }) => {
  const b = await box(page);
  const main = (await page.locator("main").boundingBox())!;
  expect(b.x + b.width / 2).toBeCloseTo(main.x + main.width / 2, 0);
  expect(b.width).toBeCloseTo(640, 0);
  expect(b.height).toBeCloseTo(640, 0);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
});

test("dragging the corner resizes the centered viewer, keeping its aspect ratio", async ({ page }) => {
  await page.getByLabel("Resolution").selectOption("1920x1080");
  await dragHandle(page, 80, 90); // centered: 160px wider moves the corner 80px right, 90px down
  const b = await box(page);
  expect(b.width).toBeCloseTo(800, 0);
  expect(b.height).toBeCloseTo(450, 0);
  // Settings row and viewer stay the same width.
  expect((await page.locator(".stream-settings").boundingBox())!.width).toBeCloseTo(800, 0);
});

test("clamps to the minimum and to the available width", async ({ page }) => {
  await dragHandle(page, -1000, -1000);
  expect((await box(page)).width).toBeCloseTo(360, 0);
  await dragHandle(page, 3000, 3000);
  expect((await box(page)).width).toBeCloseTo(Math.min(1280, await mainWidth(page)), 0);
});

test("resizes from the keyboard", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "660");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "560");
  await page.keyboard.press("Home");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "360");
  expect((await box(page)).width).toBeCloseTo(360, 0);
});

test("camera buttons stay inside the viewer and clear of the handle at the minimum size", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("Home");
  const v = await box(page);
  const grip = (await handle(page).boundingBox())!;
  for (const name of ["Take picture", "Flip horizontally", "Flip vertically"]) {
    const b = (await page.getByRole("button", { name }).boundingBox())!;
    expect(b.x + b.width, name).toBeLessThanOrEqual(v.x + v.width);
    expect(b.y + b.height, `${name} clears the resize handle`).toBeLessThan(grip.y - 4);
  }
  // ...and the vertical flip sits below the horizontal one.
  const h = (await page.getByRole("button", { name: "Flip horizontally" }).boundingBox())!;
  const vf = (await page.getByRole("button", { name: "Flip vertically" }).boundingBox())!;
  expect(vf.y).toBeGreaterThan(h.y + h.height - 1);
});

test("vertical flip turns the image upside down", async ({ page }) => {
  await page.getByLabel("Camera source").selectOption({ label: "Mock: test pattern" });
  await page.getByRole("button", { name: "Connect" }).click();
  const topLeft = () =>
    page.locator(".viewport canvas").evaluate((c: HTMLCanvasElement) => [...c.getContext("2d")!.getImageData(5, 5, 1, 1).data.slice(0, 3)]);
  await expect.poll(topLeft).toEqual([255, 255, 255]); // white color bar on top
  const flip = page.getByRole("button", { name: "Flip vertically" });
  await flip.click();
  await expect(flip).toHaveAttribute("aria-pressed", "true");
  await expect.poll(topLeft).toEqual([17, 17, 17]); // the dark bottom band is now on top
});

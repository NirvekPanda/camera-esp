import { expect, test } from "@playwright/test";

// `make build` exports these for flashing over WebSerial; the static site must serve them.
test("serves the firmware manifest and a flashable ESP32-S3 image", async ({ request }) => {
  const manifest = await (await request.get("/firmware/manifest.json")).json();
  expect(manifest).toMatchObject({ name: "camera-esp", chip: "ESP32-S3", image: "camera-esp.bin", offset: 0 });
  expect(manifest.version).toMatch(/^[0-9a-f]{7,}(-dirty)?$/);

  const image = await request.get(`/firmware/${manifest.image}`);
  expect(image.ok()).toBe(true);
  const bytes = await image.body();
  expect(bytes.length).toBeGreaterThan(100_000);
  expect(bytes[0]).toBe(0xe9); // ESP image magic: the merged image starts with the bootloader at 0x0
});

import { coverCrop } from "./camera/settings";

/** RGBA8888 → RGB565 (drops the low bits, like the camera's own RGB565 output). */
export function rgbaToRgb565(src: Uint8ClampedArray, dst: Uint16Array) {
  for (let i = 0; i < dst.length; i++) {
    dst[i] = ((src[4 * i] >> 3) << 11) | ((src[4 * i + 1] >> 2) << 5) | (src[4 * i + 2] >> 3);
  }
}

/** RGB565 → RGBA8888 with bit replication, so full white/black map to 255/0. */
export function rgb565ToRgba(src: Uint16Array, dst: Uint8ClampedArray) {
  for (let i = 0; i < src.length; i++) {
    const p = src[i];
    const r = p >> 11, g = (p >> 5) & 0x3f, b = p & 0x1f;
    dst[4 * i] = (r << 3) | (r >> 2);
    dst[4 * i + 1] = (g << 2) | (g >> 4);
    dst[4 * i + 2] = (b << 3) | (b >> 2);
    dst[4 * i + 3] = 255;
  }
}

/** Decodes an image and center-crops/scales it to width x height RGB565 (in the browser). */
export async function imageToRgb565(image: Blob, width: number, height: number): Promise<Uint16Array> {
  const bitmap = await createImageBitmap(image);
  const ctx = new OffscreenCanvas(width, height).getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported");
  const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height, width, height);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();
  const out = new Uint16Array(width * height);
  rgbaToRgb565(ctx.getImageData(0, 0, width, height).data, out);
  return out;
}

export interface Resolution {
  width: number;
  height: number;
}

// Square sizes first (240×240 matches the SPI display), then common sensor frame sizes.
// On the device, 480×480 and 720×720 are center crops of VGA and HD.
export const RESOLUTIONS: readonly Resolution[] = [
  { width: 240, height: 240 },
  { width: 480, height: 480 },
  { width: 720, height: 720 },
  { width: 320, height: 240 }, // QVGA
  { width: 640, height: 480 }, // VGA
  { width: 800, height: 600 }, // SVGA
  { width: 1280, height: 720 }, // HD
  { width: 1600, height: 1200 }, // UXGA, OV2640 max
  { width: 1920, height: 1080 }, // FHD, OV3660/OV5640
];

export const FPS_OPTIONS: readonly number[] = [10, 15, 24, 30, 60];

export const DEFAULT_RESOLUTION = RESOLUTIONS[0];
export const DEFAULT_FPS = 15;

export const resolutionKey = ({ width, height }: Resolution) => `${width}x${height}`;
export const resolutionLabel = ({ width, height }: Resolution) => `${width}×${height}`;

/** Source rectangle that center-crops a srcW×srcH image to the dstW×dstH aspect ratio (object-fit: cover). */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.min(srcW / dstW, srcH / dstH);
  const sw = dstW * scale;
  const sh = dstH * scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

export function parseResolution(key: string): Resolution {
  const found = RESOLUTIONS.find((r) => resolutionKey(r) === key);
  if (!found) throw new Error(`Unsupported resolution: ${key}`);
  return found;
}

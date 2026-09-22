import { describe, expect, it } from "vitest";
import {
  DEFAULT_FPS,
  coverCrop,
  DEFAULT_RESOLUTION,
  FALLBACK_RESOLUTION,
  FPS_OPTIONS,
  RESOLUTIONS,
  parseResolution,
  resolutionKey,
  resolutionLabel,
} from "./settings";

describe("resolutions", () => {
  it("includes the square sizes and defaults to 480×480", () => {
    const keys = RESOLUTIONS.map(resolutionKey);
    expect(keys).toEqual(expect.arrayContaining(["240x240", "480x480", "720x720"]));
    expect(resolutionKey(DEFAULT_RESOLUTION)).toBe("480x480");
  });

  it("falls back to the 240×240 display size every sensor supports", () => {
    expect(resolutionKey(FALLBACK_RESOLUTION)).toBe("240x240");
  });

  it("has unique keys", () => {
    const keys = RESOLUTIONS.map(resolutionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("round-trips every key", () => {
    for (const r of RESOLUTIONS) expect(parseResolution(resolutionKey(r))).toBe(r);
  });

  it("rejects unknown keys", () => {
    expect(() => parseResolution("123x456")).toThrow("Unsupported resolution");
  });

  it("labels with a multiplication sign", () => {
    expect(resolutionLabel({ width: 1280, height: 720 })).toBe("1280×720");
  });
});

describe("coverCrop", () => {
  it("crops the sides of a wider image", () => {
    expect(coverCrop(640, 480, 480, 480)).toEqual({ sx: 80, sy: 0, sw: 480, sh: 480 });
  });

  it("crops top and bottom of a taller image", () => {
    expect(coverCrop(480, 640, 480, 480)).toEqual({ sx: 0, sy: 80, sw: 480, sh: 480 });
  });

  it("takes the full image when aspect ratios match, whatever the scale", () => {
    expect(coverCrop(1280, 720, 640, 360)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it("crops HD to the 720×720 square the device can't produce natively", () => {
    expect(coverCrop(1280, 720, 720, 720)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
  });
});

describe("fps options", () => {
  it("offers 24, 30 and 60 fps and includes the default", () => {
    expect(FPS_OPTIONS).toEqual(expect.arrayContaining([24, 30, 60, DEFAULT_FPS]));
  });
});

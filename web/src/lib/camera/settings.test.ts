import { describe, expect, it } from "vitest";
import {
  DEFAULT_FPS,
  DEFAULT_RESOLUTION,
  FPS_OPTIONS,
  RESOLUTIONS,
  parseResolution,
  resolutionKey,
  resolutionLabel,
} from "./settings";

describe("resolutions", () => {
  it("includes the square sizes and defaults to the 240×240 display size", () => {
    const keys = RESOLUTIONS.map(resolutionKey);
    expect(keys).toEqual(expect.arrayContaining(["240x240", "480x480", "720x720"]));
    expect(resolutionKey(DEFAULT_RESOLUTION)).toBe("240x240");
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

describe("fps options", () => {
  it("offers 24, 30 and 60 fps and includes the default", () => {
    expect(FPS_OPTIONS).toEqual(expect.arrayContaining([24, 30, 60, DEFAULT_FPS]));
  });
});

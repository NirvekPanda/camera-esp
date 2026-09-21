import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWER_WIDTH,
  MAX_VIEWER_WIDTH,
  MIN_VIEWER_WIDTH,
  clampViewerWidth,
  dragWidth,
} from "./viewer-size";

describe("clampViewerWidth", () => {
  it("keeps widths inside the min/max range", () => {
    expect(clampViewerWidth(100)).toBe(MIN_VIEWER_WIDTH);
    expect(clampViewerWidth(5000)).toBe(MAX_VIEWER_WIDTH);
    expect(clampViewerWidth(700.4)).toBe(700);
  });

  it("never exceeds the available space, even below the minimum on tiny screens", () => {
    expect(clampViewerWidth(1000, 800)).toBe(800);
    expect(clampViewerWidth(400, 300)).toBe(300);
  });

  it("has a default inside the range", () => {
    expect(clampViewerWidth(DEFAULT_VIEWER_WIDTH)).toBe(DEFAULT_VIEWER_WIDTH);
  });
});

describe("dragWidth", () => {
  it("doesn't change without movement", () => {
    expect(dragWidth(640, 0, 0, 16 / 9)).toBeCloseTo(640);
  });

  it("follows a drag along the viewer's diagonal exactly", () => {
    // 16:9: moving the corner by (+160, +90) is exactly 160px wider.
    expect(dragWidth(640, 160, 90, 16 / 9)).toBeCloseTo(800);
    expect(dragWidth(640, -160, -90, 16 / 9)).toBeCloseTo(480);
  });

  it("uses both axes for off-diagonal drags", () => {
    // Square viewer: horizontal-only or vertical-only drags grow it by half the distance.
    expect(dragWidth(400, 100, 0, 1)).toBeCloseTo(450);
    expect(dragWidth(400, 0, 100, 1)).toBeCloseTo(450);
  });
});

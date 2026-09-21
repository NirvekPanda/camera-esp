import { describe, expect, it } from "vitest";
import { parsePhotoDate, photoName } from "./filename";

describe("photoName", () => {
  it("formats as YYYYMMDD-HHMMSS.jpg with zero padding", () => {
    expect(photoName(new Date(2026, 0, 5, 3, 4, 9))).toBe("20260105-030409.jpg");
  });

  it("contains no characters FAT32 forbids", () => {
    expect(photoName(new Date())).not.toMatch(/[:\\/*?"<>|]/);
  });

  it("sorts chronologically as a string", () => {
    const older = photoName(new Date(2025, 11, 31, 23, 59, 59));
    const newer = photoName(new Date(2026, 0, 1, 0, 0, 0));
    expect(older < newer).toBe(true);
  });

  it("sorts same-second duplicates after the original", () => {
    expect("20260921-142305_2.jpg" > "20260921-142305.jpg").toBe(true);
  });
});

describe("parsePhotoDate", () => {
  it("round-trips photoName", () => {
    const date = new Date(2026, 8, 21, 14, 23, 5);
    expect(parsePhotoDate(photoName(date))).toEqual(date);
  });

  it("parses duplicate-suffixed names", () => {
    expect(parsePhotoDate("20260921-142305_2.jpg")).toEqual(new Date(2026, 8, 21, 14, 23, 5));
  });

  it("returns null for other names", () => {
    expect(parsePhotoDate("IMG_0001.jpg")).toBeNull();
  });
});

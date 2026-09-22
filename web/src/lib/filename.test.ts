import { describe, expect, it } from "vitest";
import { duplicateName, newestFirst, parsePhotoDate, photoName } from "./filename";

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
});

describe("newestFirst", () => {
  const files = (...names: string[]) => names.map((name) => ({ name }));

  it("orders by timestamp, newest first", () => {
    const sorted = newestFirst(files("20260101-000000.jpg", "20261231-235959.jpg", "20260615-120000.jpg"));
    expect(sorted.map((f) => f.name)).toEqual(["20261231-235959.jpg", "20260615-120000.jpg", "20260101-000000.jpg"]);
  });

  it("puts same-second duplicates above the original, highest suffix first", () => {
    const base = "20260921-142305.jpg";
    const names = [base, duplicateName(base, 2), duplicateName(base, 10), duplicateName(base, 9)];
    expect(newestFirst(files(...names)).map((f) => f.name)).toEqual([
      "20260921-142305_10.jpg",
      "20260921-142305_09.jpg",
      "20260921-142305_02.jpg",
      "20260921-142305.jpg",
    ]);
  });

  it("puts undated names (saved before the clock was set) after dated ones", () => {
    const sorted = newestFirst(files("IMG_0001.jpg", "20250101-000000.jpg", "IMG_0002.jpg", "20260101-000000.jpg"));
    expect(sorted.map((f) => f.name)).toEqual(["20260101-000000.jpg", "20250101-000000.jpg", "IMG_0002.jpg", "IMG_0001.jpg"]);
  });

  it("does not mutate its input", () => {
    const input = files("a", "b");
    newestFirst(input);
    expect(input.map((f) => f.name)).toEqual(["a", "b"]);
  });
});

describe("parsePhotoDate", () => {
  it("round-trips photoName", () => {
    const date = new Date(2026, 8, 21, 14, 23, 5);
    expect(parsePhotoDate(photoName(date))).toEqual(date);
  });

  it("parses duplicate-suffixed names", () => {
    expect(parsePhotoDate("20260921-142305_02.jpg")).toEqual(new Date(2026, 8, 21, 14, 23, 5));
  });

  it("returns null for other names", () => {
    expect(parsePhotoDate("IMG_0001.jpg")).toBeNull();
  });
});

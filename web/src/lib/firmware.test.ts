import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkImage, parseManifest, updateFirmware, type Flasher } from "./firmware";

const manifest = { name: "camera-esp", version: "abc1234", chip: "ESP32-S3", board: "x", image: "camera-esp.bin", offset: 0 };
const image = (size = 200_000) => {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xe9; // ESP image magic
  return bytes;
};

describe("parseManifest", () => {
  it("accepts the manifest `make build` exports", () => {
    const committed = JSON.parse(readFileSync(path.join(__dirname, "../../public/firmware/manifest.json"), "utf8"));
    expect(parseManifest(committed)).toMatchObject({ chip: "ESP32-S3", offset: 0 });
  });

  it("rejects firmware for another chip", () => {
    expect(() => parseManifest({ ...manifest, chip: "ESP32" })).toThrow("Firmware is for ESP32, not ESP32-S3");
  });

  it("rejects incomplete manifests", () => {
    expect(() => parseManifest({ ...manifest, image: undefined })).toThrow("Invalid firmware manifest");
    expect(() => parseManifest({ ...manifest, offset: -1 })).toThrow("Invalid firmware manifest");
    expect(() => parseManifest(null)).toThrow("Invalid firmware manifest");
  });
});

describe("checkImage", () => {
  it("accepts an ESP image and the committed build", () => {
    expect(() => checkImage(image())).not.toThrow();
    expect(() => checkImage(new Uint8Array(readFileSync(path.join(__dirname, "../../public/firmware/camera-esp.bin"))))).not.toThrow();
  });

  it("rejects files that aren't ESP images", () => {
    expect(() => checkImage(new Uint8Array(200_000))).toThrow("Invalid firmware image");
    expect(() => checkImage(image(100))).toThrow("Invalid firmware image");
  });
});

describe("updateFirmware", () => {
  const port = {} as SerialPort;
  const fetchFile = vi.fn(async (name: string) =>
    name === "manifest.json" ? new TextEncoder().encode(JSON.stringify(manifest)) : image(),
  );

  it("frees the camera's port, then flashes the image at its offset with progress", async () => {
    const calls: string[] = [];
    const flasher: Flasher = async (p, bytes, offset, onProgress) => {
      calls.push(`flash:${offset}:${bytes.length}`);
      expect(p).toBe(port);
      onProgress(0.5);
      onProgress(1);
    };
    const progress: number[] = [];
    const version = await updateFirmware({
      release: async () => void calls.push("release"),
      requestPort: async () => (calls.push("port"), port),
      fetchFile,
      flasher,
      onProgress: (p) => progress.push(p),
    });
    expect(calls).toEqual(["release", "port", "flash:0:200000"]);
    expect(progress).toEqual([0, 0.5, 1]);
    expect(version).toBe("abc1234");
  });

  it("checks the firmware before touching the board", async () => {
    const flasher = vi.fn<Flasher>();
    await expect(
      updateFirmware({
        release: async () => {},
        requestPort: async () => port,
        fetchFile: async (name) => (name === "manifest.json" ? new TextEncoder().encode(JSON.stringify(manifest)) : new Uint8Array(10)),
        flasher,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Invalid firmware image");
    expect(flasher).not.toHaveBeenCalled();
  });
});

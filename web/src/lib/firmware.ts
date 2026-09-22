/// <reference types="w3c-web-serial" />
// Flashes the camera over WebSerial with the image `make build` exports to /firmware/.

export interface FirmwareManifest {
  name: string;
  version: string;
  chip: string;
  image: string; // file name next to the manifest
  offset: number; // flash address; 0 for the merged image
}

const CHIP = "ESP32-S3";
const ESP_IMAGE_MAGIC = 0xe9;
const MIN_IMAGE_BYTES = 64 * 1024; // bootloader + partitions + app: anything smaller is not a build

export function parseManifest(json: unknown): FirmwareManifest {
  const m = json as Partial<FirmwareManifest> | null;
  const valid =
    typeof m?.version === "string" &&
    typeof m.chip === "string" &&
    typeof m.image === "string" &&
    Number.isInteger(m.offset) &&
    (m.offset ?? -1) >= 0;
  if (!valid) throw new Error("Invalid firmware manifest");
  if (m.chip !== CHIP) throw new Error(`Firmware is for ${m.chip}, not ${CHIP}`);
  return m as FirmwareManifest;
}

export function checkImage(image: Uint8Array) {
  if (image.length < MIN_IMAGE_BYTES || image[0] !== ESP_IMAGE_MAGIC) throw new Error("Invalid firmware image");
}

/** Writes image at offset and reboots the board; onProgress gets 0..1. */
export type Flasher = (port: SerialPort, image: Uint8Array, offset: number, onProgress: (done: number) => void) => Promise<void>;

interface UpdateOptions {
  release(): Promise<void>; // frees the serial port if the camera is connected
  requestPort(): Promise<SerialPort>;
  fetchFile(name: string): Promise<Uint8Array>;
  flasher: Flasher;
  onProgress(done: number): void;
}

/** Validates the firmware first, then frees the port and flashes. Returns the installed version. */
export async function updateFirmware({ release, requestPort, fetchFile, flasher, onProgress }: UpdateOptions) {
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await fetchFile("manifest.json"))));
  const image = await fetchFile(manifest.image);
  checkImage(image);
  await release();
  const port = await requestPort();
  onProgress(0);
  await flasher(port, image, manifest.offset, onProgress);
  return manifest.version;
}

export async function fetchFirmwareFile(name: string) {
  const res = await fetch(`/firmware/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't download ${name} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** esptool-js: enters the ROM bootloader, writes the merged image, hard-resets into the new firmware. */
export const esptoolFlasher: Flasher = async (port, image, offset, onProgress) => {
  const { ESPLoader, Transport } = await import("esptool-js"); // loaded only when updating
  const transport = new Transport(port);
  try {
    const loader = new ESPLoader({ transport, baudrate: 921600 }); // USB Serial/JTAG ignores the rate
    await loader.main();
    await loader.writeFlash({
      fileArray: [{ data: image, address: offset }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (_file, written, total) => onProgress(written / total),
    });
    await loader.after("hard_reset");
  } finally {
    await transport.disconnect();
  }
};

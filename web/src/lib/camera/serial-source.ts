/// <reference types="w3c-web-serial" />
import { PacketParser, PacketType, encodePacket, u16Pair, u32, u8, type Packet } from "./protocol";
import type { Resolution } from "./settings";
import type { CameraSource, FileEntry, FrameListener } from "./types";

// XIAO ESP32-S3 USB IDs: Espressif's built-in USB Serial/JTAG (303A:1001) runs the camera firmware
// (USB CDC on boot); Seeed's IDs (2886:0056/8056) appear with TinyUSB firmware or the bootloader.
export const USB_FILTERS: SerialPortFilter[] = [{ usbVendorId: 0x303a }, { usbVendorId: 0x2886 }];

const REQUEST_TIMEOUT_MS = 5000;
const FILE_TIMEOUT_MS = 30000;
const NO_REPLY = "Camera stopped responding";
const NO_FIRMWARE = "No camera firmware detected";

interface Waiter {
  expect: number;
  resolve(payload: Uint8Array<ArrayBuffer>): void;
  reject(error: Error): void;
}

interface RequestOptions {
  expect?: number;
  timeoutMs?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The ESP32 has no timezone; sending local wall-clock time lets it name photos in local time.
const localEpochSeconds = () => Math.floor(Date.now() / 1000) - new Date().getTimezoneOffset() * 60;

// Firmware older than the site answers new commands with "Unknown command 0x..".
const deviceError = (message: string) =>
  new Error(message.startsWith("Unknown command") ? "Camera firmware is out of date" : message);

/** The real camera over USB (WebSerial). Chrome/Edge only. */
export class SerialSource implements CameraSource {
  readonly kind = "serial";
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly closeListeners = new Set<(error: Error) => void>();
  // The firmware answers commands strictly in order, so each reply belongs to the oldest waiter.
  private readonly waiters: Waiter[] = [];
  private decoding = false;
  private closing = false;
  private alive = false; // the read loop is running
  private failure: Error | null = null;
  private closing_: Promise<void> | null = null;

  async connect() {
    if (!("serial" in navigator)) throw new Error("WebSerial isn't supported in this browser");
    const port = await navigator.serial.requestPort({ filters: USB_FILTERS });
    await port.open({ baudRate: 115200, bufferSize: 1 << 16 }); // USB CDC ignores the baud rate
    if (!port.readable || !port.writable) throw new Error("Serial port isn't readable/writable");
    this.port = port;
    this.writer = port.writable.getWriter();
    const reader = port.readable.getReader();
    this.reader = reader;
    this.alive = true;
    this.readLoop = this.read(reader);
    try {
      await this.request(PacketType.SET_TIME, u32(localEpochSeconds()));
    } catch (e) {
      // No reply to the very first command usually means other firmware is on the board.
      throw this.failure?.message === NO_REPLY ? new Error(NO_FIRMWARE) : e;
    }
    await this.request(PacketType.STREAM, u8(1));
  }

  // Idempotent: every caller awaits the same close, so the port is free once any of them resolves.
  disconnect() {
    this.closing_ ??= this.close();
    return this.closing_;
  }

  private async close() {
    if (!this.port) return;
    this.closing = true;
    // Best effort: the device may already be gone, and closing must still release the port.
    await this.request(PacketType.STREAM, u8(0), { timeoutMs: 500 }).catch(() => {});
    await this.reader?.cancel().catch(() => {});
    await this.readLoop;
    this.writer?.releaseLock();
    await this.port.close().catch(() => {});
    this.port = null;
    this.writer = null;
  }

  onFrame(listener: FrameListener) {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onClose(listener: (error: Error) => void) {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async setMirror(mirrored: boolean) {
    await this.request(PacketType.MIRROR, u8(mirrored ? 1 : 0));
  }

  async setVflip(flipped: boolean) {
    await this.request(PacketType.VFLIP, u8(flipped ? 1 : 0));
  }

  async setResolution({ width, height }: Resolution) {
    await this.request(PacketType.RESOLUTION, u16Pair(width, height));
  }

  async setFps(fps: number) {
    await this.request(PacketType.FPS, u8(fps));
  }

  async capture(): Promise<FileEntry> {
    const reply = await this.request(PacketType.CAPTURE, undefined, { expect: PacketType.CAPTURED });
    return JSON.parse(decoder.decode(reply)) as FileEntry;
  }

  async listFiles(): Promise<FileEntry[]> {
    const reply = await this.request(PacketType.LIST, undefined, { expect: PacketType.FILE_LIST });
    return JSON.parse(decoder.decode(reply)) as FileEntry[];
  }

  async getFile(name: string) {
    const data = await this.request(PacketType.GET_FILE, encoder.encode(name), {
      expect: PacketType.FILE_DATA,
      timeoutMs: FILE_TIMEOUT_MS,
    });
    return new Blob([data], { type: "image/jpeg" });
  }

  private request(
    type: number,
    payload?: Uint8Array,
    { expect = PacketType.OK, timeoutMs = REQUEST_TIMEOUT_MS }: RequestOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const writer = this.writer;
    if (!writer || !this.alive) return Promise.reject(this.failure ?? new Error("Camera is not connected"));
    return new Promise((resolve, reject) => {
      // Replies are matched by order, so after a missing one nothing later can be trusted:
      // treat a timeout (or failed write) as a broken link rather than risk shifted replies.
      const timer = setTimeout(() => this.fail(new Error(NO_REPLY)), timeoutMs);
      const waiter: Waiter = {
        expect,
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
      writer.write(encodePacket(type, payload)).catch((e: unknown) => {
        this.fail(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  // Ends the read loop, which rejects every pending command and reports the close.
  private fail(error: Error) {
    this.failure ??= error;
    void this.reader?.cancel().catch(() => {});
  }

  private async read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const parser = new PacketParser();
    let reason = new Error("Camera disconnected");
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const packet of parser.push(value)) this.handle(packet);
      }
    } catch (e) {
      reason = e instanceof Error ? e : new Error(String(e)); // e.g. unplugged: "The device has been lost."
    } finally {
      reader.releaseLock();
    }
    this.alive = false;
    reason = this.failure ?? reason;
    this.waiters.splice(0).forEach((waiter) => waiter.reject(reason));
    if (!this.closing) this.closeListeners.forEach((listener) => listener(reason));
  }

  private handle({ type, payload }: Packet) {
    if (type === PacketType.FRAME) return this.showFrame(payload);
    const waiter = this.waiters.shift();
    if (!waiter) return;
    if (type === PacketType.ERROR) waiter.reject(deviceError(decoder.decode(payload)));
    else if (type !== waiter.expect) waiter.reject(new Error(`Unexpected reply 0x${type.toString(16)}`));
    else waiter.resolve(payload);
  }

  private showFrame(jpeg: Uint8Array<ArrayBuffer>) {
    // Skip frames while one is decoding so a slow decode can't build up a backlog.
    if (this.decoding || this.frameListeners.size === 0) return;
    this.decoding = true;
    createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }))
      .then((frame) => {
        this.frameListeners.forEach((listener) => listener(frame));
        frame.close();
      })
      .catch(() => {}) // a corrupt frame is skipped; the next one replaces it
      .finally(() => {
        this.decoding = false;
      });
  }
}

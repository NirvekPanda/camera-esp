// USB serial protocol shared with firmware/src/protocol.h. See docs/plan.md section 2.
// Packet: A5 5A | type:u8 | length:u32 LE | payload

export const MAGIC = [0xa5, 0x5a] as const;
export const HEADER_SIZE = 7;
// Well above any JPEG the sensor produces; a larger length means a corrupted header.
export const MAX_PAYLOAD = 4 * 1024 * 1024;

export const PacketType = {
  // ESP → site
  FRAME: 0x01,
  CAPTURED: 0x02,
  FILE_LIST: 0x03,
  FILE_DATA: 0x04,
  OK: 0x05,
  PIXELS: 0x06,
  ERROR: 0x7f,
  // site → ESP
  SET_TIME: 0x81,
  CAPTURE: 0x82,
  LIST: 0x83,
  GET_FILE: 0x84,
  STREAM: 0x85,
  MIRROR: 0x86,
  RESOLUTION: 0x87,
  FPS: 0x88,
  VFLIP: 0x89,
  PHOTO_PIXELS: 0x8a,
  DELETE_FILE: 0x8b,
} as const;

export interface Packet {
  type: number;
  payload: Uint8Array<ArrayBuffer>;
}

export function encodePacket(type: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const packet = new Uint8Array(HEADER_SIZE + payload.length);
  packet.set(MAGIC);
  packet[2] = type;
  new DataView(packet.buffer).setUint32(3, payload.length, true);
  packet.set(payload, HEADER_SIZE);
  return packet;
}

export const u8 = (value: number) => Uint8Array.of(value);

export function u16Pair(a: number, b: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, a, true);
  view.setUint16(2, b, true);
  return bytes;
}

export function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

/** Incremental parser: feed it serial chunks in any sizes; it skips noise (e.g. boot logs) between packets. */
export class PacketParser {
  private readonly header = new Uint8Array(HEADER_SIZE);
  private headerLength = 0;
  private type = 0;
  private payload: Uint8Array<ArrayBuffer> | null = null;
  private received = 0;

  push(chunk: Uint8Array): Packet[] {
    const packets: Packet[] = [];
    let i = 0;
    while (i < chunk.length) {
      if (this.payload) {
        // Bulk copy: payloads are large, headers are tiny.
        const n = Math.min(this.payload.length - this.received, chunk.length - i);
        this.payload.set(chunk.subarray(i, i + n), this.received);
        this.received += n;
        i += n;
        if (this.received === this.payload.length) {
          packets.push({ type: this.type, payload: this.payload });
          this.payload = null;
        }
        continue;
      }

      const byte = chunk[i++];
      if (this.headerLength < MAGIC.length && byte !== MAGIC[this.headerLength]) {
        this.headerLength = byte === MAGIC[0] ? 1 : 0; // A5 A5 5A still syncs
        continue;
      }
      this.header[this.headerLength++] = byte;
      if (this.headerLength < HEADER_SIZE) continue;

      this.headerLength = 0;
      const length = new DataView(this.header.buffer).getUint32(3, true);
      if (length > MAX_PAYLOAD) continue; // corrupted header: keep scanning for the next magic
      this.type = this.header[2];
      if (length === 0) packets.push({ type: this.type, payload: new Uint8Array(0) });
      else {
        this.payload = new Uint8Array(length);
        this.received = 0;
      }
    }
    return packets;
  }
}

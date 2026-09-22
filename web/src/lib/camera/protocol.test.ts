import { describe, expect, it } from "vitest";
import {
  HEADER_SIZE,
  MAX_PAYLOAD,
  PacketParser,
  PacketType,
  encodePacket,
  u16Pair,
  u32,
  u8,
  type Packet,
} from "./protocol";

const bytes = (...values: number[]) => Uint8Array.from(values);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const simplify = (packets: Packet[]) => packets.map((p) => ({ type: p.type, payload: [...p.payload] }));

describe("encodePacket", () => {
  it("writes magic, type, little-endian length and payload", () => {
    expect([...encodePacket(PacketType.FRAME, bytes(1, 2, 3))]).toEqual([
      0xa5, 0x5a, 0x01, 3, 0, 0, 0, 1, 2, 3,
    ]);
  });

  it("encodes empty payloads as a bare header", () => {
    expect(encodePacket(PacketType.CAPTURE)).toHaveLength(HEADER_SIZE);
  });
});

describe("payload helpers", () => {
  it("encode little-endian integers", () => {
    expect([...u8(30)]).toEqual([30]);
    expect([...u16Pair(1280, 720)]).toEqual([0x00, 0x05, 0xd0, 0x02]);
    expect([...u32(0x12345678)]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });
});

describe("PacketParser", () => {
  const frame = encodePacket(PacketType.FRAME, bytes(0xff, 0xd8, 0xff, 0xd9));
  const ok = encodePacket(PacketType.OK);

  it("parses a whole packet", () => {
    expect(simplify(new PacketParser().push(frame))).toEqual([
      { type: PacketType.FRAME, payload: [0xff, 0xd8, 0xff, 0xd9] },
    ]);
  });

  it("parses packets split across chunks at every byte boundary", () => {
    const stream = concat(frame, ok);
    for (let cut = 1; cut < stream.length; cut++) {
      const parser = new PacketParser();
      const packets = [...parser.push(stream.subarray(0, cut)), ...parser.push(stream.subarray(cut))];
      expect(packets.map((p) => p.type)).toEqual([PacketType.FRAME, PacketType.OK]);
    }
  });

  it("parses byte-by-byte delivery", () => {
    const parser = new PacketParser();
    const packets = [...concat(frame, ok)].flatMap((b) => parser.push(bytes(b)));
    expect(packets.map((p) => p.type)).toEqual([PacketType.FRAME, PacketType.OK]);
  });

  it("parses several packets in one chunk", () => {
    expect(new PacketParser().push(concat(ok, frame, ok)).map((p) => p.type)).toEqual([
      PacketType.OK,
      PacketType.FRAME,
      PacketType.OK,
    ]);
  });

  it("skips noise before and between packets, like boot logs", () => {
    const noise = new TextEncoder().encode("ESP-ROM:esp32s3\r\nboot:0x8 \xa5 junk\r\n");
    const packets = new PacketParser().push(concat(noise, frame, noise, ok));
    expect(packets.map((p) => p.type)).toEqual([PacketType.FRAME, PacketType.OK]);
  });

  it("syncs on A5 A5 5A", () => {
    expect(new PacketParser().push(concat(bytes(0xa5), ok)).map((p) => p.type)).toEqual([PacketType.OK]);
  });

  it("drops a header with an impossible length and resyncs on the next packet", () => {
    const corrupt = concat(bytes(0xa5, 0x5a, 0x01), u32(MAX_PAYLOAD + 1));
    expect(new PacketParser().push(concat(corrupt, ok)).map((p) => p.type)).toEqual([PacketType.OK]);
  });

  it("does not share payload buffers between packets", () => {
    const parser = new PacketParser();
    const [a, b] = parser.push(concat(frame, encodePacket(PacketType.FRAME, bytes(9, 9, 9, 9))));
    expect([...a.payload]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect([...b.payload]).toEqual([9, 9, 9, 9]);
  });
});

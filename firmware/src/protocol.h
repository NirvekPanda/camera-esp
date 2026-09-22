#pragma once

#include <Arduino.h>

// USB serial protocol shared with web/src/lib/camera/protocol.ts. See docs/plan.md section 2.
// Packet: A5 5A | type:u8 | length:u32 LE | payload
namespace protocol {

constexpr uint8_t MAGIC[2] = {0xA5, 0x5A};
constexpr size_t HEADER_SIZE = 7;
constexpr size_t MAX_COMMAND_PAYLOAD = 255;  // commands are tiny; a longer length is noise

enum Type : uint8_t {
  // ESP -> site
  FRAME = 0x01,
  CAPTURED = 0x02,
  FILE_LIST = 0x03,
  FILE_DATA = 0x04,
  OK = 0x05,
  PIXELS = 0x06,
  ERROR = 0x7F,
  // site -> ESP
  SET_TIME = 0x81,
  CAPTURE = 0x82,
  LIST = 0x83,
  GET_FILE = 0x84,
  STREAM = 0x85,
  MIRROR = 0x86,
  RESOLUTION = 0x87,
  FPS = 0x88,
  VFLIP = 0x89,
  PHOTO_PIXELS = 0x8A,
  DELETE_FILE = 0x8B,
};

// Writes return false when USB dropped bytes (the host stopped reading for longer than the TX timeout).
inline bool writeHeader(uint8_t type, uint32_t length) {
  const uint8_t header[HEADER_SIZE] = {
      MAGIC[0], MAGIC[1], type,
      uint8_t(length), uint8_t(length >> 8), uint8_t(length >> 16), uint8_t(length >> 24)};
  return Serial.write(header, sizeof header) == sizeof header;
}

inline bool send(uint8_t type, const uint8_t* data = nullptr, size_t length = 0) {
  return writeHeader(type, length) && (length == 0 || Serial.write(data, length) == length);
}

inline bool send(uint8_t type, const String& text) {
  return send(type, reinterpret_cast<const uint8_t*>(text.c_str()), text.length());
}

inline uint16_t readU16(const uint8_t* p) { return p[0] | p[1] << 8; }
inline uint32_t readU32(const uint8_t* p) { return p[0] | p[1] << 8 | p[2] << 16 | uint32_t(p[3]) << 24; }

// Incremental command parser with the same resync rules as the web parser.
class Parser {
 public:
  uint8_t type = 0;
  uint32_t length = 0;
  uint8_t payload[MAX_COMMAND_PAYLOAD + 1];  // +1 keeps text payloads NUL-terminated

  // Returns true when a complete packet is in type/length/payload.
  bool feed(uint8_t byte) {
    if (headerLength < 2) {
      if (byte == MAGIC[headerLength]) header[headerLength++] = byte;
      else headerLength = byte == MAGIC[0] ? 1 : 0;  // A5 A5 5A still syncs
      return false;
    }
    if (headerLength < HEADER_SIZE) {
      header[headerLength++] = byte;
      if (headerLength < HEADER_SIZE) return false;
      type = header[2];
      length = readU32(header + 3);
      received = 0;
      if (length > MAX_COMMAND_PAYLOAD) {
        headerLength = 0;  // corrupted: scan for the next magic
        return false;
      }
      if (length > 0) return false;
    } else {
      payload[received++] = byte;
      if (received < length) return false;
    }
    payload[length] = 0;
    headerLength = 0;
    return true;
  }

 private:
  uint8_t header[HEADER_SIZE];
  size_t headerLength = 0;
  uint32_t received = 0;
};

}  // namespace protocol

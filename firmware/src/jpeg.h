#pragma once

#include <stddef.h>
#include <stdint.h>

// Reads a JPEG's real dimensions from its SOF marker. The camera driver fills in fb->width and
// fb->height from the sensor's *current* setting, so after a size change they can't tell an old
// frame from a new one; the JPEG's own header can.
inline bool jpegSize(const uint8_t* data, size_t length, uint16_t& width, uint16_t& height) {
  if (length < 4 || data[0] != 0xFF || data[1] != 0xD8) return false;  // SOI
  size_t i = 2;
  while (i + 9 < length) {
    if (data[i] != 0xFF) return false;
    uint8_t marker = data[i + 1];
    if (marker == 0xC0 || marker == 0xC1 || marker == 0xC2) {  // baseline, extended, progressive
      height = uint16_t(data[i + 5] << 8 | data[i + 6]);
      width = uint16_t(data[i + 7] << 8 | data[i + 8]);
      return true;
    }
    i += 2 + (size_t(data[i + 2]) << 8 | data[i + 3]);  // skip this segment
  }
  return false;
}

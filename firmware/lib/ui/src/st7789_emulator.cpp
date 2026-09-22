#include "st7789_emulator.h"

namespace ui {

using namespace st7789;

void St7789Emulator::reset() {
  // Power-on/SWRESET state per the datasheet. Frame memory is left as is.
  awake_ = on_ = inverted_ = false;
  madctl_ = 0;
  colmod_ = 0x66;
  xStart_ = yStart_ = 0;
  xEnd_ = WIDTH - 1;
  yEnd_ = HEIGHT - 1;
}

void St7789Emulator::command(uint8_t cmd) {
  cmd_ = cmd;
  paramCount_ = pendingCount_ = 0;
  switch (cmd) {
    case SWRESET: return reset();
    case SLPOUT: awake_ = true; return;
    case INVON: inverted_ = true; return;
    case INVOFF: inverted_ = false; return;
    case DISPON: on_ = true; return;
    case RAMWR:
      x_ = xStart_;
      y_ = yStart_;
      return;
  }
}

void St7789Emulator::data(const uint8_t* bytes, size_t length) {
  for (size_t i = 0; i < length; i++) {
    uint8_t b = bytes[i];
    if (cmd_ == RAMWR) {
      pending_[pendingCount_++] = b;
      if (colmod_ == COLMOD_RGB565 && pendingCount_ == 2) {
        writePixel(uint16_t(pending_[0] << 8 | pending_[1]));
        pendingCount_ = 0;
      } else if (colmod_ != COLMOD_RGB565 && pendingCount_ == 3) {
        // 18-bit mode: one byte per channel, top 6 bits used.
        writePixel(uint16_t((pending_[0] >> 3) << 11 | (pending_[1] >> 2) << 5 | pending_[2] >> 3));
        pendingCount_ = 0;
      }
      continue;
    }
    if (paramCount_ < sizeof params_) params_[paramCount_++] = b;
    if (cmd_ == COLMOD && paramCount_ == 1) colmod_ = b;
    if (cmd_ == MADCTL && paramCount_ == 1) madctl_ = b;
    if ((cmd_ == CASET || cmd_ == RASET) && paramCount_ == 4) {
      int start = params_[0] << 8 | params_[1], end = params_[2] << 8 | params_[3];
      (cmd_ == CASET ? xStart_ : yStart_) = start;
      (cmd_ == CASET ? xEnd_ : yEnd_) = end;
    }
  }
}

void St7789Emulator::writePixel(uint16_t rgb565) {
  // MADCTL maps the write position onto the glass: MV swaps axes, MX/MY mirror them.
  int x = x_, y = y_;
  if (madctl_ & 0x20) {
    int t = x;
    x = y;
    y = t;
  }
  if (madctl_ & 0x40) x = WIDTH - 1 - x;
  if (madctl_ & 0x80) y = HEIGHT - 1 - y;
  if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) memory_[y * WIDTH + x] = rgb565;
  // Column first, then row; past the window's end, wrap to its start.
  if (++x_ > xEnd_) {
    x_ = xStart_;
    if (++y_ > yEnd_) y_ = yStart_;
  }
}

uint16_t St7789Emulator::shown(int x, int y) const {
  if (!displayOn()) return 0;
  uint16_t p = memory_[y * WIDTH + x];
  if (madctl_ & 0x08) p = uint16_t((p & 0x1F) << 11 | (p & 0x07E0) | p >> 11);  // BGR order
  return inverted_ ? p : uint16_t(~p);  // IPS glass inverts natively; INVON cancels it
}

const uint16_t* St7789Emulator::render() {
  for (int y = 0; y < HEIGHT; y++)
    for (int x = 0; x < WIDTH; x++) shown_[y * WIDTH + x] = shown(x, y);
  return shown_;
}

uint32_t St7789Emulator::hash() {
  render();
  uint32_t h = 2166136261u;
  for (uint16_t p : shown_) {
    h = (h ^ (p & 0xFF)) * 16777619u;
    h = (h ^ (p >> 8)) * 16777619u;
  }
  return h;
}

}  // namespace ui

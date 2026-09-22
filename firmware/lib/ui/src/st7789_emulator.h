#pragma once

#include "st7789.h"

namespace ui {

// A 240x240 ST7789 panel driven by the SPI byte stream: what the website shows is decoded from the
// same bytes the device sends, so driver bugs look the same on both. It starts like the real chip
// after reset: asleep, display off, 18-bit color, and the IPS glass inverts colors unless INVON.
class St7789Emulator : public SpiBus {
 public:
  void command(uint8_t cmd) override;
  void data(const uint8_t* bytes, size_t length) override;

  bool displayOn() const { return awake_ && on_; }
  uint16_t shown(int x, int y) const;  // pixel as seen on the glass
  const uint16_t* render();            // whole panel as seen, row-major
  uint32_t hash();                     // FNV-1a over render()

 private:
  void reset();
  void writePixel(uint16_t rgb565);

  uint16_t memory_[WIDTH * HEIGHT] = {};
  uint16_t shown_[WIDTH * HEIGHT] = {};
  uint8_t cmd_ = 0;
  uint8_t params_[4] = {};
  size_t paramCount_ = 0;
  uint8_t pending_[3] = {};  // bytes of a pixel split across data() calls
  size_t pendingCount_ = 0;
  int xStart_ = 0, xEnd_ = WIDTH - 1, yStart_ = 0, yEnd_ = HEIGHT - 1;
  int x_ = 0, y_ = 0;
  bool awake_ = false, on_ = false, inverted_ = false;
  uint8_t madctl_ = 0, colmod_ = 0x66;
};

}  // namespace ui

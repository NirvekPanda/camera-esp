#pragma once

#include <stddef.h>
#include <stdint.h>

#include "framebuffer.h"

namespace ui {

// 4-wire SPI to the display: command bytes go with DC low, data bytes with DC high.
class SpiBus {
 public:
  virtual void command(uint8_t cmd) = 0;
  virtual void data(const uint8_t* bytes, size_t length) = 0;
  virtual void delayMs(int) {}  // the real panel needs settle time after reset/sleep-out

 protected:
  ~SpiBus() = default;  // never deleted through the interface: no heap, no RTTI needed
};

namespace st7789 {

enum Command : uint8_t {
  SWRESET = 0x01,
  SLPOUT = 0x11,
  INVOFF = 0x20,
  INVON = 0x21,
  DISPON = 0x29,
  CASET = 0x2A,
  RASET = 0x2B,
  RAMWR = 0x2C,
  MADCTL = 0x36,
  COLMOD = 0x3A,
};

constexpr uint8_t COLMOD_RGB565 = 0x55;

// Power-up sequence for a 240x240 IPS module: reset, wake, RGB565, default orientation,
// inversion on (these panels invert natively), display on.
void init(SpiBus& bus);

// Sends one window of the framebuffer: CASET, RASET, RAMWR, then big-endian RGB565 pixels.
void flush(SpiBus& bus, const Framebuffer& fb, Rect area = {0, 0, WIDTH, HEIGHT});

}  // namespace st7789
}  // namespace ui

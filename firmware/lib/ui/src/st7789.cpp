#include "st7789.h"

namespace ui::st7789 {
namespace {

void window(SpiBus& bus, uint8_t cmd, int start, int end) {
  const uint8_t params[4] = {uint8_t(start >> 8), uint8_t(start), uint8_t(end >> 8), uint8_t(end)};
  bus.command(cmd);
  bus.data(params, sizeof params);
}

}  // namespace

void init(SpiBus& bus) {
  bus.command(SWRESET);
  bus.delayMs(150);
  bus.command(SLPOUT);
  bus.delayMs(10);
  const uint8_t colmod = COLMOD_RGB565, madctl = 0x00;
  bus.command(COLMOD);
  bus.data(&colmod, 1);
  bus.command(MADCTL);
  bus.data(&madctl, 1);
  bus.command(INVON);
  bus.command(DISPON);
}

void flush(SpiBus& bus, const Framebuffer& fb, Rect area) {
  window(bus, CASET, area.x, area.x + area.w - 1);
  window(bus, RASET, area.y, area.y + area.h - 1);
  bus.command(RAMWR);
  uint8_t row[WIDTH * 2];
  for (int y = area.y; y < area.y + area.h; y++) {
    for (int x = 0; x < area.w; x++) {
      uint16_t p = fb.at(area.x + x, y);
      row[2 * x] = uint8_t(p >> 8);  // the panel expects big-endian RGB565
      row[2 * x + 1] = uint8_t(p);
    }
    bus.data(row, size_t(area.w) * 2);
  }
}

}  // namespace ui::st7789

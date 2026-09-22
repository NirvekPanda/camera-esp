#pragma once

#include <stdint.h>

#include "font.h"

namespace ui {

constexpr int WIDTH = 240;
constexpr int HEIGHT = 240;

constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return uint16_t((r >> 3) << 11 | (g >> 2) << 5 | b >> 3);
}

// Palette from docs/wii-theme.md.
namespace color {
constexpr uint16_t bg = rgb565(0xEE, 0xF0, 0xF2);
constexpr uint16_t bar = rgb565(0xF7, 0xF7, 0xF7);  // exactly neutral in RGB565 (#FAFAFA tints pink)
constexpr uint16_t line = rgb565(0xC9, 0xCD, 0xD2);
constexpr uint16_t tile = rgb565(0xFF, 0xFF, 0xFF);
constexpr uint16_t text = rgb565(0x70, 0x77, 0x80);
constexpr uint16_t accent = rgb565(0x34, 0xBE, 0xED);
constexpr uint16_t ink = rgb565(0x3A, 0x40, 0x48);
constexpr uint16_t danger = rgb565(0xE5, 0x39, 0x35);  // an armed Delete (Confirm)
constexpr uint16_t black = 0x0000;
constexpr uint16_t white = 0xFFFF;
}  // namespace color

struct Rect {
  int x, y, w, h;
};

// 240x240 RGB565 canvas. Every drawing call clips to the screen.
class Framebuffer {
 public:
  uint16_t pixels[WIDTH * HEIGHT];

  uint16_t at(int x, int y) const { return pixels[y * WIDTH + x]; }
  void fill(uint16_t c);
  void fillRect(Rect r, uint16_t c);
  void fillRoundRect(Rect r, int radius, uint16_t c);
  void strokeRoundRect(Rect r, int radius, int thickness, uint16_t c);
  void fillCircle(int cx, int cy, int radius, uint16_t c);
  // Paints the parts of r outside its rounded shape, e.g. to round the corners of a picture.
  void maskRoundRect(Rect r, int radius, uint16_t outside);
  // y is the top of the text line. Returns the x after the last glyph.
  int drawText(const Font& font, int x, int y, const char* text, uint16_t c);
  static int textWidth(const Font& font, const char* text);

 private:
  void blend(int x, int y, uint16_t c, int alpha15);
};

}  // namespace ui

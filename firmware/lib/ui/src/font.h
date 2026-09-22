#pragma once

#include <stdint.h>

namespace ui {

// Printable ASCII (32..126), 4-bit alpha, one line-height bitmap per glyph, 2 pixels per byte.
struct Glyph {
  uint16_t offset;  // into Font::alpha
  uint8_t width;    // bitmap width in pixels
  uint8_t advance;  // pen advance in pixels
  int8_t left;      // bitmap x offset from the pen
};

struct Font {
  uint8_t height;  // line height; every glyph bitmap is this tall
  uint8_t ascent;  // baseline, from the top of the line
  const Glyph* glyphs;
  const uint8_t* alpha;
};

namespace fonts {
extern const Font small;  // 12 px, labels
extern const Font large;  // 16 px, clock and titles
}  // namespace fonts

}  // namespace ui

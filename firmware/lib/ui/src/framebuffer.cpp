#include "framebuffer.h"

namespace ui {
namespace {

int clampInt(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

// Pixel-center test against a rounded rectangle (integer math only).
bool insideRoundRect(int px, int py, Rect r, int radius) {
  if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return false;
  int dx = px - clampInt(px, r.x + radius, r.x + r.w - 1 - radius);
  int dy = py - clampInt(py, r.y + radius, r.y + r.h - 1 - radius);
  return dx * dx + dy * dy <= radius * radius;
}

}  // namespace

void Framebuffer::fill(uint16_t c) {
  for (uint16_t& p : pixels) p = c;
}

void Framebuffer::fillRect(Rect r, uint16_t c) {
  int x0 = clampInt(r.x, 0, WIDTH), x1 = clampInt(r.x + r.w, 0, WIDTH);
  int y0 = clampInt(r.y, 0, HEIGHT), y1 = clampInt(r.y + r.h, 0, HEIGHT);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++) pixels[y * WIDTH + x] = c;
}

void Framebuffer::fillRoundRect(Rect r, int radius, uint16_t c) {
  strokeRoundRect(r, radius, r.w + r.h, c);  // a stroke thicker than the shape fills it
}

void Framebuffer::strokeRoundRect(Rect r, int radius, int thickness, uint16_t c) {
  Rect inner = {r.x + thickness, r.y + thickness, r.w - 2 * thickness, r.h - 2 * thickness};
  int innerRadius = radius > thickness ? radius - thickness : 0;
  int x0 = clampInt(r.x, 0, WIDTH), x1 = clampInt(r.x + r.w, 0, WIDTH);
  int y0 = clampInt(r.y, 0, HEIGHT), y1 = clampInt(r.y + r.h, 0, HEIGHT);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++)
      if (insideRoundRect(x, y, r, radius) && !insideRoundRect(x, y, inner, innerRadius))
        pixels[y * WIDTH + x] = c;
}

void Framebuffer::fillCircle(int cx, int cy, int radius, uint16_t c) {
  fillRoundRect({cx - radius, cy - radius, 2 * radius + 1, 2 * radius + 1}, radius, c);
}

void Framebuffer::maskRoundRect(Rect r, int radius, uint16_t outside) {
  int x0 = clampInt(r.x, 0, WIDTH), x1 = clampInt(r.x + r.w, 0, WIDTH);
  int y0 = clampInt(r.y, 0, HEIGHT), y1 = clampInt(r.y + r.h, 0, HEIGHT);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++)
      if (!insideRoundRect(x, y, r, radius)) pixels[y * WIDTH + x] = outside;
}

void Framebuffer::blend(int x, int y, uint16_t c, int alpha15) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha15 == 0) return;
  uint16_t& p = pixels[y * WIDTH + x];
  if (alpha15 == 15) {
    p = c;
    return;
  }
  auto mix = [&](int shift, int mask) {
    int a = (c >> shift) & mask, b = (p >> shift) & mask;
    return ((a * alpha15 + b * (15 - alpha15)) / 15) << shift;
  };
  p = uint16_t(mix(11, 0x1F) | mix(5, 0x3F) | mix(0, 0x1F));
}

int Framebuffer::drawText(const Font& font, int x, int y, const char* text, uint16_t c) {
  for (; *text; text++) {
    unsigned char ch = static_cast<unsigned char>(*text);
    if (ch < 32 || ch > 126) ch = '?';
    const Glyph& g = font.glyphs[ch - 32];
    const uint8_t* rows = font.alpha + g.offset;
    int stride = (g.width + 1) / 2;
    for (int gy = 0; gy < font.height; gy++)
      for (int gx = 0; gx < g.width; gx++) {
        uint8_t pair = rows[gy * stride + gx / 2];
        blend(x + g.left + gx, y + gy, c, gx % 2 ? pair & 0xF : pair >> 4);
      }
    x += g.advance;
  }
  return x;
}

int Framebuffer::textWidth(const Font& font, const char* text) {
  int width = 0;
  for (; *text; text++) {
    unsigned char ch = static_cast<unsigned char>(*text);
    width += font.glyphs[(ch < 32 || ch > 126 ? '?' : ch) - 32].advance;
  }
  return width;
}

}  // namespace ui

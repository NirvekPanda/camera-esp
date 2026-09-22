#pragma once

#include <stdio.h>

#include "../lib/ui/src/photos.h"

// Deterministic photos for the native tests and the golden session: dated names, newest first,
// each a solid color with a white left stripe (so crops and blits are checkable in pixels).
struct FakeLibrary : ui::PhotoLibrary {
  static constexpr uint16_t COLORS[5] = {0x8E3D, 0xF5D1, 0xA6D3, 0xD5BD, 0xF6D1};
  int n;
  bool ready = true;  // false: pixels still "loading"
  char names[16][ui::PHOTO_NAME_MAX];

  explicit FakeLibrary(int count) : n(count) {
    for (int i = 0; i < count; i++)  // newest first: day 21, 20, 19, ...
      snprintf(names[i], sizeof names[i], "202606%02d-%02d%02d00.jpg", 21 - i, 9 + i, 5 * i);
  }
  int count() override { return n; }
  const char* name(int index) override { return names[index]; }
  bool pixels(int index, int w, int h, uint16_t* out) override {
    if (!ready) return false;
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) out[y * w + x] = x < w / 4 ? 0xFFFF : COLORS[index % 5];
    return true;
  }
};

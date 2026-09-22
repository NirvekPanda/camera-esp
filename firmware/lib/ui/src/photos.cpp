#include "photos.h"

namespace ui {
namespace {

bool digits(const char* s, int count, int& value) {
  value = 0;
  for (int i = 0; i < count; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    value = value * 10 + (s[i] - '0');
  }
  return true;
}

int compare(const char* a, const char* b) {
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}

}  // namespace

bool parsePhotoTime(const char* name, int& year, int& month, int& day, int& minutes) {
  int hour, minute;
  for (int i = 0; i < 15; i++)
    if (!name[i]) return false;  // shorter than YYYYMMDD-HHMMSS
  if (!digits(name, 4, year) || !digits(name + 4, 2, month) || !digits(name + 6, 2, day) || name[8] != '-' ||
      !digits(name + 9, 2, hour) || !digits(name + 11, 2, minute))
    return false;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return false;
  minutes = hour * 60 + minute;
  return true;
}

void sortNewestFirst(char (*names)[PHOTO_NAME_MAX], int count) {
  for (int i = 1; i < count; i++)  // insertion sort: a few hundred names at most, no heap
    for (int j = i; j > 0 && compare(names[j - 1], names[j]) < 0; j--) {
      char tmp[PHOTO_NAME_MAX];
      for (int k = 0; k < PHOTO_NAME_MAX; k++) tmp[k] = names[j][k], names[j][k] = names[j - 1][k], names[j - 1][k] = tmp[k];
    }
}

void scaleCover(const uint16_t* src, int sw, int sh, uint16_t* dst, int dw, int dh) {
  // Crop window with dst's aspect ratio, centered (integer math: identical on every target).
  int cw = sw, ch = sh;
  if (sw * dh > sh * dw) cw = sh * dw / dh;
  else ch = sw * dh / dw;
  const int x0 = (sw - cw) / 2, y0 = (sh - ch) / 2;
  for (int y = 0; y < dh; y++) {
    const uint16_t* row = src + (y0 + y * ch / dh) * sw + x0;
    for (int x = 0; x < dw; x++) dst[y * dw + x] = row[x * cw / dw];
  }
}

}  // namespace ui

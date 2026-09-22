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

bool newerPhoto(const char* a, const char* b) {
  int y, mo, d, min;
  const bool aDated = parsePhotoTime(a, y, mo, d, min), bDated = parsePhotoTime(b, y, mo, d, min);
  if (aDated != bDated) return aDated;
  return compare(a, b) > 0;
}

void keepNewest(char (*names)[PHOTO_NAME_MAX], uint32_t* sizes, int& count, int max, const char* name,
                uint32_t size) {
  int at = count;  // insertion point in the newest-first list
  while (at > 0 && newerPhoto(name, names[at - 1])) at--;
  if (at >= max) return;  // older than everything kept
  if (count < max) count++;
  for (int i = count - 1; i > at; i--) {
    for (int k = 0; k < PHOTO_NAME_MAX; k++) names[i][k] = names[i - 1][k];
    sizes[i] = sizes[i - 1];
  }
  int k = 0;
  for (; k < PHOTO_NAME_MAX - 1 && name[k]; k++) names[at][k] = name[k];
  names[at][k] = 0;
  sizes[at] = size;
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

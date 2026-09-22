#include "sd_photo_library.h"

#include <SD.h>
#include <esp_heap_caps.h>
#include <img_converters.h>
#include <string.h>

#include "jpeg.h"

namespace {

const char* const PHOTO_DIR = "/photos";

bool ours(const String& name) {  // photos this camera saved; also safe to put in JSON as is
  return name.endsWith(".jpg") && name.length() < ui::PHOTO_NAME_MAX && name.indexOf('"') < 0 &&
         name.indexOf('\\') < 0;
}

}  // namespace

bool SdPhotoLibrary::refresh() {
  count_ = 0;
  File dir = SD.open(PHOTO_DIR);
  if (!dir) return false;
  for (File file = dir.openNextFile(); file && count_ < MAX; file = dir.openNextFile()) {
    String name = file.name();
    if (!file.isDirectory() && ours(name)) {
      strncpy(names_[count_], name.c_str(), ui::PHOTO_NAME_MAX);
      sizes_[count_] = file.size();
      count_++;
    }
    file.close();
  }
  dir.close();
  // Newest first, keeping each size with its name.
  char sorted[MAX][ui::PHOTO_NAME_MAX];
  memcpy(sorted, names_, sizeof sorted[0] * count_);
  ui::sortNewestFirst(sorted, count_);
  uint32_t sizes[MAX];
  for (int i = 0; i < count_; i++)
    for (int j = 0; j < count_; j++)
      if (strcmp(sorted[i], names_[j]) == 0) sizes[i] = sizes_[j];
  memcpy(names_, sorted, sizeof sorted[0] * count_);
  memcpy(sizes_, sizes, sizeof sizes[0] * count_);
  return true;
}

bool SdPhotoLibrary::decode(const char* name, int w, int h, uint16_t* out) {
  File file = SD.open(String(PHOTO_DIR) + "/" + name);
  if (!file || file.isDirectory()) return false;
  size_t length = file.size();
  uint8_t* jpeg = static_cast<uint8_t*>(heap_caps_malloc(length, MALLOC_CAP_SPIRAM));
  bool read = jpeg && file.read(jpeg, length) == length;
  file.close();
  uint16_t sw = 0, sh = 0;
  if (!read || !jpegSize(jpeg, length, sw, sh)) {
    free(jpeg);
    return false;
  }
  // The decoder can downscale by 2, 4 or 8 for free: use the most that still covers w x h.
  int scale = 8;
  while (scale > 1 && (sw / scale < w || sh / scale < h)) scale /= 2;
  const jpg_scale_t jpgScale = scale == 8 ? JPG_SCALE_8X : scale == 4 ? JPG_SCALE_4X : scale == 2 ? JPG_SCALE_2X : JPG_SCALE_NONE;
  const int dw = sw / scale, dh = sh / scale;
  uint8_t* rgb = static_cast<uint8_t*>(heap_caps_malloc(size_t(dw) * dh * 2, MALLOC_CAP_SPIRAM));
  bool ok = rgb && jpg2rgb565(jpeg, length, rgb, jpgScale);
  free(jpeg);
  if (ok) {
    // jpg2rgb565 writes big-endian pixels (panel order); make them native uint16_t in place.
    uint16_t* px = reinterpret_cast<uint16_t*>(rgb);
    for (int i = 0; i < dw * dh; i++) px[i] = uint16_t(rgb[2 * i] << 8 | rgb[2 * i + 1]);
    ui::scaleCover(px, dw, dh, out, w, h);
  }
  free(rgb);
  return ok;
}

bool SdPhotoLibrary::pixels(int index, int w, int h, uint16_t* out) {
  if (index < 0 || index >= count_) return false;
  const char* name = names_[index];
  const size_t bytes = size_t(w) * h * 2;
  Cached* slot = &cache_[0];
  for (Cached& c : cache_) {
    if (c.pixels && c.w == w && c.h == h && strcmp(c.name, name) == 0) {
      c.used = ++clock_;
      memcpy(out, c.pixels, bytes);
      return true;
    }
    if (c.used < slot->used) slot = &c;  // least recently used
  }
  if (!decode(name, w, h, out)) return false;
  if (!slot->pixels || slot->w * slot->h != w * h) {
    free(slot->pixels);
    slot->pixels = static_cast<uint16_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM));
  }
  if (slot->pixels) {
    memcpy(slot->pixels, out, bytes);
    strncpy(slot->name, name, ui::PHOTO_NAME_MAX);
    slot->w = w, slot->h = h, slot->used = ++clock_;
  }
  return true;
}

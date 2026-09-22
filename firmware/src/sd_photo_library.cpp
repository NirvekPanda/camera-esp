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
  // The folder lists files in no useful order: keep the newest MAX while scanning all of them.
  for (File file = dir.openNextFile(); file; file = dir.openNextFile()) {
    String name = file.name();
    if (!file.isDirectory() && ours(name)) ui::keepNewest(names_, sizes_, count_, MAX, name.c_str(), file.size());
    file.close();
  }
  dir.close();
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
  // jpg2rgb565 writes native (little-endian) uint16_t pixels: use them as they are. Verified on the
  // board (make hwtest's roughness check): swapping the bytes scrambles the image into noise.
  if (ok) ui::scaleCover(reinterpret_cast<uint16_t*>(rgb), dw, dh, out, w, h);
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

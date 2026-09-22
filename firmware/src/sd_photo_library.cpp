#include "sd_photo_library.h"

#include <SD.h>
#include <esp_heap_caps.h>
#include <img_converters.h>
#include <string.h>

#include "jpeg.h"

namespace {

const char* const PHOTO_DIR = "/photos";
const char* const PREVIEW_DIR = "/photos/previews";
constexpr size_t PREVIEW_BYTES = size_t(SdPhotoLibrary::PREVIEW_W) * SdPhotoLibrary::PREVIEW_H * 2;

String photoPath(const char* name) { return String(PHOTO_DIR) + "/" + name; }

// Same name, .rgb instead of .jpg.
String previewPath(const char* name) {
  String base = name;
  if (base.endsWith(".jpg")) base.remove(base.length() - 4);
  return String(PREVIEW_DIR) + "/" + base + ".rgb";
}

void* psram(size_t bytes) { return heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM); }

// Decodes an in-memory JPEG, center-cropped and scaled to w x h RGB565.
bool decodeJpeg(const uint8_t* jpeg, size_t length, int w, int h, uint16_t* out) {
  uint16_t sw = 0, sh = 0;
  if (!jpegSize(jpeg, length, sw, sh)) return false;
  // The decoder can downscale by 2, 4 or 8 for free: use the most that still covers w x h.
  int scale = 8;
  while (scale > 1 && (sw / scale < w || sh / scale < h)) scale /= 2;
  const jpg_scale_t jpgScale = scale == 8 ? JPG_SCALE_8X : scale == 4 ? JPG_SCALE_4X : scale == 2 ? JPG_SCALE_2X : JPG_SCALE_NONE;
  const int dw = sw / scale, dh = sh / scale;
  uint16_t* rgb = static_cast<uint16_t*>(psram(size_t(dw) * dh * 2));
  // jpg2rgb565 writes native (little-endian) uint16_t pixels: use them as they are. Verified on the
  // board (make hwtest's roughness check): swapping the bytes scrambles the image into noise.
  bool ok = rgb && jpg2rgb565(jpeg, length, reinterpret_cast<uint8_t*>(rgb), jpgScale);
  if (ok) ui::scaleCover(rgb, dw, dh, out, w, h);
  free(rgb);
  return ok;
}

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

bool SdPhotoLibrary::savePreview(const char* name, const uint8_t* jpeg, size_t length) {
  uint16_t* preview = static_cast<uint16_t*>(psram(PREVIEW_BYTES));
  bool ok = preview && decodeJpeg(jpeg, length, PREVIEW_W, PREVIEW_H, preview);
  if (ok) {
    if (!SD.exists(PREVIEW_DIR)) SD.mkdir(PREVIEW_DIR);
    File file = SD.open(previewPath(name), FILE_WRITE);
    ok = file && file.write(reinterpret_cast<const uint8_t*>(preview), PREVIEW_BYTES) == PREVIEW_BYTES;
    file.close();
    if (!ok) SD.remove(previewPath(name));  // never leave a partial preview
  }
  free(preview);
  return ok;
}

bool SdPhotoLibrary::decode(const char* name, int w, int h, uint16_t* out) {
  uint16_t* preview = static_cast<uint16_t*>(psram(PREVIEW_BYTES));
  if (!preview) return false;
  File file = SD.open(previewPath(name));
  bool ok = file && file.size() == PREVIEW_BYTES && file.read(reinterpret_cast<uint8_t*>(preview), PREVIEW_BYTES) == PREVIEW_BYTES;
  file.close();
  if (!ok) {  // older photo without a preview: make it now (one full decode), then use it
    File photo = SD.open(photoPath(name));
    size_t length = photo && !photo.isDirectory() ? photo.size() : 0;
    uint8_t* jpeg = length ? static_cast<uint8_t*>(psram(length)) : nullptr;
    ok = jpeg && photo.read(jpeg, length) == length;
    photo.close();
    ok = ok && decodeJpeg(jpeg, length, PREVIEW_W, PREVIEW_H, preview);
    if (ok) savePreview(name, jpeg, length);
    free(jpeg);
  }
  if (ok) ui::scaleCover(preview, PREVIEW_W, PREVIEW_H, out, w, h);
  free(preview);
  return ok;
}

bool SdPhotoLibrary::remove(const char* name) {
  for (Cached& c : cache_)  // a later photo can reuse the name (IMG_0001.jpg)
    if (c.pixels && strcmp(c.name, name) == 0) c.name[0] = 0;
  SD.remove(previewPath(name));
  return SD.remove(photoPath(name));
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

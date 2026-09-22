#pragma once

#include <photos.h>  // firmware/lib/ui
#include <stddef.h>

// The photos in /photos on the microSD card, for the device UI's Pictures page and for the site
// (LIST, PHOTO_PIXELS, DELETE_FILE). Every photo gets a ready-made preview with the same name,
// /photos/previews/<name>.rgb: 240x180 RGB565 (little-endian, no header), so showing a photo is an
// SD read instead of a full-resolution JPEG decode. Results are also cached in PSRAM, since the UI
// asks for the same thumbnails every frame.
class SdPhotoLibrary : public ui::PhotoLibrary {
 public:
  static constexpr int MAX = 128;
  static constexpr int PREVIEW_W = 240, PREVIEW_H = 180;  // the photo's 4:3, screen-sized

  // Rescans the card. False if there's no card or no /photos folder.
  bool refresh();
  uint32_t size(int index) const { return sizes_[index]; }

  int count() override { return count_; }
  const char* name(int index) override { return names_[index]; }
  bool pixels(int index, int w, int h, uint16_t* out) override;

  // A photo by file name, center-cropped and scaled to w x h RGB565 (from its preview; uncached).
  static bool decode(const char* name, int w, int h, uint16_t* out);
  // Makes and saves the preview for a photo from its JPEG (right after capture: no re-read).
  static bool savePreview(const char* name, const uint8_t* jpeg, size_t length);
  // Deletes a photo (a name refresh() would list), its preview and its cached thumbnails.
  bool remove(const char* name);

 private:
  struct Cached {
    char name[ui::PHOTO_NAME_MAX];
    int w, h;
    uint16_t* pixels;  // PSRAM
    uint32_t used;     // for least-recently-used eviction
  };
  static constexpr int CACHE = 8;  // a screen of thumbnails + the viewer image

  char names_[MAX][ui::PHOTO_NAME_MAX];
  uint32_t sizes_[MAX];
  int count_ = 0;
  Cached cache_[CACHE] = {};
  uint32_t clock_ = 0;
};

#pragma once

#include <photos.h>  // firmware/lib/ui

// The photos in /photos on the microSD card, for the device UI's Pictures page and for the site
// (LIST, PHOTO_PIXELS). Decoding a full-resolution JPEG takes far longer than a frame, so decoded
// images are cached in PSRAM: the UI asks for the same thumbnails every frame.
class SdPhotoLibrary : public ui::PhotoLibrary {
 public:
  static constexpr int MAX = 128;

  // Rescans the card. False if there's no card or no /photos folder.
  bool refresh();
  uint32_t size(int index) const { return sizes_[index]; }

  int count() override { return count_; }
  const char* name(int index) override { return names_[index]; }
  bool pixels(int index, int w, int h, uint16_t* out) override;

  // Decodes a photo by file name, center-cropped and scaled to w x h RGB565 (uncached).
  static bool decode(const char* name, int w, int h, uint16_t* out);

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

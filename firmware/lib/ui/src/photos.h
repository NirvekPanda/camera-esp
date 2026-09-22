#pragma once

#include <stdint.h>

// Photos on the SD card, as the device UI sees them. The ESP32 reads /photos on the microSD card
// (firmware/src/sd_photo_library.*); the emulator gets the same data from the connected camera.
namespace ui {

constexpr int PHOTO_NAME_MAX = 24;  // "20260921-142305_02.jpg" + NUL fits

class PhotoLibrary {
 public:
  virtual int count() = 0;                 // photos, newest first
  virtual const char* name(int index) = 0;  // file name, e.g. "20260921-142305.jpg"
  // The photo center-cropped and scaled to w x h RGB565, written to out. False while the pixels
  // aren't available (still loading, or unreadable): the UI then draws a placeholder.
  virtual bool pixels(int index, int w, int h, uint16_t* out) = 0;

 protected:
  ~PhotoLibrary() = default;  // never deleted through the interface
};

// When a photo was taken, from its YYYYMMDD-HHMMSS name. False for other names (IMG_0001.jpg).
bool parsePhotoTime(const char* name, int& year, int& month, int& day, int& minutes);

// Sorts file names newest first: plain byte order, reversed (YYYYMMDD-HHMMSS sorts by time, and
// "_02" duplicates sort after their original).
void sortNewestFirst(char (*names)[PHOTO_NAME_MAX], int count);

// Center-crops src (sw x sh RGB565) to the aspect of dst and scales it to dw x dh (nearest).
void scaleCover(const uint16_t* src, int sw, int sh, uint16_t* dst, int dw, int dh);

}  // namespace ui

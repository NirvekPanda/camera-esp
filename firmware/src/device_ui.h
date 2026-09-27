#pragma once

#include <stdint.h>

#include <ui.h>  // firmware/lib/ui: WIDTH, PREVIEW_H

#include "sd_photo_library.h"

// The device's own screen and buttons: the portable ui::Ui (firmware/lib/ui) on the ST7789 panel
// wired in pins.h. The same code runs as WASM on the site's Device tab.
namespace device_ui {

// What the UI asks of the rest of the firmware, which owns the camera and the card.
struct Host {
  bool (*capturePhoto)();                  // shutter: take a photo and save it
  bool (*deletePhoto)(const char* name);   // confirmed delete
  const uint16_t* (*cameraFrame)();        // live frame, WIDTH x PREVIEW_H RGB565, or nullptr
};

// False when the panel didn't come up; the firmware then runs headless as before.
bool begin(SdPhotoLibrary& library, const Host& host);

// Poll buttons, animate, redraw. minutes is the local time of day, or -1 while the clock is unset.
void loop(bool usbLinked, int minutes);

}  // namespace device_ui

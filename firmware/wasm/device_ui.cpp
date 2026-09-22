// WebAssembly build of the device UI for the site's Device tab (`make wasm`). The page drives it
// like the hardware (5-way presses, clock, link state) and paints the emulated panel: every frame
// goes through the real ST7789 driver into the emulator, so the canvas shows the SPI output.
#include <emscripten/emscripten.h>
#include <string.h>

#include "../lib/ui/src/st7789_emulator.h"
#include "../lib/ui/src/ui.h"
#include "../test_ui/golden.h"

namespace {

// The connected camera's photos, filled in by the page (no imports: the page pushes data in and
// polls for what's missing). Thumbnails are cached per photo; the viewer image has one slot.
class HostLibrary : public ui::PhotoLibrary {
 public:
  static constexpr int MAX = 128;
  static constexpr int THUMB_PIXELS = ui::THUMB_SIZE * ui::THUMB_SIZE;
  char names[MAX][ui::PHOTO_NAME_MAX] = {};
  uint16_t thumbs[MAX][THUMB_PIXELS];
  bool thumbReady[MAX] = {};
  uint16_t image[ui::PREVIEW_W * ui::PREVIEW_H];
  int imageIndex = -1;   // which photo `image` holds
  int wantedImage = -1;  // the viewer asked for this one and it isn't loaded
  int n = 0;

  int count() override { return n; }
  const char* name(int index) override { return names[index]; }
  bool pixels(int index, int w, int h, uint16_t* out) override {
    if (w == ui::THUMB_SIZE && h == ui::THUMB_SIZE && thumbReady[index]) {
      memcpy(out, thumbs[index], sizeof thumbs[index]);
      return true;
    }
    if (w == ui::PREVIEW_W && h == ui::PREVIEW_H) {
      if (imageIndex == index) {
        memcpy(out, image, sizeof image);
        return true;
      }
      wantedImage = index;
    }
    return false;
  }
};

HostLibrary library;
ui::Ui device;
ui::Framebuffer fb;
ui::St7789Emulator panel;
uint16_t preview[ui::PREVIEW_W * ui::PREVIEW_H];  // the page writes camera frames here
}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void ui_init() {
  device = ui::Ui();
  device.setLibrary(&library);
  ui::st7789::init(panel);
}

// 0 up, 1 down, 2 left, 3 right, 4 center, 5 A, 6 B (ui::Button).
EMSCRIPTEN_KEEPALIVE void ui_press(int button) {
  if (button >= 0 && button <= int(ui::Button::B)) device.press(ui::Button(button));
}

EMSCRIPTEN_KEEPALIVE void ui_set_time(int minutesSinceMidnight) { device.setTime(minutesSinceMidnight); }

// 0 none, 1 USB, 2 battery (ui::Link).
EMSCRIPTEN_KEEPALIVE void ui_set_link(int link, int batteryPercent) {
  if (link >= 0 && link <= int(ui::Link::Battery)) device.setLink(ui::Link(link), batteryPercent);
}

// Advances time, renders, flushes over the emulated SPI bus. Returns 240x240 RGB565 as shown.
EMSCRIPTEN_KEEPALIVE const uint16_t* ui_frame(int elapsedMs) {
  device.tick(elapsedMs > 0 ? uint32_t(elapsedMs) : 0);  // time never runs backwards
  device.render(fb);
  ui::st7789::flush(panel, fb);
  return panel.render();
}

// Live camera frames for the Camera app: the page writes PREVIEW_W x PREVIEW_H RGB565 into this
// buffer, then turns the preview on; off returns the app to its color bars.
EMSCRIPTEN_KEEPALIVE uint16_t* ui_preview_buffer() { return preview; }
EMSCRIPTEN_KEEPALIVE void ui_set_preview(int on) { device.setPreview(on ? preview : nullptr); }

// Photos: the page writes names (newest first) into ui_library_name(i), then sets the count, and
// fills thumbnails / the viewer image as they arrive.
EMSCRIPTEN_KEEPALIVE char* ui_library_name(int index) { return library.names[index]; }
EMSCRIPTEN_KEEPALIVE void ui_library_set_count(int count) {
  library.n = count < HostLibrary::MAX ? count : HostLibrary::MAX;
  memset(library.thumbReady, 0, sizeof library.thumbReady);
  library.imageIndex = library.wantedImage = -1;
}
EMSCRIPTEN_KEEPALIVE uint16_t* ui_library_thumb(int index) { return library.thumbs[index]; }
EMSCRIPTEN_KEEPALIVE void ui_library_thumb_ready(int index) { library.thumbReady[index] = true; }
EMSCRIPTEN_KEEPALIVE uint16_t* ui_library_image() { return library.image; }
EMSCRIPTEN_KEEPALIVE void ui_library_image_ready(int index) {
  library.imageIndex = index;
  if (library.wantedImage == index) library.wantedImage = -1;
}
EMSCRIPTEN_KEEPALIVE int ui_library_wanted_image() { return library.wantedImage; }
EMSCRIPTEN_KEEPALIVE int ui_take_capture_requests() { return device.takeCaptureRequests(); }

EMSCRIPTEN_KEEPALIVE int ui_screen() { return int(device.screen()); }
EMSCRIPTEN_KEEPALIVE int ui_focus() { return device.focus(); }
EMSCRIPTEN_KEEPALIVE int ui_animating() { return device.animating(); }
// The flash is a light ring around the physical display, outside the panel: the page draws it.
EMSCRIPTEN_KEEPALIVE int ui_flash() { return device.flashOn(); }

// The scripted session from the native tests: must return golden::EXPECTED_HASH.
EMSCRIPTEN_KEEPALIVE uint32_t ui_golden() { return golden::run(); }
EMSCRIPTEN_KEEPALIVE uint32_t ui_golden_expected() { return golden::EXPECTED_HASH; }

}  // extern "C"

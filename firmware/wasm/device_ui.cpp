// WebAssembly build of the device UI for the site's Device tab (`make wasm`). The page drives it
// like the hardware (5-way presses, clock, link state) and paints the emulated panel: every frame
// goes through the real ST7789 driver into the emulator, so the canvas shows the SPI output.
#include <emscripten/emscripten.h>

#include "../lib/ui/src/st7789_emulator.h"
#include "../lib/ui/src/ui.h"
#include "../test_ui/golden.h"

namespace {
ui::Ui device;
ui::Framebuffer fb;
ui::St7789Emulator panel;
}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void ui_init() {
  device = ui::Ui();
  ui::st7789::init(panel);
}

// 0 up, 1 down, 2 left, 3 right, 4 center (ui::Button).
EMSCRIPTEN_KEEPALIVE void ui_press(int button) {
  if (button >= 0 && button <= int(ui::Button::Center)) device.press(ui::Button(button));
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

EMSCRIPTEN_KEEPALIVE int ui_screen() { return int(device.screen()); }
EMSCRIPTEN_KEEPALIVE int ui_focus() { return device.focus(); }
EMSCRIPTEN_KEEPALIVE int ui_animating() { return device.animating(); }

// The scripted session from the native tests: must return golden::EXPECTED_HASH.
EMSCRIPTEN_KEEPALIVE uint32_t ui_golden() { return golden::run(); }
EMSCRIPTEN_KEEPALIVE uint32_t ui_golden_expected() { return golden::EXPECTED_HASH; }

}  // extern "C"

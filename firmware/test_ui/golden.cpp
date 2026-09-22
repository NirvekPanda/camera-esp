#include "golden.h"

#include "../lib/ui/src/st7789_emulator.h"
#include "../lib/ui/src/ui.h"

namespace golden {
namespace {

using ui::Button;

struct Step {
  int button;  // -1: none
  uint32_t ms;
};

// Visits every screen through the one control model (arrows move focus, Center activates) and
// samples frames mid-animation (row slide, page zoom, shutter flash).
constexpr int R = int(Button::Right), L = int(Button::Left), D = int(Button::Down), U = int(Button::Up),
              C = int(Button::Center), NONE = -1;
const Step SCRIPT[] = {
    {NONE, 0}, {R, 100}, {NONE, 200},              // slide to Pictures (mid-slide frame)
    {C, 120}, {NONE, 200},                         // zoom into Pictures (mid-zoom frame)
    {R, 0}, {D, 0}, {C, 0}, {C, 0},                // photo 5 -> viewer -> Back
    {D, 0}, {C, 0},                                // bottom bar Back -> Home
    {R, 200}, {C, 300},                            // Settings
    {C, 0}, {D, 0}, {C, 0}, {D, 0}, {D, 0}, {D, 0}, {U, 0}, {D, 0},  // change values, reach Back
    {C, 0}, {L, 50}, {L, 200}, {C, 300},           // Home -> Camera
    {C, 60}, {NONE, 200},                          // shoot (mid-flash frame)
    {L, 0}, {C, 0},                                // Back -> Home
};

ui::Framebuffer fb;
ui::St7789Emulator panel;

}  // namespace

uint32_t run() {
  ui::Ui device;
  device.setTime(14 * 60 + 23);
  device.setLink(ui::Link::Usb);
  ui::st7789::init(panel);  // SWRESET; the first full-frame flush overwrites panel memory
  uint32_t combined = 0;
  for (const Step& step : SCRIPT) {
    if (step.button >= 0) device.press(Button(step.button));
    device.tick(step.ms);
    device.render(fb);
    ui::st7789::flush(panel, fb);
    combined = combined * 31 ^ panel.hash();  // every frame counts, not just the last
  }
  return combined;
}

}  // namespace golden

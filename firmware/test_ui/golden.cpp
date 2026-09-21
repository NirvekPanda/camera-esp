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

// Visits every screen and samples frames mid-animation (row slide, page zoom, shutter flash).
const Step SCRIPT[] = {
    {-1, 0},     {int(Button::Right), 100}, {-1, 200},  // slide to Pictures, mid-slide frame
    {int(Button::Center), 120}, {-1, 200},              // zoom into Pictures
    {int(Button::Right), 0},    {int(Button::Down), 0}, {int(Button::Up), 0}, {int(Button::Up), 0},
    {int(Button::Right), 200},  {int(Button::Center), 300},  // Settings
    {int(Button::Right), 0},    {int(Button::Down), 0}, {int(Button::Right), 0}, {int(Button::Up), 0},
    {int(Button::Up), 0},       {int(Button::Left), 50},  {int(Button::Left), 200},
    {int(Button::Center), 300}, {int(Button::Center), 60}, {-1, 200},  // Camera: shoot, mid-flash
    {int(Button::Up), 0},
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

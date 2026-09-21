// Prints the device UI in the terminal: `make ui-preview` (optionally OUT=dir to also write PPMs).
// Frames go through the ST7789 driver and emulator, so this is exactly what the panel would show.
#include <stdio.h>
#include <stdlib.h>

#include "../lib/ui/src/st7789_emulator.h"
#include "../lib/ui/src/ui.h"

using namespace ui;

namespace {

Framebuffer fb;
St7789Emulator panel;

void rgb(uint16_t p, int& r, int& g, int& b) {
  r = (p >> 11) * 255 / 31;
  g = ((p >> 5) & 0x3F) * 255 / 63;
  b = (p & 0x1F) * 255 / 31;
}

// Two pixel rows per text row (upper half block), every other column: 120x60 cells.
void print(const char* title, const uint16_t* px) {
  printf("\n  %s\n", title);
  for (int y = 0; y < HEIGHT; y += 4) {
    printf("  ");
    for (int x = 0; x < WIDTH; x += 2) {
      int r1, g1, b1, r2, g2, b2;
      rgb(px[y * WIDTH + x], r1, g1, b1);
      rgb(px[(y + 2) * WIDTH + x], r2, g2, b2);
      printf("\x1b[38;2;%d;%d;%dm\x1b[48;2;%d;%d;%dm\xe2\x96\x80", r1, g1, b1, r2, g2, b2);
    }
    printf("\x1b[0m\n");
  }
}

void writePpm(const char* dir, const char* name, const uint16_t* px) {
  char path[512];
  snprintf(path, sizeof path, "%s/%s.ppm", dir, name);
  FILE* f = fopen(path, "wb");
  if (!f) return;
  fprintf(f, "P6 %d %d 255\n", WIDTH, HEIGHT);
  for (int i = 0; i < WIDTH * HEIGHT; i++) {
    int r, g, b;
    rgb(px[i], r, g, b);
    fputc(r, f), fputc(g, f), fputc(b, f);
  }
  fclose(f);
}

void show(Ui& device, const char* name, const char* title) {
  device.render(fb);
  st7789::flush(panel, fb);
  const uint16_t* px = panel.render();
  print(title, px);
  if (const char* dir = getenv("OUT")) writePpm(dir, name, px);
}

void open(Ui& device, int page) {
  while (device.screen() != Screen::Home) device.press(Button::Up);
  while (device.focus() < page) device.press(Button::Right), device.tick(FOCUS_MS);
  while (device.focus() > page) device.press(Button::Left), device.tick(FOCUS_MS);
  device.press(Button::Center);
  device.tick(OPEN_MS);
}

}  // namespace

int main() {
  st7789::init(panel);
  Ui device;
  device.setTime(14 * 60 + 23);
  device.setLink(Link::Usb);

  show(device, "home", "Home (USB connected)");
  device.press(Button::Right);
  device.tick(FOCUS_MS / 2);
  show(device, "home-sliding", "Home, sliding to Pictures (mid-animation)");
  device.tick(FOCUS_MS);
  device.press(Button::Center);
  device.tick(OPEN_MS / 2);
  show(device, "opening", "Opening Pictures (mid-zoom)");
  device.tick(OPEN_MS);
  device.press(Button::Right);
  show(device, "pictures", "Pictures");
  open(device, 2);
  show(device, "settings", "Settings");
  device.setLink(Link::Battery, 76);
  open(device, 0);
  show(device, "camera", "Camera (battery 76%)");
  return 0;
}

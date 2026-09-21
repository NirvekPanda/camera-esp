#pragma once

#include <stdint.h>

#include "framebuffer.h"

namespace ui {

enum class Button : uint8_t { Up, Down, Left, Right, Center };  // the 5-way switch
enum class Screen : uint8_t { Home, Camera, Pictures, Settings };
enum class Link : uint8_t { None, Usb, Battery };  // nav bar top-right icon

constexpr int PAGE_COUNT = 3;          // Camera, Pictures, Settings
constexpr uint32_t FOCUS_MS = 200;     // home row slide
constexpr uint32_t OPEN_MS = 250;      // tile zoom into a page
constexpr uint32_t FLASH_MS = 150;     // shutter flash
constexpr int SETTING_COUNT = 4;       // Resolution, Mirror, Flip vertical, About
constexpr int RESOLUTION_COUNT = 9;    // matches RESOLUTIONS in web/src/lib/camera/settings.ts
constexpr int MAX_PHOTOS = 99;

// The whole device UI: 5-way input + time in, frames out. Deterministic: the same presses and
// ticks give the same pixels on the device and in the WASM build.
class Ui {
 public:
  void press(Button b);
  void tick(uint32_t ms);
  void render(Framebuffer& fb) const;

  void setTime(int minutesSinceMidnight) { minutes_ = minutesSinceMidnight % (24 * 60); }
  void setLink(Link link, int batteryPercent = 0) {
    link_ = link;
    battery_ = batteryPercent;
  }

  Screen screen() const { return screen_; }
  int focus() const;  // focused tile / photo / setting on the current screen
  bool animating() const { return focusT_ < FOCUS_MS || openT_ < OPEN_MS || flashT_ < FLASH_MS; }
  int photoCount() const { return photos_; }
  int resolution() const { return resolution_; }  // index into RESOLUTIONS
  bool mirrored() const { return mirrored_; }
  bool vflipped() const { return vflipped_; }

 private:
  void renderNavBar(Framebuffer& fb, const char* title) const;
  void renderHome(Framebuffer& fb) const;
  void renderCamera(Framebuffer& fb) const;
  void renderPictures(Framebuffer& fb) const;
  void renderSettings(Framebuffer& fb) const;
  void changeSetting(int delta);

  Screen screen_ = Screen::Home;
  int minutes_ = 0;
  Link link_ = Link::None;
  int battery_ = 0;

  // Home: row position eases from focusFrom_ to homeFocus_ while focusT_ < FOCUS_MS.
  int homeFocus_ = 0, focusFrom_ = 0;
  uint32_t focusT_ = FOCUS_MS;
  Screen opening_ = Screen::Home;  // page being zoomed into while openT_ < OPEN_MS
  uint32_t openT_ = OPEN_MS;

  uint32_t flashT_ = FLASH_MS;
  int photos_ = 5, photoFocus_ = 0;
  int settingFocus_ = 0, resolution_ = RESOLUTION_COUNT - 1;  // 1920x1080, the site's default
  bool mirrored_ = false, vflipped_ = false;
};

// Ease-out cubic on 0..1024 fixed point (no floats: identical results on every target).
int easeOut(uint32_t elapsed, uint32_t duration);

}  // namespace ui

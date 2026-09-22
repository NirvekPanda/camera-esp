#pragma once

#include <stdint.h>

#include "framebuffer.h"

namespace ui {

enum class Button : uint8_t { Up, Down, Left, Right, Center, A, B };  // 5-way switch + A/B
enum class Screen : uint8_t { Home, Camera, Pictures, Settings, Viewer };
enum class Link : uint8_t { None, Usb, Battery };  // nav bar top-right icon

constexpr int PAGE_COUNT = 3;          // Camera, Pictures, Settings
constexpr uint32_t FOCUS_MS = 200;     // home row slide
constexpr uint32_t OPEN_MS = 250;      // tile zoom into a page
constexpr uint32_t FLASH_MS = 150;     // shutter flash
constexpr int SETTING_COUNT = 6;       // Resolution, Mirror, Flip vertical, Grid, Clock, About
constexpr int RESOLUTION_COUNT = 9;    // matches RESOLUTIONS in web/src/lib/camera/settings.ts
constexpr int MAX_PHOTOS = 99;

// The camera's picture area, under the nav bar: live preview frames are this size (RGB565).
constexpr int PREVIEW_Y = 28;
constexpr int PREVIEW_W = WIDTH;
constexpr int PREVIEW_H = HEIGHT - PREVIEW_Y;

// focus() values for the bottom bar, which is in the same place on every page:
// Back bottom-left, the page's primary action (if any) bottom-right.
constexpr int BACK = -1;
constexpr int PRIMARY = -2;

// The whole device UI: 5-way input + time in, frames out. Deterministic: the same presses and
// ticks give the same pixels on the device and in the WASM build.
// One control model everywhere (docs/wii-theme.md): arrows only move focus, Center/A activate the
// focused element, B goes back, and pages share the nav bar and bottom bar. The camera is a
// full-screen app: Center takes a picture, A toggles the flash, B goes back home. The photo viewer
// is full-screen too: Left/Right step through photos, B returns to the gallery.
class Ui {
 public:
  void press(Button b);
  void tick(uint32_t ms);
  void render(Framebuffer& fb) const;

  void setTime(int minutesSinceMidnight) { minutes_ = minutesSinceMidnight % (24 * 60); }
  void setDate(int year, int month, int day) { today_ = {int16_t(year), int8_t(month), int8_t(day), 0}; }
  // Live camera frame for the Camera app (PREVIEW_W x PREVIEW_H RGB565, row-major), or nullptr
  // for none: the app then shows color bars. The caller keeps the buffer alive and current.
  void setPreview(const uint16_t* pixels) { preview_ = pixels; }
  void setLink(Link link, int batteryPercent = 0) {
    link_ = link;
    battery_ = batteryPercent;
  }

  Screen screen() const { return screen_; }
  int focus() const;  // focused tile / photo / setting, or BACK / PRIMARY
  bool animating() const { return focusT_ < FOCUS_MS || openT_ < OPEN_MS || flashT_ < FLASH_MS; }
  int photoCount() const { return photos_; }
  int resolution() const { return resolution_; }  // index into RESOLUTIONS
  bool mirrored() const { return mirrored_; }
  bool vflipped() const { return vflipped_; }
  bool grid() const { return grid_; }        // rule-of-thirds overlay on the camera
  bool clock12() const { return clock12_; }  // 12-hour clock with AM/PM
  // The flash only works in the camera; the setting is kept for when it reopens.
  bool flashOn() const { return screen_ == Screen::Camera && flash_; }

 private:
  void renderNavBar(Framebuffer& fb, const char* title) const;
  struct Shot {  // when a photo was taken
    int16_t year;
    int8_t month, day;
    int16_t minutes;
  };
  void renderBottomBar(Framebuffer& fb, int focus, const char* primary) const;
  void renderHome(Framebuffer& fb) const;
  void renderCamera(Framebuffer& fb) const;
  void renderPictures(Framebuffer& fb) const;
  void renderSettings(Framebuffer& fb) const;
  void renderViewer(Framebuffer& fb) const;
  void pressHome(Button b);
  void pressCamera(Button b);
  void pressPage(Button b);
  void activate();
  void back();
  void open(Screen page);

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
  int photos_ = 5, photoFocus_ = 0;  // stays on the viewed photo while the viewer is open
  int lastPhoto_ = 0;  // where focus left the grid: reopening Pictures and Up from Back return here
  int settingFocus_ = 0, resolution_ = RESOLUTION_COUNT - 1;  // 1920x1080, the site's default
  bool mirrored_ = false, vflipped_ = false, grid_ = false, clock12_ = false, flash_ = false;
  const uint16_t* preview_ = nullptr;
  Shot today_ = {2026, 1, 1, 0};  // date from setDate; minutes come from minutes_
  // The demo photos' times; new photos record the time they're taken.
  Shot shots_[MAX_PHOTOS] = {{2026, 6, 21, 9 * 60 + 5},  {2026, 6, 21, 10 * 60 + 30}, {2026, 6, 20, 12 * 60 + 15},
                             {2026, 6, 18, 15 * 60 + 45}, {2026, 6, 14, 18 * 60 + 20}};
};

// "June, 21, 2026" if it fits in maxWidth px, else "Jun, 21, 2026", else "Jun, 21".
// out must hold 24 chars.
void photoDate(char* out, int year, int month, int day, int maxWidth);

// Ease-out cubic on 0..1024 fixed point (no floats: identical results on every target).
int easeOut(uint32_t elapsed, uint32_t duration);

}  // namespace ui

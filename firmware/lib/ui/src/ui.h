#pragma once

#include <stdint.h>

#include "framebuffer.h"
#include "photos.h"

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

// The camera's picture area, under the nav bar: live preview frames are this size (RGB565).
constexpr int PREVIEW_Y = 28;
constexpr int PREVIEW_W = WIDTH;
constexpr int PREVIEW_H = HEIGHT - PREVIEW_Y;
// The photo viewer's picture area, between the nav bar and the bottom bar (Back, Delete).
constexpr int VIEWER_H = 177;

// Pictures grid thumbnails are THUMB_SIZE x THUMB_SIZE (PhotoLibrary::pixels is asked for this
// size and for WIDTH x VIEWER_H in the viewer).
constexpr int THUMB_SIZE = 64;

// focus() values for the bottom bar, which is in the same place on every page:
// Back bottom-left, the page's primary action (if any) bottom-right.
constexpr int BACK = -1;
constexpr int PRIMARY = -2;

// The whole device UI: 5-way input + time in, frames out. Deterministic: the same presses and
// ticks give the same pixels on the device and in the WASM build.
// One control model everywhere (docs/wii-theme.md): arrows only move focus, Center/A activate the
// focused element, B goes back, and pages share the nav bar and bottom bar. The camera is a
// full-screen app: Center takes a picture, A toggles the flash, B goes back home. The photo viewer
// has the shared bars: Left/Right step through photos, Down reaches Back and Delete.
class Ui {
 public:
  void press(Button b);
  void tick(uint32_t ms);
  void render(Framebuffer& fb) const;

  void setTime(int minutesSinceMidnight) { minutes_ = minutesSinceMidnight % (24 * 60); }
  // The photos on the SD card (Pictures page and viewer); nullptr shows no photos.
  void setLibrary(PhotoLibrary* library) { library_ = library; }
  // Call after the library's contents change: focus follows the same photo (by name), or moves to
  // one that still exists.
  void libraryChanged();
  // The photo the user confirmed deleting, copied to out (PHOTO_NAME_MAX), once. The host removes
  // it from the SD card and calls libraryChanged(); the viewer then shows the next photo.
  bool takeDeleteRequest(char* out);
  bool confirmingDelete() const { return confirmDelete_; }
  // Shutter presses since the last call: the host takes the photos (on the SD card) and refreshes
  // the library, so a new photo appears once it's saved.
  int takeCaptureRequests() {
    int n = captureRequests_;
    captureRequests_ = 0;
    return n;
  }
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
  int photoCount() const { return library_ ? library_->count() : 0; }
  int resolution() const { return resolution_; }  // index into RESOLUTIONS
  bool mirrored() const { return mirrored_; }
  bool vflipped() const { return vflipped_; }
  bool grid() const { return grid_; }        // rule-of-thirds overlay on the camera
  bool clock12() const { return clock12_; }  // 12-hour clock with AM/PM
  // The flash only works in the camera; the setting is kept for when it reopens.
  bool flashOn() const { return screen_ == Screen::Camera && flash_; }

 private:
  void renderNavBar(Framebuffer& fb, const char* title) const;
  void renderBottomBar(Framebuffer& fb, int focus, const char* primary, bool danger = false) const;
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
  void clampPhotoFocus();
  void rememberPhoto();

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
  int photoFocus_ = 0;  // stays on the viewed photo while the viewer is open
  int lastPhoto_ = 0;  // where focus left the grid: reopening Pictures and Up from Back return here
  int settingFocus_ = 0, resolution_ = 1;  // 480x480, the site's default
  bool mirrored_ = false, vflipped_ = false, grid_ = false, clock12_ = false, flash_ = false;
  const uint16_t* preview_ = nullptr;
  PhotoLibrary* library_ = nullptr;
  int captureRequests_ = 0;
  char focusedPhoto_[PHOTO_NAME_MAX] = {};  // name of photoFocus_'s photo, to find it again
  int viewerFocus_ = 0;  // 0: the photo; BACK or PRIMARY (Delete) in the bottom bar
  bool confirmDelete_ = false;  // Delete pressed once: it reads Confirm, in red
  char deleteRequest_[PHOTO_NAME_MAX] = {};
};

// "June, 21, 2026" if it fits in maxWidth px, else "Jun, 21, 2026", else "Jun, 21".
// out must hold 24 chars.
void photoDate(char* out, int year, int month, int day, int maxWidth);

// Ease-out cubic on 0..1024 fixed point (no floats: identical results on every target).
int easeOut(uint32_t elapsed, uint32_t duration);

}  // namespace ui

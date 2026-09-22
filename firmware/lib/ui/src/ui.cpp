#include "ui.h"

namespace ui {
namespace {

// Every screen has the same frame: nav bar on top, bottom bar below, content in between.
constexpr int BAR_H = 27;       // nav bar; its divider is the row below
constexpr int BOTTOM_Y = 206;   // bottom bar; its divider is the row above
constexpr Rect CONTENT = {0, BAR_H + 1, WIDTH, BOTTOM_Y - BAR_H - 2};
// Bottom bar buttons: Back always bottom-left, the primary action always bottom-right.
constexpr Rect BACK_BUTTON = {8, BOTTOM_Y + 5, 76, 24};
constexpr Rect PRIMARY_BUTTON = {WIDTH - 8 - 76, BOTTOM_Y + 5, 76, 24};
constexpr int FOCUS_STROKE = 3;  // the one focus style: a blue outline, on every focusable element

// Home row
constexpr int TILE = 56, TILE_FOCUSED = 64, TILE_PITCH = 76, ROW_Y = 104, TILE_RADIUS = 14;
// Pictures grid: 3 per row, 2 rows visible
constexpr int COLS = 3, THUMB = 64, THUMB_PITCH = 74, GRID_X = 12, GRID_Y = 38;
// Settings rows: 5 visible, the list scrolls to keep focus in view
constexpr int ROW_H = 30, ROW_PITCH = 34, ROWS_Y = 34, VISIBLE_ROWS = 5;

const char* const PAGE_NAMES[PAGE_COUNT] = {"Camera", "Pictures", "Settings"};
const char* const SETTING_LABELS[SETTING_COUNT] = {"Resolution", "Mirror", "Flip vertical", "Grid", "Clock", "About"};
const char* const RESOLUTIONS[RESOLUTION_COUNT] = {
    "240x240", "480x480", "720x720", "320x240", "640x480",
    "800x600", "1280x720", "1600x1200", "1920x1080"};
const uint16_t BARS[] = {color::white, rgb565(0xFF, 0xFF, 0), rgb565(0, 0xFF, 0xFF), rgb565(0, 0xFF, 0),
                         rgb565(0xFF, 0, 0xFF), rgb565(0xFF, 0, 0), rgb565(0, 0, 0xFF)};
const uint16_t THUMB_COLORS[] = {rgb565(0x8E, 0xC5, 0xE8), rgb565(0xF2, 0xB8, 0x8B), rgb565(0xA8, 0xD8, 0x9E),
                                 rgb565(0xD7, 0xB4, 0xE8), rgb565(0xF0, 0xD9, 0x8C)};
constexpr uint16_t LOW_BATTERY = rgb565(0xE5, 0x48, 0x4D);

int lerp(int a, int b, int t1024) { return a + (b - a) * t1024 / 1024; }
int absInt(int v) { return v < 0 ? -v : v; }
// Saturating: t + ms could overflow for huge steps and wind a timer backwards.
uint32_t advance(uint32_t t, uint32_t ms, uint32_t limit) { return ms < limit - t ? t + ms : limit; }

// Two-digit decimal into out (no printf: keeps the WASM build free of libc formatting).
char* twoDigits(char* out, int v) {
  out[0] = char('0' + v / 10);
  out[1] = char('0' + v % 10);
  return out + 2;
}

void drawIcon(Framebuffer& fb, int page, int cx, int cy) {
  switch (page) {
    case 0:  // camera: body, viewfinder bump, lens
      fb.fillRect({cx - 6, cy - 13, 12, 5}, color::ink);
      fb.fillRoundRect({cx - 15, cy - 9, 30, 21}, 5, color::ink);
      fb.fillCircle(cx, cy + 1, 7, color::tile);
      fb.fillCircle(cx, cy + 1, 4, color::accent);
      break;
    case 1:  // pictures: 3x3 thumbnails
      for (int r = 0; r < 3; r++)
        for (int c = 0; c < 3; c++) fb.fillRoundRect({cx - 13 + c * 9, cy - 13 + r * 9, 8, 8}, 2, (r + c) % 2 ? color::accent : color::ink);
      break;
    default: {  // settings: an 8-tooth gear (integer geometry, identical on every target)
      // Unit directions x1000 for the 8 teeth (0°, 45°, ... around the circle).
      static const int DIRS[8][2] = {{1000, 0}, {707, 707}, {0, 1000}, {-707, 707},
                                     {-1000, 0}, {-707, -707}, {0, -1000}, {707, -707}};
      const int body = 9, outer = 12, hole = 4, halfTooth = 2500;  // tooth half-width 2.5 px, x1000
      for (int dy = -outer; dy <= outer; dy++)
        for (int dx = -outer; dx <= outer; dx++) {
          int r2 = dx * dx + dy * dy;
          bool inBody = r2 <= body * body;
          bool inTooth = false;
          for (const auto& d : DIRS) {
            int along = dx * d[0] + dy * d[1];
            int across = dx * d[1] - dy * d[0];
            if (along > 0 && (across < 0 ? -across : across) <= halfTooth && r2 <= outer * outer) inTooth = true;
          }
          if (r2 <= hole * hole) fb.fillRect({cx + dx, cy + dy, 1, 1}, color::tile);
          else if (inBody || inTooth) fb.fillRect({cx + dx, cy + dy, 1, 1}, color::ink);
        }
    }
  }
}

// Status icons draw right-aligned and return their left edge, so more can line up to their left.
int drawUsb(Framebuffer& fb, int x, int cy) {  // USB trident, pointing right
  fb.fillCircle(x + 3, cy, 3, color::ink);
  fb.fillRect({x + 3, cy - 1, 18, 3}, color::ink);
  fb.fillRect({x + 20, cy - 3, 4, 7}, color::ink);
  fb.fillRect({x + 8, cy - 6, 2, 6}, color::ink);
  fb.fillRect({x + 8, cy - 6, 6, 2}, color::ink);
  fb.fillRect({x + 13, cy - 7, 4, 4}, color::ink);
  fb.fillRect({x + 12, cy, 2, 6}, color::ink);
  fb.fillRect({x + 12, cy + 4, 5, 2}, color::ink);
  fb.fillCircle(x + 17, cy + 5, 2, color::ink);
  return x;
}

int drawFlash(Framebuffer& fb, int right, int cy) {  // lightning bolt
  int x = right - 11, y = cy - 8;
  for (int r = 0; r < 7; r++) fb.fillRect({x + 7 - r / 2, y + r, 3, 1}, color::accent);      // upper stroke
  fb.fillRect({x + 2, y + 7, 8, 2}, color::accent);                                          // kink
  for (int r = 0; r < 7; r++) fb.fillRect({x + 6 - r / 2, y + 9 + r, 3, 1}, color::accent);  // lower stroke
  return x;
}

int drawBattery(Framebuffer& fb, int right, int cy, int percent) {
  char label[5], *p = label;
  if (percent >= 100) *p++ = '1', p = twoDigits(p, 0);
  else p = twoDigits(p, percent < 0 ? 0 : percent);
  *p++ = '%';
  *p = 0;
  Rect body = {right - 25, cy - 6, 22, 12};
  fb.strokeRoundRect(body, 3, 1, color::ink);
  fb.fillRect({right - 3, cy - 3, 3, 6}, color::ink);
  int fill = (body.w - 4) * (percent > 100 ? 100 : percent) / 100;
  fb.fillRect({body.x + 2, body.y + 2, fill, body.h - 4}, percent < 20 ? LOW_BATTERY : color::accent);
  int left = body.x - 4 - Framebuffer::textWidth(fonts::small, label);
  fb.drawText(fonts::small, left, cy - fonts::small.height / 2, label, color::text);
  return left;
}

// Outline shared by every focusable element (tiles, rows, thumbnails, bottom buttons).
void outline(Framebuffer& fb, Rect r, int radius, bool focused) {
  fb.strokeRoundRect(r, radius, focused ? FOCUS_STROKE : 1, focused ? color::accent : color::line);
}

void photoPlaceholder(Framebuffer& fb, Rect r, int index, int radius) {  // a sun over a hill
  fb.fillRoundRect(r, radius, THUMB_COLORS[index % 5]);
  fb.fillCircle(r.x + r.w * 72 / 100, r.y + r.h * 28 / 100, r.w / 9, color::tile);
  fb.fillRoundRect({r.x + r.w / 10, r.y + r.h * 6 / 10, r.w * 8 / 10, r.h * 3 / 10}, r.h / 8, color::tile);
}

void photoName(char (&name)[13], int index) {
  const char base[] = "IMG_0000.jpg";
  for (int i = 0; i < 13; i++) name[i] = base[i];
  twoDigits(name + 6, (index + 1) % 100);
}

}  // namespace

int easeOut(uint32_t elapsed, uint32_t duration) {
  int t = int((elapsed < duration ? elapsed : duration) * 1024 / duration);
  int inv = 1024 - t;
  return 1024 - inv * inv / 1024 * inv / 1024;
}

int Ui::focus() const {
  switch (screen_) {
    case Screen::Camera: return 0;  // nothing focusable: the camera is full-screen
    case Screen::Pictures: return photoFocus_;
    case Screen::Settings: return settingFocus_;
    case Screen::Viewer: return photoFocus_;  // the photo being viewed
    default: return homeFocus_;
  }
}

void Ui::press(Button b) {
  if (openT_ < OPEN_MS) return;  // ignore input while a page is opening
  if (screen_ == Screen::Home) return pressHome(b);
  if (screen_ == Screen::Camera) return pressCamera(b);
  if (b == Button::Center || b == Button::A) return activate();
  if (b == Button::B) return back();
  pressPage(b);
}

void Ui::pressCamera(Button b) {
  if (b == Button::Center && photos_ < MAX_PHOTOS) {  // shutter; the blink confirms a saved photo
    photos_++;
    flashT_ = 0;
  }
  if (b == Button::A) flash_ = !flash_;
  if (b == Button::B) back();  // Back, as on every other screen
}

void Ui::back() {
  if (screen_ == Screen::Camera) preview_ = nullptr;  // never reopen on a stale frame
  screen_ = screen_ == Screen::Viewer ? Screen::Pictures : Screen::Home;
}

void Ui::pressHome(Button b) {
  if ((b == Button::Left && homeFocus_ > 0) || (b == Button::Right && homeFocus_ < PAGE_COUNT - 1)) {
    focusFrom_ = homeFocus_;
    homeFocus_ += b == Button::Right ? 1 : -1;
    focusT_ = 0;
  } else if (b == Button::Center || b == Button::A) {
    opening_ = Screen(homeFocus_ + 1);
    openT_ = 0;
  }
}

// Arrows move focus spatially: through the page's content, then down into the bottom bar
// (Back left, primary right) and back up. They never change a value or leave the page.
void Ui::pressPage(Button b) {
  switch (screen_) {
    case Screen::Pictures:
      if (photoFocus_ == BACK) {
        if (b == Button::Up && photos_ > 0) photoFocus_ = lastPhoto_;
      } else if (b == Button::Left && photoFocus_ % COLS > 0) {
        photoFocus_--;
      } else if (b == Button::Right && photoFocus_ % COLS < COLS - 1 && photoFocus_ + 1 < photos_) {
        photoFocus_++;
      } else if (b == Button::Down) {
        // Into the next row (its last photo if it's shorter), and only past the last row to Back.
        bool lastRow = photoFocus_ / COLS == (photos_ - 1) / COLS;
        photoFocus_ = lastRow ? BACK : (photoFocus_ + COLS < photos_ ? photoFocus_ + COLS : photos_ - 1);
      } else if (b == Button::Up && photoFocus_ >= COLS) {
        photoFocus_ -= COLS;
      }
      if (photoFocus_ != BACK) lastPhoto_ = photoFocus_;
      return;
    case Screen::Settings:
      if (b == Button::Down) settingFocus_ = settingFocus_ == BACK || settingFocus_ == SETTING_COUNT - 1 ? BACK : settingFocus_ + 1;
      if (b == Button::Up) settingFocus_ = settingFocus_ == BACK ? SETTING_COUNT - 1 : settingFocus_ > 0 ? settingFocus_ - 1 : 0;
      return;
    default:  // Viewer: Left/Right step through the photos
      if (b == Button::Left && photoFocus_ > 0) photoFocus_--;
      if (b == Button::Right && photoFocus_ < photos_ - 1) photoFocus_++;
      lastPhoto_ = photoFocus_;
      return;
  }
}

// Center/A activate whatever is focused, on every page.
void Ui::activate() {
  if (screen_ == Screen::Viewer) return;  // the focused photo is already open
  if (focus() == BACK) return back();
  switch (screen_) {
    case Screen::Pictures:
      screen_ = Screen::Viewer;
      return;
    case Screen::Settings:
      if (settingFocus_ == 0) resolution_ = (resolution_ + 1) % RESOLUTION_COUNT;
      if (settingFocus_ == 1) mirrored_ = !mirrored_;
      if (settingFocus_ == 2) vflipped_ = !vflipped_;
      if (settingFocus_ == 3) grid_ = !grid_;
      if (settingFocus_ == 4) clock12_ = !clock12_;
      return;
    default:
      return;
  }
}

// Each page opens with its most likely action focused.
void Ui::open(Screen page) {
  screen_ = page;
  if (page == Screen::Settings) settingFocus_ = 0;
  if (page == Screen::Pictures) photoFocus_ = lastPhoto_;
}

void Ui::tick(uint32_t ms) {
  focusT_ = advance(focusT_, ms, FOCUS_MS);
  flashT_ = advance(flashT_, ms, FLASH_MS);
  if (openT_ < OPEN_MS) {
    openT_ = advance(openT_, ms, OPEN_MS);
    if (openT_ == OPEN_MS) open(opening_);
  }
}

void Ui::render(Framebuffer& fb) const {
  fb.fill(color::bg);
  switch (screen_) {
    case Screen::Home: renderHome(fb); break;
    case Screen::Camera: renderCamera(fb); break;
    case Screen::Pictures: renderPictures(fb); break;
    case Screen::Settings: renderSettings(fb); break;
    case Screen::Viewer: renderViewer(fb); break;
  }
  char name[13];
  photoName(name, photoFocus_);
  // The camera shows an icon instead of a text title; Home has no title.
  const char* title = screen_ == Screen::Home || screen_ == Screen::Camera ? nullptr
                      : screen_ == Screen::Viewer                          ? name
                                                                           : PAGE_NAMES[int(screen_) - 1];
  renderNavBar(fb, title);
  switch (screen_) {
    case Screen::Camera: return;  // full-screen picture: no bottom bar
    case Screen::Pictures: return renderBottomBar(fb, photoFocus_, nullptr);
    case Screen::Settings: return renderBottomBar(fb, settingFocus_, nullptr);
    case Screen::Viewer: return;  // full-screen photo: B goes back to the gallery
    default: return renderBottomBar(fb, 0, nullptr);  // Home: the page dots live in the bar
  }
}

void Ui::renderBottomBar(Framebuffer& fb, int focus, const char* primary) const {
  fb.fillRect({0, BOTTOM_Y, WIDTH, HEIGHT - BOTTOM_Y}, color::bar);
  fb.fillRect({0, BOTTOM_Y - 1, WIDTH, 1}, color::line);
  auto button = [&](Rect r, const char* label, bool focused) {
    fb.fillRoundRect(r, r.h / 2, color::tile);
    outline(fb, r, r.h / 2, focused);
    int w = Framebuffer::textWidth(fonts::small, label);
    fb.drawText(fonts::small, r.x + (r.w - w) / 2, r.y + (r.h - fonts::small.height) / 2, label, color::ink);
  };
  if (screen_ == Screen::Home) {
    for (int i = 0; i < PAGE_COUNT; i++)
      fb.fillCircle(WIDTH / 2 + (i - 1) * 14, BOTTOM_Y + (HEIGHT - BOTTOM_Y) / 2, 3, i == homeFocus_ ? color::accent : color::line);
    return;
  }
  button(BACK_BUTTON, "Back", focus == BACK);
  if (primary) button(PRIMARY_BUTTON, primary, focus == PRIMARY);
}

void Ui::renderNavBar(Framebuffer& fb, const char* title) const {
  fb.fillRect({0, 0, WIDTH, BAR_H}, color::bar);
  fb.fillRect({0, BAR_H, WIDTH, 1}, color::line);
  int hour = minutes_ / 60;
  char clock[6], *p = clock;
  if (clock12_) {  // 12-hour: no leading zero, 0 and 12 read as 12
    int h12 = hour % 12 == 0 ? 12 : hour % 12;
    if (h12 >= 10) *p++ = '1';
    *p++ = char('0' + h12 % 10);
  } else {
    p = twoDigits(p, hour);
  }
  *p++ = ':';
  *twoDigits(p, minutes_ % 60) = 0;
  int x = fb.drawText(fonts::large, 8, 1, clock, color::text);
  if (clock12_) x = fb.drawText(fonts::small, x + 3, 9, hour < 12 ? "AM" : "PM", color::text);
  if (title) fb.drawText(fonts::small, x + 10, 6, title, color::ink);
  if (screen_ == Screen::Camera) {  // small camera icon in place of a title
    int ix = x + 10, iy = 8;
    fb.fillRect({ix + 5, iy, 6, 3}, color::ink);
    fb.fillRoundRect({ix, iy + 2, 16, 11}, 3, color::ink);
    fb.fillCircle(ix + 8, iy + 7, 3, color::bar);
    fb.fillCircle(ix + 8, iy + 7, 1, color::ink);
  }
  // Status icons, right to left: USB or battery, then the flash when it's on.
  int right = WIDTH - 6;
  if (link_ == Link::Usb) right = drawUsb(fb, WIDTH - 32, BAR_H / 2) - 8;
  if (link_ == Link::Battery) right = drawBattery(fb, WIDTH - 6, BAR_H / 2, battery_) - 8;
  if (flashOn()) drawFlash(fb, right, BAR_H / 2);
}

void Ui::renderHome(Framebuffer& fb) const {
  // Row position in tiles (x1024), eased from the previous focus; the focused tile stays centered.
  int pos = focusFrom_ * 1024 + (homeFocus_ - focusFrom_) * easeOut(focusT_, FOCUS_MS);
  for (int i = 0; i < PAGE_COUNT; i++) {
    int distance = absInt(i * 1024 - pos);
    int size = lerp(TILE_FOCUSED, TILE, distance < 1024 ? distance : 1024);
    int cx = WIDTH / 2 + (i * 1024 - pos) * TILE_PITCH / 1024;
    Rect r = {cx - size / 2, ROW_Y - size / 2, size, size};
    fb.fillRoundRect(r, TILE_RADIUS, color::tile);
    bool focused = distance < 512;
    outline(fb, r, TILE_RADIUS, focused);
    drawIcon(fb, i, cx, ROW_Y);
    const char* name = PAGE_NAMES[i];
    fb.drawText(fonts::small, cx - Framebuffer::textWidth(fonts::small, name) / 2, ROW_Y + TILE_FOCUSED / 2 + 6, name, focused ? color::ink : color::text);
  }

  if (openT_ < OPEN_MS) {  // the focused tile zooms out to fill the page, like opening a channel
    int t = easeOut(openT_, OPEN_MS);
    Rect from = {WIDTH / 2 - TILE_FOCUSED / 2, ROW_Y - TILE_FOCUSED / 2, TILE_FOCUSED, TILE_FOCUSED};
    Rect r = {lerp(from.x, CONTENT.x, t), lerp(from.y, CONTENT.y, t), lerp(from.w, CONTENT.w, t), lerp(from.h, CONTENT.h, t)};
    fb.fillRoundRect(r, TILE_RADIUS, color::tile);
    outline(fb, r, TILE_RADIUS, true);
  }
}

void Ui::renderCamera(Framebuffer& fb) const {
  const Rect view = {0, PREVIEW_Y, PREVIEW_W, PREVIEW_H};  // full-screen picture
  if (preview_) {  // live frame from the camera, with the Mirror / Flip vertical settings applied
    for (int y = 0; y < view.h; y++) {
      const uint16_t* row = preview_ + (vflipped_ ? view.h - 1 - y : y) * view.w;
      for (int x = 0; x < view.w; x++) fb.pixels[(view.y + y) * WIDTH + x] = row[mirrored_ ? view.w - 1 - x : x];
    }
  } else {  // no camera: color bars, flipped like the real picture would be
    const int bars = sizeof BARS / sizeof BARS[0], split = view.h * 7 / 10;
    for (int i = 0; i < bars; i++) {
      int k = mirrored_ ? bars - 1 - i : i;  // bar edges from the view width: no rounding overflow
      int x0 = view.x + k * view.w / bars, x1 = view.x + (k + 1) * view.w / bars;
      fb.fillRect({x0, vflipped_ ? view.y + view.h - split : view.y, x1 - x0, split}, BARS[i]);
    }
    fb.fillRect({view.x, vflipped_ ? view.y : view.y + split, view.w, view.h - split}, rgb565(0x11, 0x11, 0x11));
  }
  if (grid_) {  // rule of thirds
    for (int i = 1; i < 3; i++) {
      fb.fillRect({view.x + view.w * i / 3, view.y, 1, view.h}, color::white);
      fb.fillRect({view.x, view.y + view.h * i / 3, view.w, 1}, color::white);
    }
  }
  if (flashT_ < FLASH_MS) fb.fillRect(view, color::white);
}

void Ui::renderPictures(Framebuffer& fb) const {
  int row = photoFocus_ == BACK ? (photos_ - 1) / COLS : photoFocus_ / COLS;
  int top = row > 0 ? row - 1 : 0;  // keep the focused row visible
  for (int i = top * COLS; i < photos_ && i < (top + 2) * COLS; i++) {
    Rect r = {GRID_X + (i % COLS) * THUMB_PITCH, GRID_Y + (i / COLS - top) * THUMB_PITCH, THUMB, THUMB};
    photoPlaceholder(fb, r, i, 10);
    outline(fb, r, 10, i == photoFocus_);
  }
}

void Ui::renderSettings(Framebuffer& fb) const {
  const char* const values[SETTING_COUNT] = {RESOLUTIONS[resolution_], mirrored_ ? "On" : "Off",
                                             vflipped_ ? "On" : "Off",    grid_ ? "On" : "Off",
                                             clock12_ ? "12h" : "24h",    "camera-esp"};
  int shown = settingFocus_ == BACK ? SETTING_COUNT - 1 : settingFocus_;
  int top = shown >= VISIBLE_ROWS ? shown - VISIBLE_ROWS + 1 : 0;  // keep the focused row in view
  for (int i = top; i < SETTING_COUNT && i < top + VISIBLE_ROWS; i++) {
    Rect r = {8, ROWS_Y + (i - top) * ROW_PITCH, WIDTH - 16, ROW_H};
    bool focused = i == settingFocus_;
    fb.fillRoundRect(r, 12, color::tile);
    outline(fb, r, 12, focused);
    int textY = r.y + (ROW_H - fonts::small.height) / 2;
    fb.drawText(fonts::small, r.x + 12, textY, SETTING_LABELS[i], color::ink);
    int valueW = Framebuffer::textWidth(fonts::small, values[i]);
    fb.drawText(fonts::small, r.x + r.w - 12 - valueW, textY, values[i], focused ? color::accent : color::text);
  }
}

void Ui::renderViewer(Framebuffer& fb) const {  // full screen, like the camera
  photoPlaceholder(fb, {0, BAR_H + 1, WIDTH, HEIGHT - BAR_H - 1}, photoFocus_, 0);
}

}  // namespace ui

#include "ui.h"

namespace ui {
namespace {

constexpr int BAR_H = 27;  // nav bar; its divider is the row below
constexpr Rect CONTENT = {0, BAR_H + 1, WIDTH, HEIGHT - BAR_H - 1};
constexpr int HINT_Y = 218;

// Home row
constexpr int TILE = 56, TILE_FOCUSED = 64, TILE_PITCH = 76, ROW_Y = 104, TILE_RADIUS = 14;
// Pictures grid: 3 per row, 2 rows visible
constexpr int COLS = 3, THUMB = 64, THUMB_PITCH = 74, GRID_X = 12, GRID_Y = 38;
// Settings rows
constexpr int ROW_H = 40, ROW_PITCH = 46, ROWS_Y = 36;

const char* const PAGE_NAMES[PAGE_COUNT] = {"Camera", "Pictures", "Settings"};
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
    default:  // settings: gear
      fb.fillRect({cx - 13, cy - 3, 26, 6}, color::ink);
      fb.fillRect({cx - 3, cy - 13, 6, 26}, color::ink);
      fb.fillCircle(cx, cy, 9, color::ink);
      fb.fillCircle(cx, cy, 4, color::tile);
  }
}

void drawUsb(Framebuffer& fb, int x, int cy) {  // USB trident, pointing right
  fb.fillCircle(x + 3, cy, 3, color::ink);
  fb.fillRect({x + 3, cy - 1, 18, 3}, color::ink);
  fb.fillRect({x + 20, cy - 3, 4, 7}, color::ink);
  fb.fillRect({x + 8, cy - 6, 2, 6}, color::ink);
  fb.fillRect({x + 8, cy - 6, 6, 2}, color::ink);
  fb.fillRect({x + 13, cy - 7, 4, 4}, color::ink);
  fb.fillRect({x + 12, cy, 2, 6}, color::ink);
  fb.fillRect({x + 12, cy + 4, 5, 2}, color::ink);
  fb.fillCircle(x + 17, cy + 5, 2, color::ink);
}

void drawBattery(Framebuffer& fb, int right, int cy, int percent) {
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
  fb.drawText(fonts::small, body.x - 4 - Framebuffer::textWidth(fonts::small, label), cy - fonts::small.height / 2, label, color::text);
}

void drawHint(Framebuffer& fb, const char* text) {
  fb.drawText(fonts::small, (WIDTH - Framebuffer::textWidth(fonts::small, text)) / 2, HINT_Y, text, color::text);
}

}  // namespace

int easeOut(uint32_t elapsed, uint32_t duration) {
  int t = int((elapsed < duration ? elapsed : duration) * 1024 / duration);
  int inv = 1024 - t;
  return 1024 - inv * inv / 1024 * inv / 1024;
}

int Ui::focus() const {
  switch (screen_) {
    case Screen::Pictures: return photoFocus_;
    case Screen::Settings: return settingFocus_;
    case Screen::Camera: return 0;
    default: return homeFocus_;
  }
}

void Ui::press(Button b) {
  if (openT_ < OPEN_MS) return;  // ignore input while a page is opening
  switch (screen_) {
    case Screen::Home:
      if ((b == Button::Left && homeFocus_ > 0) || (b == Button::Right && homeFocus_ < PAGE_COUNT - 1)) {
        focusFrom_ = homeFocus_;
        homeFocus_ += b == Button::Right ? 1 : -1;
        focusT_ = 0;
      } else if (b == Button::Center) {
        opening_ = Screen(homeFocus_ + 1);
        openT_ = 0;
      }
      return;
    case Screen::Camera:
      if (b == Button::Up) screen_ = Screen::Home;
      else if (b == Button::Center && photos_ < MAX_PHOTOS) {
        photos_++;
        flashT_ = 0;
      } else if (b == Button::Left || b == Button::Right) mirrored_ = !mirrored_;
      else if (b == Button::Down) resolution_ = (resolution_ + 1) % RESOLUTION_COUNT;
      return;
    case Screen::Pictures: {
      int next = photoFocus_;
      if (b == Button::Left && photoFocus_ % COLS > 0) next--;
      if (b == Button::Right && photoFocus_ % COLS < COLS - 1) next++;
      if (b == Button::Down) next += COLS;
      if (b == Button::Up && photoFocus_ < COLS) screen_ = Screen::Home;
      else if (b == Button::Up) next -= COLS;
      if (next < photos_) photoFocus_ = next;
      return;
    }
    case Screen::Settings:
      if (b == Button::Up && settingFocus_ == 0) screen_ = Screen::Home;
      else if (b == Button::Up) settingFocus_--;
      else if (b == Button::Down && settingFocus_ < SETTING_COUNT - 1) settingFocus_++;
      else if (b == Button::Left || b == Button::Right) changeSetting(b == Button::Right ? 1 : -1);
      return;
  }
}

void Ui::changeSetting(int delta) {
  if (settingFocus_ == 0) resolution_ = (resolution_ + delta + RESOLUTION_COUNT) % RESOLUTION_COUNT;
  if (settingFocus_ == 1) mirrored_ = !mirrored_;
  if (settingFocus_ == 2) vflipped_ = !vflipped_;
}

void Ui::tick(uint32_t ms) {
  focusT_ = advance(focusT_, ms, FOCUS_MS);
  flashT_ = advance(flashT_, ms, FLASH_MS);
  if (openT_ < OPEN_MS) {
    openT_ = advance(openT_, ms, OPEN_MS);
    if (openT_ == OPEN_MS) screen_ = opening_;
  }
}

void Ui::render(Framebuffer& fb) const {
  fb.fill(color::bg);
  switch (screen_) {
    case Screen::Home: renderHome(fb); break;
    case Screen::Camera: renderCamera(fb); break;
    case Screen::Pictures: renderPictures(fb); break;
    case Screen::Settings: renderSettings(fb); break;
  }
  renderNavBar(fb, screen_ == Screen::Home ? nullptr : PAGE_NAMES[int(screen_) - 1]);
}

void Ui::renderNavBar(Framebuffer& fb, const char* title) const {
  fb.fillRect({0, 0, WIDTH, BAR_H}, color::bar);
  fb.fillRect({0, BAR_H, WIDTH, 1}, color::line);
  char clock[6], *p = twoDigits(clock, minutes_ / 60);
  *p++ = ':';
  *twoDigits(p, minutes_ % 60) = 0;
  int x = fb.drawText(fonts::large, 8, 1, clock, color::text);
  if (title) fb.drawText(fonts::small, x + 10, 6, title, color::ink);
  if (link_ == Link::Usb) drawUsb(fb, WIDTH - 32, BAR_H / 2);
  if (link_ == Link::Battery) drawBattery(fb, WIDTH - 6, BAR_H / 2, battery_);
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
    fb.strokeRoundRect(r, TILE_RADIUS, focused ? 3 : 1, focused ? color::accent : color::line);
    drawIcon(fb, i, cx, ROW_Y);
    const char* name = PAGE_NAMES[i];
    fb.drawText(fonts::small, cx - Framebuffer::textWidth(fonts::small, name) / 2, ROW_Y + TILE_FOCUSED / 2 + 6, name, focused ? color::ink : color::text);
  }
  for (int i = 0; i < PAGE_COUNT; i++) fb.fillCircle(WIDTH / 2 + (i - 1) * 14, 190, 3, i == homeFocus_ ? color::accent : color::line);
  drawHint(fb, "<  >  move        center  open");

  if (openT_ < OPEN_MS) {  // the focused tile zooms out to fill the page, like opening a channel
    int t = easeOut(openT_, OPEN_MS);
    Rect from = {WIDTH / 2 - TILE_FOCUSED / 2, ROW_Y - TILE_FOCUSED / 2, TILE_FOCUSED, TILE_FOCUSED};
    Rect r = {lerp(from.x, CONTENT.x, t), lerp(from.y, CONTENT.y, t), lerp(from.w, CONTENT.w, t), lerp(from.h, CONTENT.h, t)};
    fb.fillRoundRect(r, TILE_RADIUS, color::tile);
    fb.strokeRoundRect(r, TILE_RADIUS, 3, color::accent);
  }
}

void Ui::renderCamera(Framebuffer& fb) const {
  // No sensor in the emulator: color bars stand in for the preview, flipped like the real one.
  const Rect view = {6, 34, WIDTH - 12, 172};
  const int bars = sizeof BARS / sizeof BARS[0], split = view.h * 7 / 10;
  for (int i = 0; i < bars; i++) {
    int k = mirrored_ ? bars - 1 - i : i;  // bar edges from the view width: no rounding overflow
    int x0 = view.x + k * view.w / bars, x1 = view.x + (k + 1) * view.w / bars;
    fb.fillRect({x0, vflipped_ ? view.y + view.h - split : view.y, x1 - x0, split}, BARS[i]);
  }
  fb.fillRect({view.x, vflipped_ ? view.y : view.y + split, view.w, view.h - split}, rgb565(0x11, 0x11, 0x11));
  if (flashT_ < FLASH_MS) fb.fillRect(view, color::white);
  fb.maskRoundRect(view, 12, color::bg);
  fb.drawText(fonts::small, view.x + 8, view.y + view.h - 22, RESOLUTIONS[resolution_], color::white);
  fb.fillCircle(view.x + view.w - 18, view.y + view.h - 16, 9, color::white);
  fb.fillCircle(view.x + view.w - 18, view.y + view.h - 16, 6, LOW_BATTERY);
  drawHint(fb, "^ home   center shoot   < > flip");
}

void Ui::renderPictures(Framebuffer& fb) const {
  int top = photoFocus_ / COLS > 0 ? photoFocus_ / COLS - 1 : 0;  // keep the focused row visible
  for (int i = top * COLS; i < photos_ && i < (top + 2) * COLS; i++) {
    Rect r = {GRID_X + (i % COLS) * THUMB_PITCH, GRID_Y + (i / COLS - top) * THUMB_PITCH, THUMB, THUMB};
    fb.fillRoundRect(r, 10, THUMB_COLORS[i % 5]);
    fb.fillCircle(r.x + 46, r.y + 18, 7, color::tile);  // a sun over a hill, as a stand-in thumbnail
    fb.fillRoundRect({r.x + 6, r.y + 38, 52, 20}, 8, color::tile);
    fb.strokeRoundRect(r, 10, i == photoFocus_ ? 3 : 1, i == photoFocus_ ? color::accent : color::line);
  }
  char name[] = "IMG_0000.jpg";
  twoDigits(name + 6, (photoFocus_ + 1) % 100);
  fb.drawText(fonts::small, GRID_X, GRID_Y + 2 * THUMB_PITCH + 4, name, color::ink);
}

void Ui::renderSettings(Framebuffer& fb) const {
  const char* const labels[SETTING_COUNT] = {"Resolution", "Mirror", "Flip vertical", "About"};
  const char* const values[SETTING_COUNT] = {RESOLUTIONS[resolution_], mirrored_ ? "On" : "Off", vflipped_ ? "On" : "Off", "camera-esp"};
  for (int i = 0; i < SETTING_COUNT; i++) {
    Rect r = {8, ROWS_Y + i * ROW_PITCH, WIDTH - 16, ROW_H};
    bool focused = i == settingFocus_;
    fb.fillRoundRect(r, 12, color::tile);
    fb.strokeRoundRect(r, 12, focused ? 3 : 1, focused ? color::accent : color::line);
    int textY = r.y + (ROW_H - fonts::small.height) / 2;
    fb.drawText(fonts::small, r.x + 12, textY, labels[i], color::ink);
    int valueW = Framebuffer::textWidth(fonts::small, values[i]);
    int valueX = r.x + r.w - 14 - valueW - (focused && i < 3 ? 14 : 0);
    fb.drawText(fonts::small, valueX, textY, values[i], focused ? color::accent : color::text);
    if (focused && i < 3) {  // changeable: show the arrows
      fb.drawText(fonts::small, valueX - 12, textY, "<", color::accent);
      fb.drawText(fonts::small, r.x + r.w - 20, textY, ">", color::accent);
    }
  }
}

}  // namespace ui

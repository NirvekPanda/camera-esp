// Native tests for firmware/lib/ui: `make uitest`.
#include <stdio.h>
#include <string.h>

#include <vector>

#include "../lib/ui/src/framebuffer.h"
#include "../lib/ui/src/st7789.h"
#include "../lib/ui/src/st7789_emulator.h"
#include "../lib/ui/src/ui.h"
#include "golden.h"

using namespace ui;

// --- minimal test harness ---------------------------------------------------------------------

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                    \
  do {                                                                 \
    checks++;                                                          \
    if (!(cond)) {                                                     \
      failures++;                                                      \
      printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);         \
    }                                                                  \
  } while (0)

#define CHECK_EQ(a, b)                                                                  \
  do {                                                                                  \
    checks++;                                                                           \
    long long a_ = (long long)(a), b_ = (long long)(b);                                 \
    if (a_ != b_) {                                                                     \
      failures++;                                                                       \
      printf("  FAIL %s:%d: %s == %s (0x%llx vs 0x%llx)\n", __FILE__, __LINE__, #a, #b, \
             a_, b_);                                                                   \
    }                                                                                   \
  } while (0)

struct TestCase {
  const char* name;
  void (*fn)();
};
static std::vector<TestCase>& tests() {
  static std::vector<TestCase> all;
  return all;
}
struct Register {
  Register(const char* name, void (*fn)()) { tests().push_back({name, fn}); }
};
#define TEST(name)                               \
  static void name();                            \
  static Register register_##name(#name, name);  \
  static void name()

// Framebuffers are big; tests share a few instead of putting them on the stack.
static Framebuffer fb, fb2;

// Records everything sent to the panel.
struct RecordingBus : SpiBus {
  std::vector<int> commands;
  std::vector<uint8_t> bytes;
  void command(uint8_t c) override { commands.push_back(c); }
  void data(const uint8_t* b, size_t n) override { bytes.insert(bytes.end(), b, b + n); }
};

// Delivers data one byte at a time, like a DMA-less SPI loop would.
struct ByteByByteBus : SpiBus {
  SpiBus& target;
  explicit ByteByByteBus(SpiBus& t) : target(t) {}
  void command(uint8_t c) override { target.command(c); }
  void data(const uint8_t* b, size_t n) override {
    for (size_t i = 0; i < n; i++) target.data(b + i, 1);
  }
};

static void pattern(Framebuffer& f) {
  for (int y = 0; y < HEIGHT; y++)
    for (int x = 0; x < WIDTH; x++) f.pixels[y * WIDTH + x] = uint16_t(x * 131 + y * 977 + (x ^ y));
}

static bool panelMatches(St7789Emulator& panel, const Framebuffer& f) {
  for (int y = 0; y < HEIGHT; y++)
    for (int x = 0; x < WIDTH; x++)
      if (panel.shown(x, y) != f.at(x, y)) return false;
  return true;
}

static bool regionIs(const Framebuffer& f, Rect r, uint16_t c) {
  for (int y = r.y; y < r.y + r.h; y++)
    for (int x = r.x; x < r.x + r.w; x++)
      if (f.at(x, y) != c) return false;
  return true;
}

static bool regionHas(const Framebuffer& f, Rect r, uint16_t c) {
  for (int y = r.y; y < r.y + r.h; y++)
    for (int x = r.x; x < r.x + r.w; x++)
      if (f.at(x, y) == c) return true;
  return false;
}

static bool sameRegion(const Framebuffer& a, const Framebuffer& b, Rect r) {
  for (int y = r.y; y < r.y + r.h; y++)
    for (int x = r.x; x < r.x + r.w; x++)
      if (a.at(x, y) != b.at(x, y)) return false;
  return true;
}

// --- framebuffer ------------------------------------------------------------------------------

TEST(fill_and_rect_clip) {
  fb.fill(color::bg);
  CHECK(regionIs(fb, {0, 0, WIDTH, HEIGHT}, color::bg));
  fb.fillRect({-10, -10, 20, 20}, color::accent);  // partly off-screen
  CHECK(regionIs(fb, {0, 0, 10, 10}, color::accent));
  CHECK_EQ(fb.at(10, 10), color::bg);
  fb.fillRect({230, 230, 50, 50}, color::ink);
  CHECK(regionIs(fb, {230, 230, 10, 10}, color::ink));
  fb.fillRect({300, 300, 5, 5}, color::ink);  // fully off-screen: no effect, no crash
  fb.fillRect({50, 50, -5, 10}, color::ink);  // negative size: no effect
  CHECK_EQ(fb.at(50, 50), color::bg);
}

TEST(round_rect_keeps_corners) {
  fb.fill(color::bg);
  fb.fillRoundRect({20, 20, 60, 40}, 10, color::tile);
  CHECK_EQ(fb.at(20, 20), color::bg);  // corners cut
  CHECK_EQ(fb.at(79, 59), color::bg);
  CHECK_EQ(fb.at(50, 40), color::tile);  // center
  CHECK_EQ(fb.at(50, 20), color::tile);  // top edge middle
  CHECK_EQ(fb.at(20, 40), color::tile);  // left edge middle
  CHECK_EQ(fb.at(19, 40), color::bg);    // just outside
}

TEST(round_rect_stroke_leaves_inside) {
  fb.fill(color::bg);
  fb.strokeRoundRect({20, 20, 60, 40}, 10, 3, color::accent);
  CHECK_EQ(fb.at(50, 20), color::accent);
  CHECK_EQ(fb.at(50, 22), color::accent);
  CHECK_EQ(fb.at(50, 23), color::bg);  // inside the 3 px border
  CHECK_EQ(fb.at(50, 40), color::bg);
  CHECK_EQ(fb.at(20, 20), color::bg);  // corner still cut
}

TEST(mask_round_rect_rounds_corners_only) {
  fb.fill(color::accent);
  fb.maskRoundRect({20, 20, 60, 40}, 10, color::bg);
  CHECK_EQ(fb.at(20, 20), color::bg);      // corner masked
  CHECK_EQ(fb.at(50, 40), color::accent);  // inside kept
  CHECK_EQ(fb.at(10, 10), color::accent);  // outside r untouched
}

TEST(circle) {
  fb.fill(color::bg);
  fb.fillCircle(100, 100, 10, color::ink);
  CHECK_EQ(fb.at(100, 100), color::ink);
  CHECK_EQ(fb.at(110, 100), color::ink);
  CHECK_EQ(fb.at(111, 100), color::bg);
  CHECK_EQ(fb.at(108, 108), color::bg);  // bounding-box corner is outside the circle
}

TEST(text) {
  fb.fill(color::bar);
  CHECK_EQ(Framebuffer::textWidth(fonts::small, ""), 0);
  int width = Framebuffer::textWidth(fonts::large, "14:23");
  CHECK(width > 30 && width < 70);
  int end = fb.drawText(fonts::large, 10, 2, "14:23", color::text);
  CHECK_EQ(end, 10 + width);
  CHECK(regionHas(fb, {10, 2, width, fonts::large.height}, color::text));  // solid glyph pixels
  CHECK(regionIs(fb, {10 + width + 1, 0, 20, 30}, color::bar));           // nothing past the end
  fb.drawText(fonts::large, 230, 2, "clipped at the edge", color::text);  // must not crash
}

// --- ST7789 driver + emulator -----------------------------------------------------------------

TEST(init_sequence) {
  RecordingBus bus;
  st7789::init(bus);
  std::vector<int> expected = {st7789::SWRESET, st7789::SLPOUT, st7789::COLMOD, st7789::MADCTL,
                               st7789::INVON, st7789::DISPON};
  CHECK(bus.commands == expected);
  CHECK(bus.bytes == (std::vector<uint8_t>{st7789::COLMOD_RGB565, 0x00}));  // COLMOD, MADCTL params
}

TEST(flush_sends_window_then_big_endian_pixels) {
  fb.fill(0);
  fb.pixels[5 * WIDTH + 7] = 0x1234;
  RecordingBus bus;
  st7789::flush(bus, fb, {7, 5, 1, 1});
  CHECK(bus.commands == (std::vector<int>{st7789::CASET, st7789::RASET, st7789::RAMWR}));
  CHECK(bus.bytes == (std::vector<uint8_t>{0, 7, 0, 7, 0, 5, 0, 5, 0x12, 0x34}));
}

TEST(panel_is_dark_until_initialized) {
  static St7789Emulator panel;
  pattern(fb);
  st7789::flush(panel, fb);
  CHECK(!panel.displayOn());
  CHECK_EQ(panel.shown(10, 10), 0);
}

TEST(full_frame_round_trips) {
  static St7789Emulator panel;
  pattern(fb);
  st7789::init(panel);
  st7789::flush(panel, fb);
  CHECK(panel.displayOn());
  CHECK(panelMatches(panel, fb));
}

TEST(split_bytes_round_trip) {
  static St7789Emulator panel;
  ByteByByteBus bus(panel);
  pattern(fb);
  st7789::init(bus);
  st7789::flush(bus, fb);
  CHECK(panelMatches(panel, fb));
}

TEST(partial_window_only_changes_that_window) {
  static St7789Emulator panel;
  st7789::init(panel);
  fb.fill(color::bg);
  st7789::flush(panel, fb);
  fb.fillRect({100, 60, 40, 30}, color::accent);
  st7789::flush(panel, fb, {100, 60, 40, 30});
  CHECK(panelMatches(panel, fb));
}

TEST(window_wraps_to_its_start) {
  static St7789Emulator panel;
  st7789::init(panel);
  const uint8_t window[] = {0, 10, 0, 11};  // 2 columns wide, same for rows
  panel.command(st7789::CASET);
  panel.data(window, 4);
  panel.command(st7789::RASET);
  panel.data(window, 4);
  panel.command(st7789::RAMWR);
  const uint8_t pixels[] = {0x11, 0x11, 0x22, 0x22, 0x33, 0x33, 0x44, 0x44, 0x55, 0x55};
  panel.data(pixels, sizeof pixels);  // 5 pixels into a 2x2 window: the 5th wraps to the start
  // INVON cancels the panel's native inversion, so shown == written.
  CHECK_EQ(panel.shown(10, 10), 0x5555);
  CHECK_EQ(panel.shown(11, 10), 0x2222);
  CHECK_EQ(panel.shown(10, 11), 0x3333);
  CHECK_EQ(panel.shown(11, 11), 0x4444);
}

TEST(missing_invon_shows_inverted_colors) {
  static St7789Emulator panel;
  panel.command(st7789::SLPOUT);
  const uint8_t rgb565 = st7789::COLMOD_RGB565;
  panel.command(st7789::COLMOD);
  panel.data(&rgb565, 1);
  panel.command(st7789::DISPON);
  fb.fill(color::accent);
  st7789::flush(panel, fb);
  CHECK_EQ(panel.shown(0, 0), uint16_t(~color::accent));
}

TEST(missing_colmod_garbles_pixels) {
  static St7789Emulator panel;
  panel.command(st7789::SLPOUT);
  panel.command(st7789::INVON);
  panel.command(st7789::DISPON);
  pattern(fb);
  st7789::flush(panel, fb);  // 16-bit pixels read as the reset default 18-bit (3 bytes each)
  CHECK(!panelMatches(panel, fb));
}

TEST(madctl_mx_mirrors) {
  static St7789Emulator panel;
  st7789::init(panel);
  const uint8_t mx = 0x40;
  panel.command(st7789::MADCTL);
  panel.data(&mx, 1);
  fb.fill(0);
  fb.pixels[0] = 0xF800;  // top-left
  st7789::flush(panel, fb);
  CHECK_EQ(panel.shown(WIDTH - 1, 0), 0xF800);  // appears top-right
  CHECK_EQ(panel.shown(0, 0), 0);
}

// --- UI -----------------------------------------------------------------------------------------

TEST(ease_out) {
  CHECK_EQ(easeOut(0, 200), 0);
  CHECK_EQ(easeOut(200, 200), 1024);
  CHECK_EQ(easeOut(500, 200), 1024);
  CHECK(easeOut(100, 200) > 512);  // front-loaded
  int last = -1;
  for (uint32_t t = 0; t <= 200; t += 10) {
    CHECK(easeOut(t, 200) >= last);
    last = easeOut(t, 200);
  }
}

TEST(home_focus_moves_and_clamps) {
  Ui ui;
  CHECK(ui.screen() == Screen::Home);
  CHECK_EQ(ui.focus(), 0);
  ui.press(Button::Left);  // already at the first tile
  CHECK_EQ(ui.focus(), 0);
  ui.press(Button::Right);
  CHECK_EQ(ui.focus(), 1);
  CHECK(ui.animating());
  ui.tick(FOCUS_MS);
  CHECK(!ui.animating());
  ui.press(Button::Right);
  ui.press(Button::Right);  // past the last tile
  CHECK_EQ(ui.focus(), PAGE_COUNT - 1);
}

TEST(home_row_slides_between_frames) {
  Ui ui;
  ui.tick(FOCUS_MS);
  ui.render(fb);
  ui.press(Button::Right);
  ui.tick(FOCUS_MS / 2);
  ui.render(fb2);
  CHECK(!sameRegion(fb, fb2, {0, 40, WIDTH, 150}));  // mid-animation frame differs from the start
  ui.tick(FOCUS_MS);
  ui.render(fb);
  CHECK(!sameRegion(fb, fb2, {0, 40, WIDTH, 150}));  // and from the end
}

TEST(huge_tick_saturates_instead_of_restarting_animations) {
  Ui ui;
  ui.press(Button::Right);
  ui.tick(FOCUS_MS);
  ui.tick(0xFFFFFFFDu);  // e.g. a negative step cast to unsigned: must not wrap timers backwards
  CHECK(!ui.animating());
}

// Opens home tile `page` (0 Camera, 1 Pictures, 2 Settings) from a fresh UI.
static void openPage(Ui& ui, int page) {
  for (int i = 0; i < page; i++) ui.press(Button::Right);
  ui.press(Button::Center);
  ui.tick(OPEN_MS);
}

// Moves focus to the Back button (bottom-left on every page) and presses it.
static void goBack(Ui& ui) {
  for (int i = 0; i < 12 && ui.focus() != BACK; i++) ui.press(Button::Down);
  ui.press(Button::Left);  // from the primary action (bottom-right) to Back
  CHECK_EQ(ui.focus(), BACK);
  ui.press(Button::Center);
}

TEST(center_opens_page_after_zoom) {
  Ui ui;
  ui.press(Button::Center);
  CHECK(ui.screen() == Screen::Home);  // still zooming
  ui.tick(OPEN_MS);
  CHECK(ui.screen() == Screen::Camera);
}

TEST(camera_focuses_shoot_and_back_returns_home) {
  Ui ui;
  openPage(ui, 0);
  CHECK_EQ(ui.focus(), PRIMARY);  // the primary action starts focused
  int before = ui.photoCount();
  ui.press(Button::Center);
  CHECK_EQ(ui.photoCount(), before + 1);
  CHECK(ui.animating());  // flash
  ui.tick(FLASH_MS);
  CHECK(!ui.animating());
  ui.press(Button::Left);
  CHECK_EQ(ui.focus(), BACK);
  ui.press(Button::Right);
  CHECK_EQ(ui.focus(), PRIMARY);
  ui.press(Button::Left);
  ui.press(Button::Center);
  CHECK(ui.screen() == Screen::Home);
  CHECK_EQ(ui.focus(), 0);  // back on the tile that was opened
}

TEST(arrows_never_change_settings_or_leave_pages) {
  Ui ui;
  openPage(ui, 0);
  bool mirrored = ui.mirrored();
  int resolution = ui.resolution();
  for (Button b : {Button::Up, Button::Up, Button::Left, Button::Right, Button::Down}) ui.press(b);
  CHECK(ui.screen() == Screen::Camera);  // no hidden "Up = home" shortcut
  CHECK_EQ(ui.mirrored(), mirrored);    // no hidden "Left/Right = flip" shortcut
  CHECK_EQ(ui.resolution(), resolution);
}

TEST(pictures_grid_bottom_bar_and_viewer) {
  Ui ui;
  openPage(ui, 1);
  CHECK(ui.screen() == Screen::Pictures);
  CHECK_EQ(ui.focus(), 0);
  ui.press(Button::Up);  // top row: stays, no shortcut home
  CHECK(ui.screen() == Screen::Pictures);
  ui.press(Button::Right);
  CHECK_EQ(ui.focus(), 1);
  ui.press(Button::Down);  // 3 per row
  CHECK_EQ(ui.focus(), 4);
  ui.press(Button::Down);  // nothing below: the bottom bar
  CHECK_EQ(ui.focus(), BACK);
  ui.press(Button::Up);  // back into the grid
  CHECK_EQ(ui.focus(), 4);
  ui.press(Button::Center);  // Center activates the focused photo
  CHECK(ui.screen() == Screen::Viewer);
  CHECK_EQ(ui.focus(), BACK);  // the viewer's only control
  ui.press(Button::Center);
  CHECK(ui.screen() == Screen::Pictures);
  CHECK_EQ(ui.focus(), 4);  // same photo still focused
  goBack(ui);
  CHECK(ui.screen() == Screen::Home);
}

TEST(settings_center_changes_value) {
  Ui ui;
  openPage(ui, 2);
  CHECK(ui.screen() == Screen::Settings);
  CHECK_EQ(ui.focus(), 0);
  CHECK_EQ(ui.resolution(), RESOLUTION_COUNT - 1);
  ui.press(Button::Center);  // resolution cycles forward and wraps
  CHECK_EQ(ui.resolution(), 0);
  ui.press(Button::Down);
  ui.press(Button::Center);
  CHECK(ui.mirrored());
  ui.press(Button::Down);
  ui.press(Button::Center);
  CHECK(ui.vflipped());
  ui.press(Button::Down);
  ui.press(Button::Down);  // past the last row: the bottom bar
  CHECK_EQ(ui.focus(), BACK);
  ui.press(Button::Up);
  CHECK_EQ(ui.focus(), SETTING_COUNT - 1);
  goBack(ui);
  CHECK(ui.screen() == Screen::Home);
}

TEST(pictures_reopens_on_last_viewed_photo) {
  Ui ui;
  openPage(ui, 1);
  ui.press(Button::Right);
  ui.press(Button::Down);  // photo index 4
  goBack(ui);              // via the bottom bar
  CHECK(ui.screen() == Screen::Home);
  ui.press(Button::Center);
  ui.tick(OPEN_MS);
  CHECK_EQ(ui.focus(), 4);
}

TEST(down_enters_a_partly_filled_row_before_the_bottom_bar) {
  Ui ui;  // 5 photos: row 0 = 0 1 2, row 1 = 3 4
  openPage(ui, 1);
  ui.press(Button::Right);
  ui.press(Button::Right);  // index 2, top-right
  ui.press(Button::Down);   // nothing directly below: the row's last photo, not Back
  CHECK_EQ(ui.focus(), 4);
  ui.press(Button::Down);
  CHECK_EQ(ui.focus(), BACK);
  ui.press(Button::Up);  // back to where focus left the grid
  CHECK_EQ(ui.focus(), 4);
}

TEST(no_flash_when_no_photo_is_taken) {
  Ui ui;
  openPage(ui, 0);
  while (ui.photoCount() < MAX_PHOTOS) ui.press(Button::Center), ui.tick(FLASH_MS);
  ui.press(Button::Center);  // storage full: nothing saved
  CHECK_EQ(ui.photoCount(), MAX_PHOTOS);
  CHECK(!ui.animating());  // so no shutter flash either
}

// The Back button is the same pixels in the same place on every page.
TEST(back_button_is_identical_on_every_page) {
  const Rect back = {0, 206, WIDTH / 2, HEIGHT - 206};
  Ui camera, pictures, settings;
  openPage(camera, 0);  // Shoot focused: Back unfocused
  openPage(pictures, 1);
  openPage(settings, 2);
  camera.render(fb);
  pictures.render(fb2);
  CHECK(sameRegion(fb, fb2, back));
  settings.render(fb2);
  CHECK(sameRegion(fb, fb2, back));
  CHECK(!regionHas(fb, back, color::accent));  // unfocused
  camera.press(Button::Left);
  camera.render(fb);
  CHECK(regionHas(fb, back, color::accent));  // focused: the same blue outline as tiles
}

TEST(no_hint_text_on_home) {
  Ui ui;
  ui.tick(FOCUS_MS);
  ui.render(fb);
  CHECK(!regionHas(fb, {0, 206, WIDTH, HEIGHT - 206}, color::text));  // bottom bar: page dots only
}

TEST(nav_bar_time_and_link_icon) {
  Ui ui;
  const Rect clock = {0, 0, 80, 28}, icon = {180, 0, 60, 27};
  ui.setTime(14 * 60 + 23);
  ui.render(fb);
  CHECK_EQ(fb.at(120, 27), color::line);  // divider under the bar
  CHECK(regionHas(fb, clock, color::text));
  CHECK(regionIs(fb, icon, color::bar));  // no link: empty corner
  ui.setTime(9 * 60 + 5);
  ui.render(fb2);
  CHECK(!sameRegion(fb, fb2, clock));

  ui.setLink(Link::Usb);
  ui.render(fb);
  CHECK(regionHas(fb, icon, color::ink));
  ui.setLink(Link::Battery, 80);
  ui.render(fb2);
  CHECK(!sameRegion(fb, fb2, icon));  // battery looks different from USB
}

TEST(focused_home_tile_has_accent_outline) {
  Ui ui;
  ui.tick(FOCUS_MS);
  ui.render(fb);
  CHECK(regionHas(fb, {80, 40, 80, 120}, color::accent));  // focused tile is centered
}

TEST(golden_session_hash) {
  uint32_t hash = golden::run();
  if (golden::EXPECTED_HASH == 0) printf("  golden hash: 0x%08x (pin it in golden.h)\n", hash);
  CHECK_EQ(hash, golden::EXPECTED_HASH);
}

int main() {
  for (const TestCase& t : tests()) {
    int before = failures;
    t.fn();
    printf("%s %s\n", failures == before ? "ok  " : "FAIL", t.name);
  }
  printf("\n%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}

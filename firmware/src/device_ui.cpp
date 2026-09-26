#include "device_ui.h"

#include <Arduino.h>
#include <SPI.h>
#include <esp_heap_caps.h>

#include <st7789.h>
#include <ui.h>

#include "pins.h"

namespace device_ui {
namespace {

constexpr uint32_t PANEL_HZ = 40000000;  // ST7789 datasheet allows 62.5 MHz; 40 is the safe step
constexpr uint32_t DEBOUNCE_MS = 25;
constexpr uint32_t CLOCK_REDRAW_MS = 1000;  // the nav bar clock, and a repaint after SD traffic

// 4-wire SPI on the bus the microSD card shares (SCK D8, MOSI D10). The panel's CS is tied to GND
// on the board, so it sees the card's traffic too: parking DC high makes those bytes land in its
// RAM as pixels (visible mess, redrawn a moment later) instead of being read as commands.
class PanelBus : public ui::SpiBus {
 public:
  void begin() {
    pinMode(TFT_DC_GPIO, OUTPUT);
    digitalWrite(TFT_DC_GPIO, HIGH);
    if (TFT_CS_GPIO >= 0) {
      pinMode(TFT_CS_GPIO, OUTPUT);
      digitalWrite(TFT_CS_GPIO, HIGH);
    }
  }

  void command(uint8_t cmd) override {
    transaction([&] {
      digitalWrite(TFT_DC_GPIO, LOW);
      SPI.write(cmd);
      digitalWrite(TFT_DC_GPIO, HIGH);
    });
  }

  void data(const uint8_t* bytes, size_t length) override {
    transaction([&] { SPI.writeBytes(bytes, length); });
  }

  void delayMs(int ms) override { delay(ms); }

 private:
  // One transaction per call keeps the bus shared with SD.h, which takes it the same way.
  template <typename Body>
  void transaction(Body body) {
    SPI.beginTransaction(SPISettings(PANEL_HZ, MSBFIRST, SPI_MODE0));
    if (TFT_CS_GPIO >= 0) digitalWrite(TFT_CS_GPIO, LOW);
    body();
    if (TFT_CS_GPIO >= 0) digitalWrite(TFT_CS_GPIO, HIGH);
    SPI.endTransaction();
  }
};

struct ButtonPin {
  int gpio;
  ui::Button button;
  bool cameraOnly;  // the shutter only acts in the Camera app, where Center is the shutter
};

// Every switch leg goes to GND, so a pin reads LOW while it is held.
const ButtonPin BUTTONS[] = {
    {SW_UP_GPIO, ui::Button::Up, false},        {SW_DOWN_GPIO, ui::Button::Down, false},
    {SW_LEFT_GPIO, ui::Button::Left, false},    {SW_RIGHT_GPIO, ui::Button::Right, false},
    {SW_CENTER_GPIO, ui::Button::Center, false}, {BTN_A_GPIO, ui::Button::A, false},
    {BTN_B_GPIO, ui::Button::B, false},          {BTN_SHUTTER_GPIO, ui::Button::Center, true},
};
constexpr int BUTTON_COUNT = sizeof BUTTONS / sizeof BUTTONS[0];

PanelBus panel;
ui::Ui device;
SdPhotoLibrary* photos = nullptr;
ui::Framebuffer* frame = nullptr;  // 115 KB: PSRAM, next to the camera's buffers
Host host = {};
bool held[BUTTON_COUNT] = {};
uint32_t settledAt[BUTTON_COUNT] = {};
uint32_t lastTickMs = 0, lastDrawMs = 0;
bool dirty = true;

void pollButtons(uint32_t now) {
  for (int i = 0; i < BUTTON_COUNT; i++) {
    const bool down = digitalRead(BUTTONS[i].gpio) == LOW;
    if (down == held[i]) continue;
    if (now - settledAt[i] < DEBOUNCE_MS) continue;  // contact bounce, not a press
    settledAt[i] = now;
    held[i] = down;
    if (!down) continue;  // act on the press, not the release
    if (BUTTONS[i].cameraOnly && device.screen() != ui::Screen::Camera) continue;
    device.press(BUTTONS[i].button);
    dirty = true;
  }
}

// The shutter and a confirmed delete are the host's to carry out; the library then changes.
void runRequests() {
  char name[ui::PHOTO_NAME_MAX];
  bool changed = false;
  for (int n = device.takeCaptureRequests(); n > 0; n--) changed |= host.capturePhoto();
  if (device.takeDeleteRequest(name)) changed |= host.deletePhoto(name);
  if (!changed) return;
  photos->refresh();
  device.libraryChanged();
  dirty = true;
}

}  // namespace

bool begin(SdPhotoLibrary& library, const Host& callbacks) {
  host = callbacks;
  photos = &library;
  frame = static_cast<ui::Framebuffer*>(heap_caps_malloc(sizeof(ui::Framebuffer), MALLOC_CAP_SPIRAM));
  if (!frame) return false;
  for (int i = 0; i < BUTTON_COUNT; i++) pinMode(BUTTONS[i].gpio, INPUT_PULLUP);
  SPI.begin(TFT_SCK_GPIO, SPI_MISO_GPIO, TFT_MOSI_GPIO);  // the bus the card is already on
  panel.begin();
  ui::st7789::init(panel);
  device.setLibrary(&library);
  lastTickMs = millis();
  return true;
}

void loop(bool usbLinked, int minutes) {
  if (!frame) return;
  const uint32_t now = millis();
  pollButtons(now);
  runRequests();
  device.tick(now - lastTickMs);
  lastTickMs = now;

  // No battery gauge on the board yet, so off USB the nav bar shows no link icon at all.
  device.setLink(usbLinked ? ui::Link::Usb : ui::Link::None);
  if (minutes >= 0) device.setTime(minutes);
  // The Camera app shows the sensor's own frames; every other page leaves the sensor alone.
  device.setPreview(device.screen() == ui::Screen::Camera ? host.cameraFrame() : nullptr);

  if (!dirty && !device.animating() && now - lastDrawMs < CLOCK_REDRAW_MS) return;
  device.render(*frame);
  ui::st7789::flush(panel, *frame);
  lastDrawMs = now;
  dirty = false;
}

}  // namespace device_ui

// Camera firmware: streams JPEG frames to the website over USB and saves photos to the SD card.
// Every command gets exactly one reply (OK, a data packet, or ERROR), in order. See docs/plan.md.
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include <esp_camera.h>
#include <sys/time.h>

#include "camera_pins.h"
#include "jpeg.h"
#include "protocol.h"
#include "sd_photo_library.h"

using namespace protocol;

namespace {

const char* const PHOTO_DIR = "/photos";

struct FrameSize {
  uint16_t width, height;
  framesize_t size;
};

// Must match RESOLUTIONS in web/src/lib/camera/settings.ts. The sensor has no 480x480 or 720x720
// mode, so those send VGA/HD frames and the site center-crops them.
const FrameSize FRAME_SIZES[] = {
    {240, 240, FRAMESIZE_240X240}, {480, 480, FRAMESIZE_VGA},   {720, 720, FRAMESIZE_HD},
    {320, 240, FRAMESIZE_QVGA},    {640, 480, FRAMESIZE_VGA},   {800, 600, FRAMESIZE_SVGA},
    {1280, 720, FRAMESIZE_HD},     {1600, 1200, FRAMESIZE_UXGA}, {1920, 1080, FRAMESIZE_FHD},
};

// Photos use the sensor's largest size and a finer JPEG quality, whatever the stream is set to.
struct PhotoSize {
  framesize_t size;
  uint16_t width, height;
};
const PhotoSize OV3660_PHOTO = {FRAMESIZE_QXGA, 2048, 1536};
const PhotoSize OV2640_PHOTO = {FRAMESIZE_UXGA, 1600, 1200};
constexpr int STREAM_QUALITY = 12, PHOTO_QUALITY = 10;  // lower = finer

sensor_t* sensor = nullptr;  // null if the camera failed to start
PhotoSize photo = OV2640_PHOTO;
const FrameSize* requested = &FRAME_SIZES[0];  // the stream size the site asked for
bool baseVflip = false;  // true for sensors mounted upside down; VFLIP toggles relative to it
bool sdReady = false;
bool timeSynced = false;
bool streaming = false;
uint32_t frameIntervalMs = 1000 / 15;
uint32_t lastFrameMs = 0;
Parser parser;
SdPhotoLibrary library;

// Frame buffers are sized at init for `size`: it must be the largest size the sensor will use.
bool startCamera(framesize_t size) {
  camera_config_t config = {};
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.ledc_timer = LEDC_TIMER_0;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = size;
  config.jpeg_quality = STREAM_QUALITY;
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;
  return esp_camera_init(&config) == ESP_OK;
}

bool initCamera() {
  // One init with buffers for QXGA, the largest photo: the driver clamps it to the sensor's
  // maximum (UXGA on an OV2640). Never deinit and re-init: on the S3 that hangs in the DMA
  // teardown ("gdma_disconnect: no peripheral is connected") and the firmware stops responding.
  if (!startCamera(FRAMESIZE_QXGA)) return false;
  sensor = esp_camera_sensor_get();
  if (sensor->id.PID == OV3660_PID) photo = OV3660_PHOTO;
  baseVflip = sensor->id.PID == OV3660_PID;  // OV3660 modules are mounted flipped
  sensor->set_vflip(sensor, baseVflip);
  sensor->set_framesize(sensor, FRAMESIZE_240X240);
  return true;
}

void ok() { send(protocol::OK); }
void sendError(const String& message) { send(ERROR, message); }

String photoPath(const String& name) { return String(PHOTO_DIR) + "/" + name; }

// YYYYMMDD-HHMMSS.jpg once the site has synced the clock (with _02, _03... for same-second
// duplicates), otherwise IMG_0001.jpg. The site sends local time, so format it as UTC.
String nextPhotoName() {
  char base[24];
  if (!timeSynced) {
    for (int n = 1;; n++) {
      snprintf(base, sizeof base, "IMG_%04d.jpg", n);
      if (!SD.exists(photoPath(base))) return base;
    }
  }
  time_t now = time(nullptr);
  tm t;
  gmtime_r(&now, &t);
  strftime(base, sizeof base, "%Y%m%d-%H%M%S", &t);
  String name = String(base) + ".jpg";
  for (int n = 2; SD.exists(photoPath(name)); n++) {
    char suffix[8];
    snprintf(suffix, sizeof suffix, "_%02d", n);
    name = String(base) + suffix + ".jpg";
  }
  return name;
}

void setResolution(uint16_t width, uint16_t height) {
  for (const FrameSize& f : FRAME_SIZES) {
    if (f.width != width || f.height != height) continue;
    // Some drivers clamp an oversized request instead of failing (OV2640 tops out at UXGA), so
    // also check the size the sensor actually took.
    bool tooBig = sensor->id.PID == OV2640_PID && f.size > FRAMESIZE_UXGA;
    if (tooBig || sensor->set_framesize(sensor, f.size) != 0 || sensor->status.framesize != f.size) {
      sensor->set_framesize(sensor, requested->size);  // stay on the previous size
      return sendError(String(width) + "×" + height + " isn't supported by this camera sensor");
    }
    requested = &f;
    return ok();
  }
  sendError(String("Unknown resolution ") + width + "×" + height);
}

// Switches the sensor to the photo size and quality and takes one frame at that size. Frames
// queued before the switch are still the old size, but the driver reports the *new* size in
// fb->width/height, so check the JPEG's own header instead.
camera_fb_t* takePhoto() {
  sensor->set_quality(sensor, PHOTO_QUALITY);
  sensor->set_framesize(sensor, photo.size);
  camera_fb_t* fb = nullptr;
  for (int attempt = 0; attempt < 8 && !fb; attempt++) {
    fb = esp_camera_fb_get();
    uint16_t width = 0, height = 0;
    if (fb && !(jpegSize(fb->buf, fb->len, width, height) && width == photo.width && height == photo.height)) {
      esp_camera_fb_return(fb);
      fb = nullptr;
    }
  }
  return fb;
}

void resumeStream() {
  sensor->set_framesize(sensor, requested->size);
  sensor->set_quality(sensor, STREAM_QUALITY);
}

void capture() {
  if (!sdReady) return sendError("No SD card");
  camera_fb_t* fb = takePhoto();
  if (!fb) {
    resumeStream();
    return sendError("Camera capture failed");
  }
  String name = nextPhotoName();
  File file = SD.open(photoPath(name), FILE_WRITE);
  size_t size = fb->len;
  bool written = file && file.write(fb->buf, size) == size;
  file.close();
  esp_camera_fb_return(fb);
  resumeStream();
  if (!written) {
    SD.remove(photoPath(name));  // don't leave a truncated photo behind
    return sendError("Couldn't write to the SD card");
  }
  send(CAPTURED, "{\"name\":\"" + name + "\",\"size\":" + size + "}");
}

void listPhotos() {
  if (!sdReady || !library.refresh()) return sendError("No SD card");
  String json = "[";
  for (int i = 0; i < library.count(); i++) {  // newest first
    if (i) json += ',';
    json += "{\"name\":\"" + String(library.name(i)) + "\",\"size\":" + library.size(i) + "}";
  }
  send(FILE_LIST, json + "]");
}

// A photo decoded on the device, center-cropped and scaled: what the device UI shows (thumbnails
// and the viewer), and how the emulator gets the same pixels. Reply: u16 w, u16 h, RGB565 LE.
void sendPhotoPixels(const uint8_t* payload, uint32_t length) {
  if (!sdReady) return sendError("No SD card");
  if (length < 5) return sendError("PHOTO_PIXELS needs a width, a height and a name");
  const uint16_t w = readU16(payload), h = readU16(payload + 2);
  const char* name = reinterpret_cast<const char*>(payload + 4);  // NUL-terminated by the parser
  if (w == 0 || h == 0 || w > 240 || h > 240 || strchr(name, '/')) return sendError("Invalid PHOTO_PIXELS request");
  const size_t bytes = size_t(w) * h * 2;
  uint16_t* pixels = static_cast<uint16_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM));
  if (!pixels || !SdPhotoLibrary::decode(name, w, h, pixels)) {
    free(pixels);
    return sendError(String("Couldn't read ") + name);
  }
  const uint8_t size[4] = {uint8_t(w), uint8_t(w >> 8), uint8_t(h), uint8_t(h >> 8)};
  writeHeader(PIXELS, 4 + bytes);
  Serial.write(size, sizeof size);
  Serial.write(reinterpret_cast<const uint8_t*>(pixels), bytes);  // ESP32 is little-endian
  free(pixels);
}

void sendFile(const char* name) {
  if (!sdReady) return sendError("No SD card");
  if (strchr(name, '/')) return sendError("Invalid file name");
  File file = SD.open(photoPath(name));
  if (!file || file.isDirectory()) return sendError(String("File not found: ") + name);
  size_t remaining = file.size();
  writeHeader(FILE_DATA, remaining);
  static uint8_t buffer[4096];
  while (remaining > 0) {
    size_t n = file.read(buffer, min(remaining, sizeof buffer));
    // Keep the promised length even if the card read fails, so the host stays in sync.
    if (n == 0) {
      n = min(remaining, sizeof buffer);
      memset(buffer, 0, n);
    }
    Serial.write(buffer, n);
    remaining -= n;
  }
  file.close();
}

void handle(uint8_t type, const uint8_t* payload, uint32_t length) {
  switch (type) {
    case SET_TIME: {
      if (length != 4) return sendError("SET_TIME needs 4 bytes");
      timeval tv = {time_t(readU32(payload)), 0};
      settimeofday(&tv, nullptr);
      timeSynced = true;
      return ok();
    }
    case LIST:
      return listPhotos();
    case GET_FILE:
      return sendFile(reinterpret_cast<const char*>(payload));
    case PHOTO_PIXELS:
      return sendPhotoPixels(payload, length);
  }

  // The rest need the camera.
  if (!sensor) return sendError("Camera failed to start. Is the Sense board attached?");
  switch (type) {
    case STREAM:
      streaming = length == 1 && payload[0];
      return ok();
    case MIRROR:
      if (length != 1) return sendError("MIRROR needs 1 byte");
      sensor->set_hmirror(sensor, payload[0] ? 1 : 0);
      return ok();
    case VFLIP:
      if (length != 1) return sendError("VFLIP needs 1 byte");
      sensor->set_vflip(sensor, (payload[0] ? 1 : 0) ^ baseVflip);
      return ok();
    case RESOLUTION:
      if (length != 4) return sendError("RESOLUTION needs 4 bytes");
      return setResolution(readU16(payload), readU16(payload + 2));
    case FPS:
      if (length != 1 || payload[0] == 0) return sendError("FPS needs 1 non-zero byte");
      frameIntervalMs = 1000 / payload[0];
      return ok();
    case CAPTURE:
      return capture();
    default:
      return sendError(String("Unknown command 0x") + String(type, HEX));
  }
}

}  // namespace

void setup() {
  Serial.setTxBufferSize(16 * 1024);  // frames are ~5-200 KB; a bigger buffer keeps USB busy
  Serial.begin(115200);               // USB CDC: the baud rate is ignored
  initCamera();
  sdReady = SD.begin(SD_CS_GPIO_NUM) && (SD.exists(PHOTO_DIR) || SD.mkdir(PHOTO_DIR));
}

void loop() {
  while (Serial.available()) {
    if (parser.feed(Serial.read())) handle(parser.type, parser.payload, parser.length);
  }
  if (streaming && millis() - lastFrameMs >= frameIntervalMs) {
    lastFrameMs = millis();
    if (camera_fb_t* fb = esp_camera_fb_get()) {
      // A short write means the host stopped reading; stop until it asks again (STREAM 1).
      if (!send(FRAME, fb->buf, fb->len)) streaming = false;
      esp_camera_fb_return(fb);
    }
  }
}

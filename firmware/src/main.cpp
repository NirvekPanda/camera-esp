// Camera firmware: streams JPEG frames to the website over USB and saves photos to the SD card.
// Every command gets exactly one reply (OK, a data packet, or ERROR), in order. See docs/plan.md.
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include <esp_camera.h>
#include <img_converters.h>
#include <sys/time.h>

#include "camera_pins.h"
#include "protocol.h"

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

sensor_t* sensor = nullptr;  // null if the camera failed to start
const FrameSize* requested = &FRAME_SIZES[0];  // may be smaller than the sensor frame (square crops)
bool sdReady = false;
bool timeSynced = false;
bool streaming = false;
uint32_t frameIntervalMs = 1000 / 15;
uint32_t lastFrameMs = 0;
Parser parser;

bool initCamera() {
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
  // Frame buffers are sized at init, so allocate for UXGA and then drop to the 240x240 default.
  config.frame_size = FRAMESIZE_UXGA;
  config.jpeg_quality = 12;
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&config) != ESP_OK) return false;

  sensor = esp_camera_sensor_get();
  if (sensor->id.PID == OV3660_PID) sensor->set_vflip(sensor, 1);  // OV3660 modules are mounted flipped
  sensor->set_framesize(sensor, FRAMESIZE_240X240);
  return true;
}

void ok() { send(protocol::OK); }
void sendError(const String& message) { send(ERROR, message); }

// Center-crop a JPEG frame to width x height (decode, crop, re-encode). Used for 480x480 and
// 720x720 photos, which the sensor can't produce natively. Takes a few hundred ms: stills only.
bool cropJpeg(const camera_fb_t* fb, uint16_t width, uint16_t height, uint8_t** out, size_t* outLength) {
  const size_t srcWidth = fb->width, srcHeight = fb->height;
  uint8_t* rgb = static_cast<uint8_t*>(ps_malloc(srcWidth * srcHeight * 3));
  if (!rgb) return false;
  bool ok = fmt2rgb888(fb->buf, fb->len, PIXFORMAT_JPEG, rgb);
  if (ok) {
    const size_t x0 = (srcWidth - width) / 2, y0 = (srcHeight - height) / 2;
    // In place: each row moves to an earlier position; memmove handles the overlap.
    for (size_t y = 0; y < height; y++) {
      memmove(rgb + y * width * 3, rgb + ((y + y0) * srcWidth + x0) * 3, width * 3);
    }
    ok = fmt2jpg(rgb, width * height * 3, width, height, PIXFORMAT_RGB888, 90, out, outLength);
  }
  free(rgb);
  return ok;
}

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

void capture() {
  if (!sdReady) return sendError("No SD card");
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return sendError("Camera capture failed");
  const uint8_t* data = fb->buf;
  size_t size = fb->len;
  uint8_t* cropped = nullptr;
  // Square sizes arrive as VGA/HD frames; crop the photo to what was asked for.
  bool crop = fb->width > requested->width && fb->height >= requested->height;
  if (crop && !cropJpeg(fb, requested->width, requested->height, &cropped, &size)) {
    esp_camera_fb_return(fb);
    return sendError("Couldn't crop the photo (out of memory?)");
  }
  if (cropped) data = cropped;

  String name = nextPhotoName();
  File file = SD.open(photoPath(name), FILE_WRITE);
  bool written = file && file.write(data, size) == size;
  file.close();
  free(cropped);
  esp_camera_fb_return(fb);
  if (!written) {
    SD.remove(photoPath(name));  // don't leave a truncated photo behind
    return sendError("Couldn't write to the SD card");
  }
  send(CAPTURED, "{\"name\":\"" + name + "\",\"size\":" + size + "}");
}

void listPhotos() {
  if (!sdReady) return sendError("No SD card");
  File dir = SD.open(PHOTO_DIR);
  String json = "[";
  for (File file = dir.openNextFile(); file; file = dir.openNextFile()) {
    String name = file.name();
    // Only our own names, which need no JSON escaping.
    if (!file.isDirectory() && name.endsWith(".jpg") && name.indexOf('"') < 0 && name.indexOf('\\') < 0) {
      if (json.length() > 1) json += ',';
      json += "{\"name\":\"" + name + "\",\"size\":" + file.size() + "}";
    }
    file.close();
  }
  dir.close();
  send(FILE_LIST, json + "]");
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

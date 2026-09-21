// Test double for the camera firmware (firmware/src/main.cpp): installs navigator.serial with one
// fake XIAO ESP32-S3 that speaks the USB protocol, so SerialSource runs end to end in CI.
// It is an independent implementation of the protocol, which also catches drift from protocol.ts.
// Tests drive it through window.fakeCamera (see serial.spec.ts).
(() => {
  const MAGIC = [0xa5, 0x5a];
  const T = {
    FRAME: 0x01, CAPTURED: 0x02, FILE_LIST: 0x03, FILE_DATA: 0x04, OK: 0x05, ERROR: 0x7f,
    SET_TIME: 0x81, CAPTURE: 0x82, LIST: 0x83, GET_FILE: 0x84, STREAM: 0x85, MIRROR: 0x86,
    RESOLUTION: 0x87, FPS: 0x88, VFLIP: 0x89,
  };
  // Like the firmware: square crops arrive as VGA/HD. An OV2640 has no 1920×1080.
  const SENSOR_FRAME = { "480x480": [640, 480], "720x720": [1280, 720] };
  const RESOLUTIONS = ["240x240", "480x480", "720x720", "320x240", "640x480", "800x600", "1280x720", "1600x1200", "1920x1080"];

  const camera = {
    silent: false, // true = no firmware: never replies
    dropNextReply: false, // true = lose the next reply, like bytes dropped on the USB link
    oldFirmware: false, // true = firmware from before VFLIP existed
    streaming: false,
    sensor: "OV3660", // or "OV2640"
    mirrored: false,
    vflip: false,
    size: [240, 240],
    fps: 15,
    clock: null, // seconds, as sent by SET_TIME
    commands: [], // command types received, in order
    files: new Map(),
    unplug: null,
  };
  window.fakeCamera = camera;

  let controller = null;
  let timer = null;
  const encoder = new TextEncoder();

  function send(type, payload = new Uint8Array(0)) {
    if (!controller) return;
    const packet = new Uint8Array(7 + payload.length);
    packet.set(MAGIC);
    packet[2] = type;
    new DataView(packet.buffer).setUint32(3, payload.length, true);
    packet.set(payload, 7);
    // Real USB delivers arbitrary chunk sizes; split to exercise the parser.
    try {
      for (let i = 0; i < packet.length; i += 1000) controller.enqueue(packet.slice(i, i + 1000));
    } catch {
      // stream already cancelled by the host (disconnecting)
    }
  }
  const sendText = (type, text) => send(type, encoder.encode(text));

  // Left 25% red, rest green (blue when mirrored), so crops and mirroring are visible in pixels.
  async function jpeg() {
    const [w, h] = camera.size;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = camera.mirrored ? "#0000ff" : "#00ff00";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(camera.mirrored ? w * 0.75 : 0, 0, w * 0.25, h);
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer());
  }

  function restartStream() {
    clearInterval(timer);
    timer = camera.streaming
      ? setInterval(async () => send(T.FRAME, await jpeg()), 1000 / camera.fps)
      : null;
  }

  const photoName = () => {
    const d = new Date(camera.clock * 1000);
    const p = (n) => String(n).padStart(2, "0");
    const base = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
    let name = `${base}.jpg`;
    for (let n = 2; camera.files.has(name); n++) name = `${base}_${p(n)}.jpg`;
    return name;
  };

  async function handle(type, payload) {
    camera.commands.push(type);
    if (camera.silent) return;
    if (camera.dropNextReply) {
      camera.dropNextReply = false;
      return;
    }
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    switch (type) {
      case T.SET_TIME:
        camera.clock = view.getUint32(0, true);
        return send(T.OK);
      case T.STREAM:
        camera.streaming = payload[0] === 1;
        restartStream();
        return send(T.OK);
      case T.MIRROR:
        camera.mirrored = payload[0] === 1;
        return send(T.OK);
      case T.VFLIP:
        if (camera.oldFirmware) return sendText(T.ERROR, "Unknown command 0x89");
        camera.vflip = payload[0] === 1;
        return send(T.OK);
      case T.FPS:
        camera.fps = payload[0];
        restartStream();
        return send(T.OK);
      case T.RESOLUTION: {
        const key = `${view.getUint16(0, true)}x${view.getUint16(2, true)}`;
        const supported = RESOLUTIONS.includes(key) && !(camera.sensor === "OV2640" && key === "1920x1080");
        if (!supported) return sendText(T.ERROR, `${key.replace("x", "×")} isn't supported by this camera sensor`);
        camera.size = SENSOR_FRAME[key] ?? key.split("x").map(Number);
        return send(T.OK);
      }
      case T.CAPTURE: {
        const data = await jpeg();
        const name = photoName();
        camera.files.set(name, data);
        return sendText(T.CAPTURED, JSON.stringify({ name, size: data.length }));
      }
      case T.LIST:
        return sendText(T.FILE_LIST, JSON.stringify([...camera.files].map(([name, d]) => ({ name, size: d.length }))));
      case T.GET_FILE: {
        const name = new TextDecoder().decode(payload);
        const data = camera.files.get(name);
        return data ? send(T.FILE_DATA, data) : sendText(T.ERROR, `File not found: ${name}`);
      }
      default:
        return sendText(T.ERROR, `Unknown command 0x${type.toString(16)}`);
    }
  }

  // Minimal command parser (commands are small and never split in these tests' writes).
  function parse(chunk) {
    for (let i = 0; i + 7 <= chunk.length; ) {
      if (chunk[i] !== MAGIC[0] || chunk[i + 1] !== MAGIC[1]) {
        i++;
        continue;
      }
      const length = new DataView(chunk.buffer, chunk.byteOffset + i + 3, 4).getUint32(0, true);
      void handle(chunk[i + 2], chunk.slice(i + 7, i + 7 + length));
      i += 7 + length;
    }
  }

  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    async open() {
      port.readable = new ReadableStream({ start: (c) => (controller = c) });
      port.writable = new WritableStream({ write: (chunk) => parse(chunk) });
      // The ROM bootloader prints text on the same port; the parser must skip it.
      controller.enqueue(encoder.encode("ESP-ROM:esp32s3-20210327\r\nboot:0x2b (SPI_FAST_FLASH_BOOT)\r\n"));
    },
    async close() {
      clearInterval(timer);
      controller = null;
    },
  };

  camera.unplug = () => {
    clearInterval(timer);
    controller?.error(new DOMException("The device has been lost.", "NetworkError"));
    controller = null;
  };

  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: {
      async requestPort({ filters = [] } = {}) {
        if (!filters.some((f) => f.usbVendorId === 0x303a)) throw new DOMException("No port selected by the user.", "NotFoundError");
        return port;
      },
      async getPorts() {
        return [port];
      },
    },
  });
})();

"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/context/camera-context";
import { coverCrop } from "@/lib/camera/settings";
import {
  Button,
  KEY_TO_BUTTON,
  Link,
  PANEL_SIZE,
  MAX_PHOTOS,
  PREVIEW_H,
  PREVIEW_W,
  THUMB_SIZE,
  Screen,
  createDeviceUi,
  type DeviceUi,
} from "@/lib/device-ui";
import { rgb565ToRgba, rgbaToRgb565 } from "@/lib/rgb565";

const PAD = [
  { button: Button.Up, label: "Up", symbol: "▲" },
  { button: Button.Left, label: "Left", symbol: "◀" },
  { button: Button.Center, label: "Center", symbol: "●" },
  { button: Button.Right, label: "Right", symbol: "▶" },
  { button: Button.Down, label: "Down", symbol: "▼" },
];
const FACE = [
  { button: Button.A, label: "A" },
  { button: Button.B, label: "B" },
];

/** The camera's 240×240 display, emulated: the device UI in WebAssembly driving a virtual ST7789. */
export function DeviceScreen() {
  const { source, status, files, capture } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<DeviceUi | null>(null);
  const [ui, setUi] = useState<DeviceUi | null>(null);
  const thumbCache = useRef(new Map<string, Uint16Array>()); // by file name, for the current camera
  const captureRef = useRef(capture); // the context's functions change every render

  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);
  const linkRef = useRef<number>(Link.None);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const linked = status === "connected" && source?.kind === "serial";

  useEffect(() => {
    linkRef.current = linked ? Link.Usb : Link.None; // USB icon while connected over WebSerial
  }, [linked]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(PANEL_SIZE, PANEL_SIZE);
    let frame = 0;
    let cancelled = false;
    fetch("/wasm/device-ui.wasm")
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the device UI (${res.status})`);
        return res.arrayBuffer();
      })
      .then(createDeviceUi)
      .then((ui) => {
        if (cancelled) return;
        uiRef.current = ui;
        setUi(ui);
        let last = performance.now();
        let flashOn = false;
        const draw = (now: number) => {
          const clock = new Date();
          ui.setTime(clock.getHours() * 60 + clock.getMinutes());
          ui.setLink(linkRef.current);
          // rAF's frame time can precede `last` on the first frame: clamp to 0..100 ms.
          rgb565ToRgba(ui.frame(Math.round(Math.min(Math.max(now - last, 0), 100))), image.data);
          ctx.putImageData(image, 0, 0);
          if (ui.flashOn() !== flashOn) setFlash((flashOn = ui.flashOn())); // re-render only on change
          last = now;
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      uiRef.current = null;
    };
  }, []);

  // Live preview: frames from the connected camera feed the device's Camera app.
  useEffect(() => {
    if (!source) return;
    const ctx = new OffscreenCanvas(PREVIEW_W, PREVIEW_H).getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const rgb565 = new Uint16Array(PREVIEW_W * PREVIEW_H);
    const unsubscribe = source.onFrame((frame) => {
      const ui = uiRef.current;
      if (ui?.screen() !== Screen.Camera) return; // only convert frames that will be seen
      const { sx, sy, sw, sh } = coverCrop(frame.width, frame.height, PREVIEW_W, PREVIEW_H);
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, PREVIEW_W, PREVIEW_H);
      rgbaToRgb565(ctx.getImageData(0, 0, PREVIEW_W, PREVIEW_H).data, rgb565);
      ui.setPreview(rgb565);
    });
    return () => {
      unsubscribe();
      uiRef.current?.setPreview(null); // back to the color bars
    };
  }, [source]);

  // The device's Pictures page shows the connected camera's photos (its SD card): names from the
  // camera's file list, thumbnails and the viewer image decoded to the device's sizes.
  useEffect(() => {
    thumbCache.current.clear(); // a different camera
  }, [source]);

  useEffect(() => {
    if (!ui) return;
    const names = source ? files.map((f) => f.name).slice(0, MAX_PHOTOS) : [];
    ui.setPhotos(names);
    ui.takeCaptureRequests(); // presses from before this camera was connected don't count
    if (!source) return;
    let cancelled = false;
    let loadingImage = -1;
    const report = (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e));
    void (async () => {
      for (const [i, name] of names.entries()) {
        const pixels = thumbCache.current.get(name) ?? (await source.getPixels(name, THUMB_SIZE, THUMB_SIZE));
        if (cancelled) return;
        thumbCache.current.set(name, pixels);
        ui.setThumbnail(i, pixels);
      }
    })().catch(report);
    const poll = setInterval(() => {
      // Shutter presses save photos through the camera connection; its file list then updates.
      for (let n = ui.takeCaptureRequests(); n > 0; n--) void captureRef.current();
      const wanted = ui.wantedImage();
      if (wanted >= 0 && wanted !== loadingImage && names[wanted]) {
        loadingImage = wanted;
        source
          .getPixels(names[wanted], PREVIEW_W, PREVIEW_H)
          .then((pixels) => !cancelled && ui.setImage(wanted, pixels))
          .catch(report)
          .finally(() => (loadingImage = -1));
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [ui, source, files]);

  const press = (button: number) => uiRef.current?.press(button);

  // Keys drive the device without clicking the display first. Input controls outside the emulator
  // (the header's select and buttons) keep their own keys.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const button = KEY_TO_BUTTON[e.key];
      const target = e.target as HTMLElement;
      if (button === undefined || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target.closest("input, select, textarea, button, [contenteditable]") && !target.closest(".device")) return;
      e.preventDefault(); // no page scroll, and a focused pad button doesn't also click
      uiRef.current?.press(button);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section className="device" aria-label="Device screen emulator">
      <div className="device-body">
        {/* The flash is a light ring around the display, outside the 240x240 panel. */}
        <div className="device-frame" data-flash={flash ? "on" : "off"}>
          <canvas
            ref={canvasRef}
            className="device-screen"
            width={PANEL_SIZE}
            height={PANEL_SIZE}
            tabIndex={0}
            aria-label="Device screen"
          />
        </div>
        <div className="device-controls">
          <div className="dpad" role="group" aria-label="5-way switch">
            {PAD.map(({ button, label, symbol }) => (
              <button key={label} className={`dpad-${label.toLowerCase()}`} aria-label={label} onClick={() => press(button)}>
                {symbol}
              </button>
            ))}
          </div>
          <div className="face-buttons" role="group" aria-label="A and B buttons">
            {FACE.map(({ button, label }) => (
              <button key={label} className={`face-${label.toLowerCase()}`} onClick={() => press(button)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

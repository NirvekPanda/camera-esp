"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/context/camera-context";
import {
  Button,
  KEY_TO_BUTTON,
  Link,
  PANEL_SIZE,
  createDeviceUi,
  rgb565ToRgba,
  type DeviceUi,
} from "@/lib/device-ui";

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
  const { source, status } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<DeviceUi | null>(null);
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

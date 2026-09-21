"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

/** The camera's 240×240 display, emulated: the device UI in WebAssembly driving a virtual ST7789. */
export function DeviceScreen() {
  const { source, status } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<DeviceUi | null>(null);
  const linkRef = useRef<number>(Link.None);
  const [error, setError] = useState<string | null>(null);
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
        const draw = (now: number) => {
          const clock = new Date();
          ui.setTime(clock.getHours() * 60 + clock.getMinutes());
          ui.setLink(linkRef.current);
          rgb565ToRgba(ui.frame(Math.round(Math.min(now - last, 100))), image.data);
          ctx.putImageData(image, 0, 0);
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

  function onKeyDown(e: KeyboardEvent) {
    const button = KEY_TO_BUTTON[e.key];
    if (button === undefined) return;
    e.preventDefault();
    press(button);
  }

  return (
    <section className="device" aria-label="Device screen emulator">
      <div className="device-body">
        <canvas
          ref={canvasRef}
          className="device-screen"
          width={PANEL_SIZE}
          height={PANEL_SIZE}
          tabIndex={0}
          aria-label="Device screen, 240 by 240. Focus it and use the arrow keys and Enter."
          onKeyDown={onKeyDown}
        />
        <div className="dpad" role="group" aria-label="5-way switch">
          {PAD.map(({ button, label, symbol }) => (
            <button key={label} className={`dpad-${label.toLowerCase()}`} aria-label={label} onClick={() => press(button)}>
              {symbol}
            </button>
          ))}
        </div>
      </div>
      <p className="device-note">
        The device&apos;s own UI code, compiled to WebAssembly. Every frame goes through the ST7789 display
        driver into an emulated panel, so this is exactly what the camera&apos;s screen shows.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

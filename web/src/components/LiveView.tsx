"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/context/camera-context";
import {
  FPS_OPTIONS,
  RESOLUTIONS,
  parseResolution,
  resolutionKey,
  resolutionLabel,
} from "@/lib/camera/settings";

export function LiveView() {
  const {
    source,
    status,
    mirrored,
    resolution,
    fps,
    capture,
    toggleMirror,
    changeResolution,
    changeFps,
  } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!source || !ctx) return;
    let frames = 0;
    const unsubscribe = source.onFrame((frame) => {
      // Scale to the canvas: frames already in flight during a resolution change may be the old size.
      ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
      frames++;
    });
    const timer = setInterval(() => {
      setMeasuredFps(frames);
      frames = 0;
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    };
  }, [source]);

  const live = status === "connected";

  return (
    <section className="live" aria-label="Live camera preview">
      <div className="viewport" style={{ aspectRatio: `${resolution.width} / ${resolution.height}` }}>
        <canvas ref={canvasRef} width={resolution.width} height={resolution.height} />
        {!live && (
          <p className="placeholder">
            {status === "connecting" ? "Connecting…" : "No camera connected"}
          </p>
        )}
        {flashKey > 0 && <div key={flashKey} className="flash" aria-hidden />}
        <button
          className="shutter"
          aria-label="Take picture"
          disabled={!live}
          onClick={() => {
            setFlashKey((k) => k + 1);
            void capture();
          }}
        />
        <button
          className="flip"
          aria-label="Flip horizontally"
          aria-pressed={mirrored}
          disabled={!live}
          onClick={() => void toggleMirror()}
        >
          ⇋
        </button>
      </div>
      <div className="stream-settings">
        <select
          aria-label="Resolution"
          value={resolutionKey(resolution)}
          onChange={(e) => void changeResolution(parseResolution(e.target.value))}
        >
          {RESOLUTIONS.map((r) => (
            <option key={resolutionKey(r)} value={resolutionKey(r)}>
              {resolutionLabel(r)}
            </option>
          ))}
        </select>
        <select aria-label="Frame rate" value={fps} onChange={(e) => void changeFps(Number(e.target.value))}>
          {FPS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
        <span className="stats">{live ? `${measuredFps} fps actual` : "offline"}</span>
      </div>
    </section>
  );
}

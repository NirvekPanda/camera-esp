"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/context/camera-context";
import {
  FPS_OPTIONS,
  coverCrop,
  RESOLUTIONS,
  parseResolution,
  resolutionKey,
  resolutionLabel,
} from "@/lib/camera/settings";
import { DEFAULT_VIEWER_WIDTH } from "@/lib/viewer-size";
import { ResizeHandle } from "./ResizeHandle";

export function LiveView() {
  const {
    source,
    status,
    mirrored,
    vflip,
    resolution,
    fps,
    capture,
    toggleMirror,
    toggleVflip,
    changeResolution,
    changeFps,
  } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(DEFAULT_VIEWER_WIDTH);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!source || !ctx) return;
    let frames = 0;
    const unsubscribe = source.onFrame((frame) => {
      // Center-crop to the canvas: the device sends VGA/HD for the 480×480/720×720 settings, and
      // frames in flight during a resolution change may still be the old size.
      const { width, height } = ctx.canvas;
      const { sx, sy, sw, sh } = coverCrop(frame.width, frame.height, width, height);
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, width, height);
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
    // min(): never wider than the page, whatever size was chosen on a wider window.
    <section className="live" aria-label="Live camera preview" style={{ width: `min(${viewerWidth}px, 100%)` }}>
      <div className="viewport" style={{ aspectRatio: `${resolution.width} / ${resolution.height}` }}>
        <canvas ref={canvasRef} width={resolution.width} height={resolution.height} />
        {!live && (
          <p className="placeholder">
            {status === "connecting" ? "Connecting…" : "No camera connected"}
          </p>
        )}
        {flashKey > 0 && <div key={flashKey} className="flash" aria-hidden />}
        <div className="viewer-controls" role="toolbar" aria-label="Camera controls" aria-orientation="vertical">
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
          <button
            className="flip"
            aria-label="Flip vertically"
            aria-pressed={vflip}
            disabled={!live}
            onClick={() => void toggleVflip()}
          >
            ⇅
          </button>
        </div>
        <ResizeHandle
          width={viewerWidth}
          aspect={resolution.width / resolution.height}
          onResize={setViewerWidth}
        />
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

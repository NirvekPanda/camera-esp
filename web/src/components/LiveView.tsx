"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/context/camera-context";

const SIZE = 240;

export function LiveView() {
  const { source, status, mirrored, capture, toggleMirror } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!source || !ctx) return;
    let frames = 0;
    const unsubscribe = source.onFrame((frame) => {
      ctx.drawImage(frame, 0, 0, SIZE, SIZE);
      frames++;
    });
    const timer = setInterval(() => {
      setFps(frames);
      frames = 0;
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      ctx.clearRect(0, 0, SIZE, SIZE);
    };
  }, [source]);

  const live = status === "connected";

  return (
    <section className="live" aria-label="Live camera preview">
      <div className="viewport">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} />
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
      <p className="stats">{live ? `${fps} fps · ${SIZE}×${SIZE}` : "offline"}</p>
    </section>
  );
}

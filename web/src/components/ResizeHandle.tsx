"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_VIEWER_WIDTH, MIN_VIEWER_WIDTH, clampViewerWidth, dragWidth } from "@/lib/viewer-size";

interface Props {
  width: number;
  aspect: number; // width / height of the viewer
  onResize(width: number): void;
}

const KEY_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// Width the viewer may grow to: its container's width.
const availableWidth = (el: HTMLElement) => el.closest("main")?.clientWidth ?? window.innerWidth;

/** Bottom-right corner handle: drag, or focus it and use the arrow keys (Shift = bigger steps). */
export function ResizeHandle({ width, aspect, onResize }: Props) {
  const drag = useRef<{ x: number; y: number; width: number; available: number } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, width, available: availableWidth(e.currentTarget) };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const next = dragWidth(start.width, e.clientX - start.x, e.clientY - start.y, aspect);
    onResize(clampViewerWidth(next, start.available));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = KEY_STEPS[e.key];
    const target =
      step !== undefined ? width + step * (e.shiftKey ? 100 : 20)
      : e.key === "Home" ? MIN_VIEWER_WIDTH
      : e.key === "End" ? MAX_VIEWER_WIDTH
      : null;
    if (target === null) return;
    e.preventDefault();
    onResize(clampViewerWidth(target, availableWidth(e.currentTarget)));
  }

  return (
    <div
      className="resize-handle"
      role="slider"
      tabIndex={0}
      aria-label="Viewer size"
      aria-valuemin={MIN_VIEWER_WIDTH}
      aria-valuemax={MAX_VIEWER_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M5 11h6V5M11 11 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

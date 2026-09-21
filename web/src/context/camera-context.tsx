"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MockSource } from "@/lib/camera/mock-source";
import { DEFAULT_FPS, DEFAULT_RESOLUTION, type Resolution } from "@/lib/camera/settings";
import type { CameraSource, FileEntry } from "@/lib/camera/types";
import { newestFirst } from "@/lib/filename";

export const SOURCE_OPTIONS = {
  webcam: { label: "Mock: webcam", create: () => new MockSource("webcam") },
  pattern: { label: "Mock: test pattern", create: () => new MockSource("pattern") },
} satisfies Record<string, { label: string; create: () => CameraSource }>;

export type SourceId = keyof typeof SOURCE_OPTIONS;
export type Status = "disconnected" | "connecting" | "connected";

interface CameraContextValue {
  source: CameraSource | null;
  status: Status;
  error: string | null;
  files: FileEntry[];
  mirrored: boolean;
  resolution: Resolution;
  fps: number;
  connect(id: SourceId): Promise<void>;
  disconnect(): void;
  capture(): Promise<void>;
  toggleMirror(): Promise<void>;
  changeResolution(resolution: Resolution): Promise<void>;
  changeFps(fps: number): Promise<void>;
  refreshFiles(): Promise<void>;
}

const CameraContext = createContext<CameraContextValue | null>(null);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CameraProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<CameraSource | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [mirrored, setMirrored] = useState(false);
  // Latest requested value, so rapid clicks toggle from the pending state, not a stale render.
  const mirrorRef = useRef(false);
  const [resolution, setResolution] = useState<Resolution>(DEFAULT_RESOLUTION);
  const [fps, setFps] = useState(DEFAULT_FPS);

  // Disconnecting happens here, so replacing the source or unmounting always releases it.
  useEffect(() => {
    return () => {
      void source?.disconnect();
    };
  }, [source]);

  async function connect(id: SourceId) {
    setError(null);
    setConnecting(true);
    const next = SOURCE_OPTIONS[id].create();
    try {
      await next.connect();
      // Apply the chosen settings, so they survive reconnects and can be picked before connecting.
      await next.setMirror(mirrorRef.current);
      await next.setResolution(resolution);
      await next.setFps(fps);
      const nextFiles = await next.listFiles();
      // Only publish the source once fully set up, so a failure can't leave a dead "connected" state.
      setSource(next);
      setFiles(newestFirst(nextFiles));
    } catch (e) {
      void next.disconnect();
      setError(message(e));
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    setSource(null);
    setFiles([]);
  }

  async function capture() {
    if (!source) return;
    try {
      const file = await source.capture();
      setFiles((prev) => newestFirst([file, ...prev]));
    } catch (e) {
      setError(message(e));
    }
  }

  async function toggleMirror() {
    if (!source) return;
    const next = !mirrorRef.current;
    mirrorRef.current = next;
    try {
      await source.setMirror(next);
      setMirrored(next);
    } catch (e) {
      mirrorRef.current = !next;
      setError(message(e));
    }
  }

  async function changeResolution(next: Resolution) {
    try {
      await source?.setResolution(next);
      setResolution(next);
    } catch (e) {
      setError(message(e));
    }
  }

  async function changeFps(next: number) {
    try {
      await source?.setFps(next);
      setFps(next);
    } catch (e) {
      setError(message(e));
    }
  }

  async function refreshFiles() {
    if (!source) return;
    try {
      setFiles(newestFirst(await source.listFiles()));
    } catch (e) {
      setError(message(e));
    }
  }

  const status: Status = source ? "connected" : connecting ? "connecting" : "disconnected";

  return (
    <CameraContext.Provider
      value={{
        source,
        status,
        error,
        files,
        mirrored,
        resolution,
        fps,
        connect,
        disconnect,
        capture,
        toggleMirror,
        changeResolution,
        changeFps,
        refreshFiles,
      }}
    >
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  const value = useContext(CameraContext);
  if (!value) throw new Error("useCamera must be used inside <CameraProvider>");
  return value;
}

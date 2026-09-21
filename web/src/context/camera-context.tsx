"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MockSource } from "@/lib/camera/mock-source";
import { SerialSource } from "@/lib/camera/serial-source";
import { DEFAULT_FPS, DEFAULT_RESOLUTION, type Resolution } from "@/lib/camera/settings";
import type { CameraSource, FileEntry } from "@/lib/camera/types";
import { newestFirst } from "@/lib/filename";

export const SOURCE_OPTIONS = {
  usb: { label: "USB camera", create: () => new SerialSource() },
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

interface Settings {
  mirrored: boolean;
  resolution: Resolution;
  fps: number;
}

const DEFAULT_SETTINGS: Settings = { mirrored: false, resolution: DEFAULT_RESOLUTION, fps: DEFAULT_FPS };

const APPLY: { [K in keyof Settings]: (source: CameraSource, value: Settings[K]) => Promise<void> } = {
  mirrored: (source, value) => source.setMirror(value),
  resolution: (source, value) => source.setResolution(value),
  fps: (source, value) => source.setFps(value),
};

export function CameraProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<CameraSource | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // Latest requested values. connect() and rapid clicks read these, never a stale render's state.
  const settingsRef = useRef(DEFAULT_SETTINGS);

  // Disconnecting happens here, so replacing the source or unmounting always releases it.
  useEffect(() => {
    if (!source) return;
    const unsubscribe = source.onClose((e) => {
      setSource(null);
      setFiles([]);
      setError(`Camera disconnected: ${e.message}`);
    });
    return () => {
      unsubscribe();
      void source.disconnect();
    };
  }, [source]);

  async function connect(id: SourceId) {
    setError(null);
    setConnecting(true);
    const next = SOURCE_OPTIONS[id].create();
    try {
      await next.connect();
      // Read after the await: settings may have changed while connecting (e.g. permission prompt).
      const { mirrored, resolution, fps } = settingsRef.current;
      await next.setMirror(mirrored);
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

  // Optimistic: shows the new value at once. Without a source it's applied on the next connect.
  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const before = settingsRef.current[key];
    settingsRef.current = { ...settingsRef.current, [key]: value };
    setSettings(settingsRef.current);
    if (!source) return;
    try {
      await APPLY[key](source, value);
    } catch (e) {
      settingsRef.current = { ...settingsRef.current, [key]: before };
      setSettings(settingsRef.current);
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
        ...settings,
        connect,
        disconnect,
        capture,
        toggleMirror: () => updateSetting("mirrored", !settingsRef.current.mirrored),
        changeResolution: (resolution) => updateSetting("resolution", resolution),
        changeFps: (fps) => updateSetting("fps", fps),
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

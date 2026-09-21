"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MockSource } from "@/lib/camera/mock-source";
import type { CameraSource, FileEntry } from "@/lib/camera/types";

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
  connect(id: SourceId): Promise<void>;
  disconnect(): void;
  capture(): Promise<void>;
  toggleMirror(): Promise<void>;
  refreshFiles(): Promise<void>;
}

const CameraContext = createContext<CameraContextValue | null>(null);

// Names are YYYYMMDD-HHMMSS, so reverse string order is newest first.
const newestFirst = (files: FileEntry[]) => [...files].sort((a, b) => b.name.localeCompare(a.name));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CameraProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<CameraSource | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [mirrored, setMirrored] = useState(false);

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
      await next.setMirror(mirrored); // keep the flip setting across reconnects
      setSource(next);
      setFiles(newestFirst(await next.listFiles()));
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
    try {
      await source.setMirror(!mirrored);
      setMirrored(!mirrored);
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
        connect,
        disconnect,
        capture,
        toggleMirror,
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

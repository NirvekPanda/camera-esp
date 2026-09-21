"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CameraSource, FileEntry } from "@/lib/camera/types";

interface Props {
  source: CameraSource;
  files: FileEntry[];
  name: string;
  onNavigate(name: string): void;
  onClose(): void;
}

type Loaded = { name: string; url?: string; error?: string };

export function ImageModal({ source, files, name, onNavigate, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const index = files.findIndex((f) => f.name === name);
  const prev = files[index - 1];
  const next = files[index + 1];
  // Ignore results from a previously opened photo until the new one arrives.
  const current = loaded?.name === name ? loaded : null;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    source.getFile(name).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setLoaded({ name, url });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ name, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, name]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" && prev) onNavigate(prev.name);
    if (e.key === "ArrowRight" && next) onNavigate(next.name);
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={name}
      onClose={onClose}
      onKeyDown={onKeyDown}
      // Clicks on the backdrop target the dialog itself; clicks on content don't.
      onClick={(e) => e.target === dialogRef.current && dialogRef.current.close()}
    >
      <div className="modal-body">
        <div className="modal-image">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob URL; next/image can't optimize it in a static export */}
          {current?.url && <img src={current.url} alt={name} />}
          {current?.error && <p className="error">{current.error}</p>}
          {!current && <p>Loading…</p>}
        </div>
        <div className="modal-bar">
          <button aria-label="Previous photo" disabled={!prev} onClick={() => prev && onNavigate(prev.name)}>
            ←
          </button>
          <span className="file-name">{name}</span>
          <button aria-label="Next photo" disabled={!next} onClick={() => next && onNavigate(next.name)}>
            →
          </button>
          {current?.url && (
            <a className="button" href={current.url} download={name}>
              Download
            </a>
          )}
          <button onClick={() => dialogRef.current?.close()}>Close</button>
        </div>
      </div>
    </dialog>
  );
}

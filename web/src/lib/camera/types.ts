import type { Resolution } from "./settings";

export interface FileEntry {
  name: string;
  size: number; // bytes
}

/** Called once per frame. The bitmap is closed after all listeners return. */
export type FrameListener = (frame: ImageBitmap) => void;

/** Every transport (mock, USB serial, WiFi) implements this; the UI only uses this. */
export interface CameraSource {
  readonly kind: "mock" | "serial" | "wifi";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onFrame(listener: FrameListener): () => void;
  /** Fires when the camera goes away on its own (e.g. unplugged), never after disconnect(). */
  onClose(listener: (error: Error) => void): () => void;
  setMirror(mirrored: boolean): Promise<void>; // horizontal flip, applied to preview and photos
  setVflip(flipped: boolean): Promise<void>; // vertical flip, applied to preview and photos
  setResolution(resolution: Resolution): Promise<void>; // stream size (photos always use the best)
  setFps(fps: number): Promise<void>; // target rate; the transport may deliver less
  capture(): Promise<FileEntry>; // at the camera's best resolution and quality
  listFiles(): Promise<FileEntry[]>;
  getFile(name: string): Promise<Blob>;
  /** A photo center-cropped and scaled to width x height RGB565, as the device UI shows it. */
  getPixels(name: string, width: number, height: number): Promise<Uint16Array>;
}

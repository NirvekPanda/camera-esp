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
  setMirror(mirrored: boolean): Promise<void>; // horizontal flip, applied to preview and photos
  capture(): Promise<FileEntry>;
  listFiles(): Promise<FileEntry[]>;
  getFile(name: string): Promise<Blob>;
}

import { duplicateName, photoName } from "../filename";
import type { CameraSource, FileEntry, FrameListener } from "./types";

const SIZE = 240; // matches FRAMESIZE_240X240 on the device
const FPS = 15;
const BARS = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f"];

// Module-level so photos survive reconnects, like a real SD card.
const sdCard = new Map<string, Blob>();

export type MockInput = "webcam" | "pattern";

/** Stands in for the device: frames from the laptop webcam or a test pattern, photos kept in memory. */
export class MockSource implements CameraSource {
  readonly kind = "mock";
  private readonly input: MockInput;
  private readonly canvas = new OffscreenCanvas(SIZE, SIZE);
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private readonly listeners = new Set<FrameListener>();
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private frameCount = 0;
  private mirrored = false;

  constructor(input: MockInput) {
    this.input = input;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
  }

  async connect() {
    if (this.input === "webcam") {
      if (!navigator.mediaDevices) throw new Error("Webcam access needs HTTPS or localhost");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await this.video.play();
    }
    this.timer = window.setInterval(() => void this.tick(), 1000 / FPS);
  }

  async disconnect() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const stream = this.video?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    this.video = null;
  }

  onFrame(listener: FrameListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setMirror(mirrored: boolean) {
    this.mirrored = mirrored;
  }

  async capture(): Promise<FileEntry> {
    if (this.timer === null) throw new Error("Camera is not connected");
    const blob = await this.canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const base = photoName(new Date());
    let name = base;
    for (let i = 2; sdCard.has(name); i++) name = duplicateName(base, i);
    sdCard.set(name, blob);
    return { name, size: blob.size };
  }

  async listFiles(): Promise<FileEntry[]> {
    return [...sdCard].map(([name, blob]) => ({ name, size: blob.size }));
  }

  async getFile(name: string) {
    const blob = sdCard.get(name);
    if (!blob) throw new Error(`File not found: ${name}`);
    return blob;
  }

  private async tick() {
    this.frameCount++;
    // Mirror in the frame itself, like the sensor's hmirror, so photos match the preview.
    this.ctx.setTransform(this.mirrored ? -1 : 1, 0, 0, 1, this.mirrored ? SIZE : 0, 0);
    if (this.video) this.drawWebcam(this.video);
    else this.drawPattern();
    if (this.listeners.size === 0) return;
    const frame = await createImageBitmap(this.canvas);
    this.listeners.forEach((listener) => listener(frame));
    frame.close();
  }

  // Center-crop to a square, like the device's 240x240 frame.
  private drawWebcam(video: HTMLVideoElement) {
    const { videoWidth: w, videoHeight: h } = video;
    const side = Math.min(w, h);
    this.ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  }

  private drawPattern() {
    const { ctx } = this;
    const barWidth = SIZE / BARS.length;
    const barHeight = SIZE * 0.7;
    BARS.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(i * barWidth, 0, barWidth + 1, barHeight);
    });
    ctx.fillStyle = "#111";
    ctx.fillRect(0, barHeight, SIZE, SIZE - barHeight);
    // Moving marker makes dropped frames visible.
    ctx.fillStyle = "#f60";
    ctx.fillRect((this.frameCount * 4) % SIZE, barHeight, 4, SIZE - barHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(new Date().toLocaleTimeString(), SIZE / 2, barHeight + 30);
    ctx.fillText(`frame ${this.frameCount}`, SIZE / 2, barHeight + 55);
  }
}

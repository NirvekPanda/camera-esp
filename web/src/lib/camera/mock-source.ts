import { duplicateName, photoName } from "../filename";
import { imageToRgb565 } from "../rgb565";
import { DEFAULT_FPS, DEFAULT_RESOLUTION, coverCrop, type Resolution } from "./settings";
import type { CameraSource, FileEntry, FrameListener } from "./types";

const BARS = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f"];
const PATTERN_PHOTO = { width: 1920, height: 1080 }; // the test pattern's "sensor" maximum

// Module-level so photos survive reconnects, like a real SD card.
const sdCard = new Map<string, Blob>();

export type MockInput = "webcam" | "pattern";

/** Stands in for the device: frames from the laptop webcam or a test pattern, photos kept in memory. */
export class MockSource implements CameraSource {
  readonly kind = "mock";
  private readonly input: MockInput;
  private readonly canvas = new OffscreenCanvas(DEFAULT_RESOLUTION.width, DEFAULT_RESOLUTION.height);
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private readonly listeners = new Set<FrameListener>();
  private readonly closeListeners = new Set<(error: Error) => void>();
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private frameCount = 0;
  private mirrored = false;
  private vflip = false;
  private fps = DEFAULT_FPS;

  constructor(input: MockInput) {
    this.input = input;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
  }

  async connect() {
    if (this.input === "webcam") {
      if (!navigator.mediaDevices) throw new Error("Webcam requires HTTPS");
      // Ask for the most the webcam has; frames are cropped and scaled to the chosen resolution.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      // e.g. the webcam is unplugged or its permission revoked
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        void this.disconnect();
        this.closeListeners.forEach((listener) => listener(new Error("Webcam stopped")));
      });
      await this.video.play();
    }
    this.draw(); // so a photo taken before the first tick isn't blank
    this.startTimer();
  }

  async disconnect() {
    this.stopTimer();
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

  onClose(listener: (error: Error) => void) {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async setMirror(mirrored: boolean) {
    this.mirrored = mirrored;
  }

  async setVflip(flipped: boolean) {
    this.vflip = flipped;
  }

  async setResolution({ width, height }: Resolution) {
    // Resizing clears the canvas; redraw so an immediate capture isn't blank.
    this.canvas.width = width;
    this.canvas.height = height;
    this.draw();
  }

  async setFps(fps: number) {
    this.fps = fps;
    if (this.timer !== null) this.startTimer();
  }

  // Like the real camera, photos use the best resolution available, whatever the stream size:
  // the webcam's native size, or the pattern's 1920×1080.
  async capture(): Promise<FileEntry> {
    if (this.timer === null) throw new Error("Camera is not connected");
    const { width, height } = this.video
      ? { width: this.video.videoWidth, height: this.video.videoHeight }
      : PATTERN_PHOTO;
    const photo = new OffscreenCanvas(width, height);
    const ctx = photo.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.draw(ctx);
    const blob = await photo.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const base = photoName(new Date());
    let name = base;
    for (let i = 2; sdCard.has(name); i++) name = duplicateName(base, i);
    sdCard.set(name, blob);
    return { name, size: blob.size };
  }

  async listFiles(): Promise<FileEntry[]> {
    return [...sdCard].map(([name, blob]) => ({ name, size: blob.size }));
  }

  async deleteFile(name: string) {
    if (!sdCard.delete(name)) throw new Error(`File not found: ${name}`);
  }

  async getPixels(name: string, width: number, height: number) {
    return imageToRgb565(await this.getFile(name), width, height);
  }

  async getFile(name: string) {
    const blob = sdCard.get(name);
    if (!blob) throw new Error(`File not found: ${name}`);
    return blob;
  }

  private startTimer() {
    this.stopTimer();
    this.timer = window.setInterval(() => void this.tick(), 1000 / this.fps);
  }

  private stopTimer() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    this.frameCount++;
    this.draw();
    if (this.listeners.size === 0) return;
    const frame = await createImageBitmap(this.canvas);
    this.listeners.forEach((listener) => listener(frame));
    frame.close();
  }

  // Draws one frame into ctx's canvas, at that canvas's size (the stream or a photo).
  private draw(ctx: OffscreenCanvasRenderingContext2D = this.ctx) {
    // Flip in the frame itself, like the sensor's hmirror/vflip, so photos match the preview.
    const { width, height } = ctx.canvas;
    ctx.setTransform(
      this.mirrored ? -1 : 1, 0, 0, this.vflip ? -1 : 1,
      this.mirrored ? width : 0, this.vflip ? height : 0,
    );
    if (this.video) this.drawWebcam(ctx, this.video);
    else this.drawPattern(ctx);
  }

  // Center-crop to the output aspect ratio, like the device's cropped frame sizes.
  private drawWebcam(ctx: OffscreenCanvasRenderingContext2D, video: HTMLVideoElement) {
    const { width, height } = ctx.canvas;
    const { sx, sy, sw, sh } = coverCrop(video.videoWidth, video.videoHeight, width, height);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  }

  private drawPattern(ctx: OffscreenCanvasRenderingContext2D) {
    const { width, height } = ctx.canvas;
    const barWidth = width / BARS.length;
    const barHeight = height * 0.7;
    const textSize = Math.round(height / 15);
    BARS.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(i * barWidth, 0, barWidth + 1, barHeight);
    });
    ctx.fillStyle = "#111";
    ctx.fillRect(0, barHeight, width, height - barHeight);
    // Moving marker makes dropped frames visible.
    const marker = Math.max(4, width / 60);
    ctx.fillStyle = "#f60";
    ctx.fillRect((this.frameCount * marker) % width, barHeight, marker, height - barHeight);
    ctx.fillStyle = "#fff";
    ctx.font = `${textSize}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(new Date().toLocaleTimeString(), width / 2, barHeight + textSize * 1.8);
    ctx.fillText(`frame ${this.frameCount} · ${width}×${height}`, width / 2, barHeight + textSize * 3.4);
  }
}

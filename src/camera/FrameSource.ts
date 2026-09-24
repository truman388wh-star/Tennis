// Video input sources. Both expose a <video> element that the frame loop
// samples; frames are processed incrementally and never stored, so memory
// use is constant regardless of session length.

import type { CameraConfig } from '../config/config';

export interface FrameSource {
  readonly video: HTMLVideoElement;
  readonly kind: 'camera' | 'file';
  /** Whether the image should be mirrored for display (front camera). */
  readonly mirrored: boolean;
  start(): Promise<void>;
  stop(): void;
}

export class CameraSource implements FrameSource {
  readonly kind = 'camera';
  private stream: MediaStream | null = null;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly cfg: CameraConfig,
  ) {}

  get mirrored(): boolean {
    return this.cfg.facingMode === 'user';
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<void> {
    if (!CameraSource.supported()) {
      throw new Error(
        window.isSecureContext
          ? 'Camera API not available in this browser.'
          : 'Camera requires HTTPS. Open the app via https:// or localhost.',
      );
    }
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.cfg.facingMode },
        width: { ideal: this.cfg.idealWidth },
        height: { ideal: this.cfg.idealHeight },
        frameRate: { ideal: this.cfg.idealFrameRate },
      },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Some devices reject the ideal constraints; retry with the bare minimum.
      if (err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotReadableError')) {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw describeCameraError(err);
      }
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await waitForDimensions(this.video);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}

/** Plays a recorded video file through the same pipeline (useful for testing). */
export class VideoFileSource implements FrameSource {
  readonly kind = 'file';
  readonly mirrored = false;
  private url: string | null = null;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly file: File,
  ) {}

  async start(): Promise<void> {
    this.url = URL.createObjectURL(this.file);
    this.video.srcObject = null;
    this.video.src = this.url;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.loop = false;
    await this.video.play();
    await waitForDimensions(this.video);
  }

  stop(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    setTimeout(done, 3000);
  });
}

function describeCameraError(err: unknown): Error {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return new Error('Camera permission was denied. Allow camera access and try again.');
    if (err.name === 'NotFoundError') return new Error('No camera found on this device.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Video input sources. Both expose a <video> element that the frame loop
// samples; frames are processed incrementally and never stored, so memory
// use is constant regardless of session length.

import type { CameraConfig } from '../config/config';
import { clampZoom, pickMainBackCamera, type ZoomRange } from './lens';

/** Camera failures carry a code; the UI shows a localized message for it. */
export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'notFound' | 'other';

export class CameraError extends Error {
  constructor(
    readonly code: CameraErrorCode,
    detail = '',
  ) {
    super(detail || code);
    this.name = 'CameraError';
  }
}

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
      throw new CameraError(window.isSecureContext ? 'unsupported' : 'insecure');
    }
    this.stream = await this.open({ facingMode: { ideal: this.cfg.facingMode } });
    if (this.cfg.facingMode === 'environment') await this.preferMainLens();
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await waitForDimensions(this.video);
    // Start around 1x (not 0.5x) on cameras that expose a zoom range.
    const range = this.zoomRange();
    if (range) await this.setZoom(1);
    this.logTrack('active');
  }

  private async open(select: MediaTrackConstraints): Promise<MediaStream> {
    const video = {
      ...select,
      width: { ideal: this.cfg.idealWidth },
      height: { ideal: this.cfg.idealHeight },
      frameRate: { ideal: this.cfg.idealFrameRate },
    } as MediaTrackConstraints & { zoom?: boolean };
    // Asks Chrome to expose the zoom capability; only sent where the browser knows the constraint.
    if ((navigator.mediaDevices.getSupportedConstraints?.() as { zoom?: boolean } | undefined)?.zoom) video.zoom = true;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      // Some devices reject the ideal constraints; retry with the bare minimum.
      if (err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotReadableError')) {
        try {
          return await navigator.mediaDevices.getUserMedia({ video: select.deviceId ? { deviceId: select.deviceId } : true, audio: false });
        } catch (retryErr) {
          throw describeCameraError(retryErr);
        }
      }
      throw describeCameraError(err);
    }
  }

  /**
   * `facingMode: environment` may give the ultra-wide lens on multi-camera
   * phones. Device labels (readable once permission is granted) tell the
   * lenses apart, so switch to the main rear camera when it is a different one.
   */
  private async preferMainLens(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      console.info('[camera] video inputs:', devices.map((d) => `${d.label || '(no label)'} [${d.deviceId.slice(0, 8)}]`));
      const main = pickMainBackCamera(devices);
      const currentId = track.getSettings().deviceId;
      console.info('[camera] browser chose:', track.label, '| main rear camera:', main?.label ?? '(unknown)');
      if (!main || !main.deviceId || main.deviceId === currentId || main.label === track.label) return;
      const previous = this.stream;
      previous?.getTracks().forEach((t) => t.stop());
      try {
        this.stream = await this.open({ deviceId: { exact: main.deviceId } });
        console.info('[camera] switched to main rear camera:', main.label);
      } catch (err) {
        console.warn('[camera] could not open main rear camera, using default:', err);
        this.stream = await this.open({ facingMode: { ideal: this.cfg.facingMode } });
      }
    } catch (err) {
      console.warn('[camera] lens selection skipped:', err);
    }
  }

  private get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** The camera's optical/digital zoom range, or null when zoom is not supported. */
  zoomRange(): ZoomRange | null {
    const track = this.track;
    if (!track || typeof track.getCapabilities !== 'function') return null;
    const zoom = (track.getCapabilities() as { zoom?: { min?: number; max?: number; step?: number } }).zoom;
    if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number' || !(zoom.max > zoom.min)) return null;
    return { min: zoom.min, max: zoom.max, step: zoom.step ?? 0 };
  }

  get zoom(): number | null {
    const z = (this.track?.getSettings() as { zoom?: number } | undefined)?.zoom;
    return typeof z === 'number' ? z : null;
  }

  /** Applies real camera zoom (not a CSS crop). Returns the zoom now in effect. */
  async setZoom(value: number): Promise<number | null> {
    const track = this.track;
    const range = this.zoomRange();
    if (!track || !range) return null;
    const zoom = clampZoom(value, range);
    try {
      await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
      console.info(`[camera] zoom -> ${zoom} (requested ${value}, range ${range.min}–${range.max})`);
    } catch (err) {
      console.warn('[camera] zoom failed:', err);
    }
    return this.zoom;
  }

  private logTrack(stage: string): void {
    const track = this.track;
    if (!track) return;
    const s = track.getSettings();
    const caps = typeof track.getCapabilities === 'function' ? (track.getCapabilities() as Record<string, unknown>) : {};
    console.info(`[camera] ${stage} track:`, {
      label: track.label,
      deviceId: s.deviceId,
      facingMode: s.facingMode,
      width: s.width,
      height: s.height,
      aspectRatio: s.aspectRatio,
      frameRate: s.frameRate,
      zoom: (s as { zoom?: number }).zoom,
      zoomCapability: caps.zoom ?? 'not supported',
      video: `${this.video.videoWidth}x${this.video.videoHeight}`,
    });
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

function describeCameraError(err: unknown): CameraError {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return new CameraError('denied');
    if (err.name === 'NotFoundError') return new CameraError('notFound');
  }
  return new CameraError('other', err instanceof Error ? err.message : String(err));
}

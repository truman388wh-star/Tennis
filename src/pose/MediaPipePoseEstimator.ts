// MediaPipe Pose Landmarker (Lite) running fully on-device in the browser.
// The WASM runtime and model are served by this app (public/mediapipe,
// public/models); no CDN is contacted. If the local model is missing, the
// official model URL is used as a fallback. GPU delegate is preferred with
// automatic CPU fallback.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseConfig } from '../config/config';
import type { PoseFrame } from '../types';
import type { PoseEstimator } from './PoseEstimator';

export class MediaPipePoseEstimator implements PoseEstimator {
  readonly name = 'MediaPipe Pose Landmarker Lite';
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;
  delegate: 'GPU' | 'CPU' | null = null;

  constructor(
    private readonly cfg: PoseConfig,
    private readonly baseUrl: string = import.meta.env.BASE_URL,
  ) {}

  async init(): Promise<void> {
    const base = new URL(this.baseUrl, window.location.href);
    const wasm = await FilesetResolver.forVisionTasks(new URL(this.cfg.wasmPath, base).href.replace(/\/$/, ''));
    const localModel = new URL(this.cfg.modelPath, base).href;
    const modelAssetPath = (await exists(localModel)) ? localModel : this.cfg.fallbackModelUrl;

    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: this.cfg.minPoseDetectionConfidence,
        minPosePresenceConfidence: this.cfg.minPosePresenceConfidence,
        minTrackingConfidence: this.cfg.minTrackingConfidence,
        outputSegmentationMasks: false,
      });
    try {
      this.landmarker = await create('GPU');
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      this.landmarker = await create('CPU');
      this.delegate = 'CPU';
    }
  }

  estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | null {
    if (!this.landmarker || video.readyState < 2 || video.videoWidth === 0) return null;
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const ts = Math.max(Math.round(timestampMs), this.lastTs + 1);
    this.lastTs = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    const lms = result.landmarks[0];
    if (!lms || lms.length === 0) return null;
    const aspect = video.videoWidth / video.videoHeight;
    return {
      timestampMs: ts,
      aspect,
      // Convert to isotropic image units (see types/index.ts).
      landmarks: lms.map((l) => ({ x: l.x * aspect, y: l.y, z: l.z, visibility: l.visibility ?? 0 })),
    };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

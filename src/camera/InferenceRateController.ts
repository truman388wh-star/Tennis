// Decouples camera FPS from pose-inference FPS and adapts to device speed.
//
// The camera may deliver 30-60 fps; inference runs at `targetFps` at most.
// If recent inference times exceed `budget` x frame interval, the rate is
// lowered (down to minFps) so the UI stays responsive and timestamps stay
// regular; when inference is fast again the rate recovers towards targetFps.

export class InferenceRateController {
  private fps: number;
  private lastRunT = Number.NEGATIVE_INFINITY;
  private avgInferenceMs = 0;
  private samples = 0;

  constructor(
    private targetFps: number,
    private readonly minFps: number,
    private readonly maxFps: number,
    private readonly budget: number,
  ) {
    this.fps = clampFps(targetFps, minFps, maxFps);
  }

  get currentFps(): number {
    return this.fps;
  }

  get averageInferenceMs(): number {
    return this.avgInferenceMs;
  }

  setTarget(fps: number): void {
    this.targetFps = fps;
    this.fps = clampFps(fps, this.minFps, this.maxFps);
  }

  /** Whether a camera frame at time t (ms) should be sent to the pose model. */
  shouldRun(t: number): boolean {
    // Small tolerance so a 30 fps camera is not throttled by timer jitter.
    return t - this.lastRunT >= 1000 / this.fps - 4;
  }

  /** Records that inference ran at time t and took durationMs. */
  record(t: number, durationMs: number): void {
    this.lastRunT = t;
    this.samples++;
    const a = this.samples < 10 ? 1 / this.samples : 0.1;
    this.avgInferenceMs += a * (durationMs - this.avgInferenceMs);
    if (this.samples < 5) return;
    const allowed = (1000 / this.fps) * this.budget;
    if (this.avgInferenceMs > allowed && this.fps > this.minFps) {
      this.fps = Math.max(this.minFps, this.fps - 2);
    } else if (this.avgInferenceMs < allowed * 0.6 && this.fps < this.targetFps) {
      this.fps = Math.min(this.targetFps, this.fps + 1);
    }
  }
}

function clampFps(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

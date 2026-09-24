// Application controller: wires frame source -> pose estimator -> analysis
// session -> UI + speech. Owns the frame loop and all lifecycle concerns
// (start/stop, wake lock, errors). Contains no analysis logic itself.

import { createConfig, type AppConfig, type UserSettings } from '../config/config';
import { saveSettings } from '../config/settings';
import { CameraSource, VideoFileSource, type FrameSource } from '../camera/FrameSource';
import { InferenceRateController } from '../camera/InferenceRateController';
import { MediaPipePoseEstimator } from '../pose/MediaPipePoseEstimator';
import type { PoseEstimator } from '../pose/PoseEstimator';
import { SyntheticPoseSource } from '../pose/SyntheticPoseSource';
import { CoachSession, createDefaultStages, type LiveState } from '../session/CoachSession';
import { summarizeSession } from '../session/SessionSummary';
import { QueuedSpeechOutput, SilentEngine, WebSpeechEngine, type SpeechOutput } from '../speech/SpeechOutput';
import type { PoseFrame, StrokeAnalysis } from '../types';
import { CoachView } from '../ui/CoachView';
import { SkeletonOverlay } from '../ui/SkeletonOverlay';

type Mode = 'camera' | 'file' | 'demo';

const LIVE_UI_INTERVAL_MS = 100;

export class CoachApp {
  private readonly view: CoachView;
  private readonly overlay: SkeletonOverlay;
  private readonly speech: SpeechOutput;
  private estimator: PoseEstimator | null = null;
  private config: AppConfig = createConfig();

  private running = false;
  private mode: Mode = 'camera';
  private source: FrameSource | null = null;
  private session: CoachSession | null = null;
  private rate: InferenceRateController | null = null;
  private demo: SyntheticPoseSource | null = null;
  private loopHandle: number | null = null;
  private videoFrameHandle: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private startedAt = 0;
  private lastLiveUi = 0;
  private lastLive: LiveState | null = null;
  private lastPoseT = -1;
  private lastStrokeAt = 0;
  private framesInWindow: number[] = [];

  constructor(private settings: UserSettings) {
    this.view = new CoachView(settings, {
      onStartStop: () => void (this.running ? this.stop() : this.start('camera')),
      onVoiceToggle: () => this.toggleVoice(),
      onDemo: () => void this.start('demo'),
      onFile: (file) => void this.start('file', file),
      onSettingsChanged: (s) => this.updateSettings(s),
    }, this.config.historySize);
    this.overlay = new SkeletonOverlay(this.view.canvas);
    const engine = WebSpeechEngine.available()
      ? new WebSpeechEngine(this.config.speech.lang, this.config.speech.rate)
      : new SilentEngine();
    this.speech = new QueuedSpeechOutput(engine, this.config.speech.maxQueuedAgeMs);
    this.speech.setMuted(!settings.voiceEnabled);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.running) void this.acquireWakeLock();
    });
  }

  // ---- Lifecycle ------------------------------------------------------------

  async start(mode: Mode, file?: File): Promise<void> {
    if (this.running) return;
    this.view.showError(null);
    this.speech.unlock(); // Inside the click handler: required on iOS.
    this.mode = mode;
    this.config = createConfig({ camera: { facingMode: this.settings.cameraFacing } });
    this.session = new CoachSession(this.config, createDefaultStages(this.config, this.settings));
    this.rate = new InferenceRateController(
      this.settings.targetPoseFps,
      this.config.pose.minFps,
      this.config.pose.maxFps,
      this.config.pose.inferenceBudget,
    );
    this.view.resetStrokes();
    this.lastPoseT = -1;
    this.lastLive = null;
    this.framesInWindow = [];

    try {
      this.view.setBusy(true, mode === 'demo' ? 'Starting demo…' : 'Loading pose model…');
      if (mode === 'demo') {
        this.demo = new SyntheticPoseSource(this.settings.handedness);
        this.view.video.hidden = true;
      } else {
        if (!this.estimator) {
          const est = new MediaPipePoseEstimator(this.config.pose);
          await est.init();
          this.estimator = est;
        }
        this.view.setBusy(true, mode === 'camera' ? 'Starting camera…' : 'Opening video…');
        this.view.video.hidden = false;
        this.source = mode === 'camera' ? new CameraSource(this.view.video, this.config.camera) : new VideoFileSource(this.view.video, file!);
        await this.source.start();
        this.view.setMirrored(this.source.mirrored);
        if (mode === 'file') this.view.video.addEventListener('ended', this.onVideoEnded);
      }
    } catch (err) {
      this.view.setBusy(false);
      this.cleanupSource();
      this.view.setStatus('error', 'Could not start');
      this.view.showError(err instanceof Error ? err.message : String(err));
      return;
    }

    this.running = true;
    this.startedAt = performance.now();
    this.view.setBusy(false);
    this.view.setRunning(true, mode === 'camera' ? 'live' : mode);
    void this.acquireWakeLock();
    this.scheduleNext();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.cancelLoop();
    this.cleanupSource();
    this.speech.cancel();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.overlay.clear();
    this.view.setRunning(false, 'idle');
    const analyses = this.session?.analyses ?? [];
    this.view.showSummary(summarizeSession(analyses, performance.now() - this.startedAt));
  }

  private readonly onVideoEnded = () => this.stop();

  private cleanupSource(): void {
    this.view.video.removeEventListener('ended', this.onVideoEnded);
    this.source?.stop();
    this.source = null;
    this.demo = null;
  }

  // ---- Frame loop -------------------------------------------------------------

  /**
   * Uses requestVideoFrameCallback when available (fires once per decoded
   * camera frame), otherwise requestAnimationFrame. Inference is throttled
   * by the InferenceRateController, independently of the camera frame rate.
   */
  private scheduleNext(): void {
    if (!this.running) return;
    const video = this.view.video;
    if (this.mode !== 'demo' && 'requestVideoFrameCallback' in video) {
      this.videoFrameHandle = video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.loopHandle = requestAnimationFrame(() => this.tick());
    }
  }

  private cancelLoop(): void {
    if (this.loopHandle !== null) cancelAnimationFrame(this.loopHandle);
    if (this.videoFrameHandle !== null && 'cancelVideoFrameCallback' in this.view.video) {
      this.view.video.cancelVideoFrameCallback(this.videoFrameHandle);
    }
    this.loopHandle = null;
    this.videoFrameHandle = null;
  }

  private tick(): void {
    if (!this.running || !this.session || !this.rate) return;
    const now = performance.now();
    try {
      if (this.rate.shouldRun(now)) {
        let pose: PoseFrame | null = null;
        const t0 = performance.now();
        if (this.mode === 'demo') {
          pose = this.demo!.frameAt(now - this.startedAt);
        } else if (this.estimator) {
          // Stream time: wall clock for the camera, media time for files.
          const ts = this.mode === 'file' ? this.view.video.currentTime * 1000 : now;
          pose = this.estimator.estimate(this.view.video, ts);
        }
        this.rate.record(now, performance.now() - t0);
        this.countFrame(now);
        this.handlePose(pose);
      }
      if (now - this.lastLiveUi > LIVE_UI_INTERVAL_MS) {
        this.lastLiveUi = now;
        this.view.updateLive(this.lastLive, this.measuredFps(now), this.mode === 'demo' ? null : this.rate.averageInferenceMs);
      }
    } catch (err) {
      console.error(err);
      this.view.showError(`Processing error: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.scheduleNext();
  }

  private handlePose(pose: PoseFrame | null): void {
    if (!pose) {
      this.lastLive = null;
      this.overlay.clear();
      return;
    }
    if (pose.timestampMs <= this.lastPoseT) return; // Same frame twice.
    this.lastPoseT = pose.timestampMs;
    const result = this.session!.processFrame(pose);
    this.lastLive = result.live;
    const highlight = result.live.detectorState === 'swinging' || result.live.detectorState === 'followThrough';
    this.overlay.draw(pose, this.settings.handedness, this.source?.mirrored ?? false, this.config.features.minVisibility, highlight);
    if (result.analysis) this.onStroke(result.analysis);
  }

  private onStroke(a: StrokeAnalysis): void {
    this.lastStrokeAt = performance.now();
    this.view.showStroke(a, this.session!.analyses.slice(-this.config.historySize));
    if (a.feedback.speak) this.speech.speak(a.feedback.text, a.feedback.priority);
  }

  private countFrame(now: number): void {
    this.framesInWindow.push(now);
    while (this.framesInWindow.length && now - this.framesInWindow[0] > 1000) this.framesInWindow.shift();
  }

  private measuredFps(now: number): number {
    const n = this.framesInWindow.filter((t) => now - t <= 1000).length;
    return n;
  }

  // ---- Settings -------------------------------------------------------------

  private toggleVoice(): void {
    this.settings = { ...this.settings, voiceEnabled: !this.settings.voiceEnabled };
    this.speech.setMuted(!this.settings.voiceEnabled);
    if (this.settings.voiceEnabled) this.speech.unlock();
    this.view.setVoice(this.settings.voiceEnabled);
    saveSettings(this.settings);
  }

  private updateSettings(s: UserSettings): void {
    this.settings = { ...s, voiceEnabled: this.settings.voiceEnabled };
    saveSettings(this.settings);
  }

  private async acquireWakeLock(): Promise<void> {
    // Keeps the screen on during practice; silently unsupported on some browsers.
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
      }
    } catch {
      this.wakeLock = null;
    }
  }

  /** For automated tests: current number of analyzed strokes. */
  get strokeCount(): number {
    return this.session?.analyses.length ?? 0;
  }

  get lastStrokeTime(): number {
    return this.lastStrokeAt;
  }
}

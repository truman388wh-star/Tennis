// Application controller: wires frame source -> pose estimator -> analysis
// session -> UI + speech. Owns the frame loop and all lifecycle concerns
// (start/stop, wake lock, errors). Contains no analysis logic itself.

import { createConfig, type AppConfig, type UserSettings } from '../config/config';
import { saveSettings } from '../config/settings';
import { CameraError, CameraSource, VideoFileSource, type FrameSource } from '../camera/FrameSource';
import { zoomPresets } from '../camera/lens';
import { coachingText, fmt, type I18n, type Language, type Messages } from '../i18n';
import { InferenceRateController } from '../camera/InferenceRateController';
import { MediaPipePoseEstimator } from '../pose/MediaPipePoseEstimator';
import type { PoseEstimator } from '../pose/PoseEstimator';
import { SyntheticPoseSource } from '../pose/SyntheticPoseSource';
import { CoachSession, createDefaultStages, type LiveState } from '../session/CoachSession';
import { summarizeSession } from '../session/SessionSummary';
import { AudioClipPlayer, FallbackSpeechEngine, QueuedSpeechOutput, WebSpeechEngine, type SpeechOutput } from '../speech/SpeechOutput';
import { messageId } from '../coaching/messageKeys';
import type { PoseFrame, StrokeAnalysis } from '../types';
import { CoachView, type SpeechOutcome, type Text } from '../ui/CoachView';
import { SkeletonOverlay } from '../ui/SkeletonOverlay';

type Mode = 'camera' | 'file' | 'demo';

const LIVE_UI_INTERVAL_MS = 100;

export class CoachApp {
  private readonly view: CoachView;
  private readonly overlay: SkeletonOverlay;
  private readonly speech: SpeechOutput;
  private readonly speechEngine: FallbackSpeechEngine;
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

  constructor(
    private settings: UserSettings,
    private readonly i18n: I18n,
  ) {
    this.view = new CoachView(settings, i18n, {
      onStartStop: () => void (this.running ? this.stop() : this.start('camera')),
      onVoiceToggle: () => this.toggleVoice(),
      onDemo: () => void this.start('demo'),
      onFile: (file) => void this.start('file', file),
      onSettingsChanged: (s) => this.updateSettings(s),
      onLanguageChanged: (lang) => this.changeLanguage(lang),
      onVoiceTest: () => this.testSpeech(),
      onZoom: (level) => void this.setZoom(level),
    }, this.config.historySize);
    this.overlay = new SkeletonOverlay(this.view.canvas);
    // Speech follows the UI language: Web Speech with a matching voice, else
    // the default system voice with utterance.lang, else bundled audio clips.
    const web = WebSpeechEngine.supported() ? new WebSpeechEngine(i18n.lang, this.config.speech.rate) : null;
    const clips = new AudioClipPlayer(new URL(import.meta.env.BASE_URL, window.location.href).href);
    this.speechEngine = new FallbackSpeechEngine(i18n.lang, web, clips);
    this.speechEngine.onFailure = () => this.view.showNotice((t) => t.speech.failed);
    this.speech = new QueuedSpeechOutput(this.speechEngine, this.config.speech.maxQueuedAgeMs);
    this.speech.setMuted(!settings.voiceEnabled);
    i18n.subscribe((lang) => {
      this.speech.setLanguage(lang);
      this.updateVoiceNotice();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.running) void this.acquireWakeLock();
    });
  }

  // ---- Lifecycle ------------------------------------------------------------

  async start(mode: Mode, file?: File): Promise<void> {
    if (this.running) return;
    this.view.showError(null);
    this.speech.unlock(); // Inside the click handler: required on iOS.
    this.updateVoiceNotice();
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
      this.view.setBusy(true, mode === 'demo' ? (t) => t.status.startingDemo : (t) => t.status.loadingModel);
      if (mode === 'demo') {
        this.demo = new SyntheticPoseSource(this.settings.handedness);
        this.view.video.hidden = true;
      } else {
        if (!this.estimator) {
          const est = new MediaPipePoseEstimator(this.config.pose);
          await est.init();
          this.estimator = est;
        }
        this.view.setBusy(true, mode === 'camera' ? (t) => t.status.startingCamera : (t) => t.status.openingVideo);
        this.view.video.hidden = false;
        this.source = mode === 'camera' ? new CameraSource(this.view.video, this.config.camera) : new VideoFileSource(this.view.video, file!);
        await this.source.start();
        this.view.setMirrored(this.source.mirrored);
        this.view.setCover(mode === 'camera');
        if (this.source instanceof CameraSource) {
          this.view.setZoomLevels(zoomPresets(this.source.zoomRange()), this.source.zoom);
        }
        if (mode === 'file') this.view.video.addEventListener('ended', this.onVideoEnded);
      }
    } catch (err) {
      this.view.setBusy(false);
      this.cleanupSource();
      this.view.setStatus('error', (t) => t.status.couldNotStart);
      this.view.showError(startErrorText(err));
      return;
    }

    this.running = true;
    this.startedAt = performance.now();
    this.view.setBusy(false);
    this.view.setRunning(true, mode === 'camera' ? 'live' : mode);
    void this.acquireWakeLock();
    this.scheduleNext();
  }

  /** Real camera zoom (live camera only). */
  async setZoom(level: number): Promise<void> {
    if (!(this.source instanceof CameraSource)) return;
    this.view.setActiveZoom(await this.source.setZoom(level));
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
    this.view.setCover(false);
    this.view.setZoomLevels([], null);
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
      const message = err instanceof Error ? err.message : String(err);
      this.view.showError((t) => fmt(t.errors.processing, { message }));
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
    this.overlay.draw(pose, this.settings.handedness, this.source?.mirrored ?? false, this.config.features.minVisibility, highlight, this.source?.kind === 'camera');
    if (result.analysis) this.onStroke(result.analysis);
  }

  private onStroke(a: StrokeAnalysis): void {
    this.lastStrokeAt = performance.now();
    let outcome: SpeechOutcome = 'notSpoken';
    if (a.feedback.speak && this.settings.voiceEnabled) {
      // Text in the current language; spoken only with an on-device voice.
      const result = this.speech.speak(
        coachingText(a.feedback.message, this.i18n.lang),
        a.feedback.priority,
        messageId(a.feedback.message),
      );
      outcome = result === 'unavailable' ? 'noVoice' : result === 'muted' ? 'notSpoken' : 'spoken';
      if (result === 'unavailable') this.updateVoiceNotice();
    }
    this.view.showStroke(a, this.session!.analyses.slice(-this.config.historySize), outcome);
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
    this.view.setVoice(this.settings.voiceEnabled);
    if (this.settings.voiceEnabled) {
      // Inside the tap: unlock audio, then confirm audibly so it can be heard working.
      this.speech.unlock();
      this.speech.speak(this.i18n.t.speech.enabled, 3, 'speech.enabled');
    }
    this.updateVoiceNotice();
    saveSettings(this.settings);
  }

  /** Voice test button: turns voice on if needed and speaks a test sentence. */
  testSpeech(): void {
    if (!this.settings.voiceEnabled) {
      this.settings = { ...this.settings, voiceEnabled: true };
      this.speech.setMuted(false);
      this.view.setVoice(true);
      saveSettings(this.settings);
    }
    this.view.showNotice(null);
    this.speechEngine.resetFailures();
    this.speech.cancel();
    this.speech.unlock();
    const result = this.speech.speak(this.i18n.t.speech.test, 9, 'speech.test');
    console.info('[speech] voice test:', result);
    if (result === 'unavailable') this.updateVoiceNotice();
  }

  private updateSettings(s: UserSettings): void {
    this.settings = { ...s, voiceEnabled: this.settings.voiceEnabled, language: this.settings.language };
    saveSettings(this.settings);
  }

  /** User picked a language: apply immediately (UI + speech) and remember it. */
  private changeLanguage(lang: Language): void {
    this.settings = { ...this.settings, language: lang };
    saveSettings(this.settings);
    this.i18n.setLanguage(lang);
  }

  /** Shows a short notice when voice is on but no way to produce speech exists. */
  private updateVoiceNotice(): void {
    const missing = this.settings.voiceEnabled && !this.speech.available;
    this.view.showNotice(missing ? (t) => t.speech.failed : null);
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

  /** For automated tests: current UI/speech language. */
  get language(): Language {
    return this.i18n.lang;
  }

  /** For automated tests: current number of analyzed strokes. */
  get strokeCount(): number {
    return this.session?.analyses.length ?? 0;
  }

  get lastStrokeTime(): number {
    return this.lastStrokeAt;
  }
}

function startErrorText(err: unknown): Text {
  if (err instanceof CameraError) {
    const code = err.code;
    const detail = err.message;
    return (t: Messages) =>
      code === 'insecure'
        ? t.errors.cameraInsecure
        : code === 'unsupported'
          ? t.errors.cameraUnsupported
          : code === 'denied'
            ? t.errors.cameraDenied
            : code === 'notFound'
              ? t.errors.cameraNotFound
              : fmt(t.errors.cameraOther, { message: detail });
  }
  const message = err instanceof Error ? err.message : String(err);
  return (t: Messages) => fmt(t.errors.startFailed, { message });
}

// Central configuration: every tunable threshold, weight and timing constant
// lives here so that core algorithms contain no magic numbers.
//
// Units: "T" = torso lengths (mid-shoulder to mid-hip distance). Speeds are in
// T/s. Using body-relative units keeps thresholds independent of how far the
// phone is from the player and of the player's size.

import type { CategoryId, Handedness, MetricId, NetDirection } from '../types';

export interface CameraConfig {
  facingMode: 'environment' | 'user';
  idealWidth: number;
  idealHeight: number;
  idealFrameRate: number;
}

export interface PoseConfig {
  /**
   * Served by the app itself (see scripts/setup-assets.mjs). No third-party
   * host is ever contacted at runtime.
   */
  wasmPath: string;
  modelPath: string;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  /** Target pose inference rate; the camera may run faster. */
  targetFps: number;
  /** Adaptive rate limits: inference fps is lowered when the device is slow. */
  minFps: number;
  maxFps: number;
  /** Fraction of the frame interval inference may use before fps is lowered. */
  inferenceBudget: number;
}

export interface FeatureConfig {
  /** Landmarks below this visibility are treated as missing. */
  minVisibility: number;
  /** One Euro filter parameters (see utils/oneEuro.ts). */
  smoothingMinCutoff: number;
  smoothingBeta: number;
  smoothingDCutoff: number;
  /** Gaps longer than this reset smoothing/velocity (ms). */
  maxGapMs: number;
  /** Velocity is a finite difference over this many frames (latency vs noise). */
  velocityWindowFrames: number;
  /** EMA factor for the body scale (torso length) estimate. */
  bodyScaleAlpha: number;
  /**
   * Prior for full (unforeshortened) shoulder / hip width in torso lengths.
   * The extractor also learns the observed maximum within these bounds.
   */
  shoulderWidthPrior: number;
  shoulderWidthMin: number;
  shoulderWidthMax: number;
  hipWidthPrior: number;
  hipWidthMin: number;
  hipWidthMax: number;
}

export interface DetectionConfig {
  /** Rolling buffer length (ms). Must exceed preContactWindowMs + confirmDelayMs. */
  bufferWindowMs: number;
  /** Wrist speed that counts as "the player is moving the racket" (T/s). */
  prepSpeed: number;
  /** Wrist speed that starts a swing candidate (T/s). */
  swingSpeed: number;
  /** A swing must peak at least this fast to count as a forehand (T/s). */
  minPeakSpeed: number;
  /** Swing -> follow-through once speed falls below peak * ratio. */
  followThroughDropRatio: number;
  /** Time after the speed peak before the stroke is confirmed (ms). */
  confirmDelayMs: number;
  /** No new stroke is accepted for this long after one is confirmed (ms). */
  cooldownMs: number;
  /** Preparation state times out after this long without a swing (ms). */
  prepTimeoutMs: number;
  /** Analysis window look-back before the speed peak (ms). */
  preContactWindowMs: number;
  /** Minimum time above swingSpeed for a real swing (ms). */
  minSwingMs: number;
  /** A swing candidate is abandoned if the wrist is lost for longer (ms). */
  maxTrackingGapMs: number;
  /**
   * Two-handed swing rejection: if the off-hand wrist stays within this
   * distance (T) of the dominant wrist...
   */
  twoHandedMaxDistance: number;
  /** ...for at least this fraction of the fast swing frames. */
  twoHandedMinFraction: number;
  /** Minimum nose-ahead-of-ears offset (T) for the facing cue to be trusted. */
  facingMinOffset: number;
  /** Learned net direction needs this many strokes and agreement ratio. */
  directionMinVotes: number;
  directionMinAgreement: number;
}

export interface SegmentationConfig {
  /** Search window around the detector peak for peak forward speed (ms). */
  contactSearchBeforeMs: number;
  contactSearchAfterMs: number;
  /** Half-width of the reported approximate contact region (ms). */
  contactHalfWindowMs: number;
  /** Backswing starts when the wrist moves back faster than this (T/s). */
  backswingStartSpeed: number;
  /** Follow-through ends when wrist speed drops below this (T/s). */
  followThroughEndSpeed: number;
}

export interface MetricsConfig {
  /** Fraction of max shoulder turn that counts as "unit turn done". */
  unitTurnFraction: number;
  /** Wrist speed under which the swing is considered paused (T/s). */
  pauseSpeed: number;
}

/**
 * Metric -> score mapping. Inside [idealMin, idealMax] scores 100, falls
 * linearly to 0 at hardMin / hardMax. Use +/-Infinity for one-sided ranges.
 */
export interface MetricRange {
  hardMin: number;
  idealMin: number;
  idealMax: number;
  hardMax: number;
}

export interface ScoringConfig {
  ranges: Partial<Record<MetricId, MetricRange>>;
  /** Which metrics make up each category and their relative weights. */
  categoryMetrics: Record<CategoryId, Partial<Record<MetricId, number>>>;
  /** Category weights for the overall score (renormalized over available ones). */
  categoryWeights: Record<CategoryId, number>;
  /**
   * Share of the overall score taken by the weakest category, so one clear
   * flaw (e.g. a late contact) is not averaged away by six good areas.
   */
  weakestAreaWeight: number;
  /** Mean landmark visibility below this lowers confidence. */
  goodVisibility: number;
}

export interface CoachingConfig {
  /** Issues below this severity (0..1) are ignored. */
  minIssueSeverity: number;
  /** Severity above which an issue is spoken even when it would be throttled. */
  highSeverity: number;
  /** An earlier issue counts as fixed when its severity drops below this. */
  resolvedSeverity: number;
  /** Strokes remembered by the coaching memory. */
  memorySize: number;
  /** Look-back (strokes) for recurring issues, and how many make it "recurring". */
  repeatWindow: number;
  repeatCount: number;
  /** Strokes to wait before saying the "recurring" message again. */
  repeatCooldownStrokes: number;
  /** Strokes to wait before speaking the identical message again. */
  sameMessageCooldownStrokes: number;
  /** Look-back (strokes) for an issue that may now be fixed. */
  improvementLookback: number;
  /** Overall score from which a stroke may be praised. */
  praiseMinScore: number;
  /** Category score that counts as a strength worth praising. */
  praiseCategoryMinScore: number;
  /** Speak praise at most every N strokes (it is always shown). */
  praiseEveryStrokes: number;
  /** Strokes with lower confidence get a visibility hint instead of coaching. */
  minConfidence: number;
}

export interface SpeechConfig {
  rate: number;
  /** Queued messages older than this are dropped (stale feedback is noise). */
  maxQueuedAgeMs: number;
}

export interface UserSettings {
  /**
   * UI and speech language chosen by the user. Undefined until the user picks
   * one; the device/browser language is used until then.
   */
  language?: 'zh-CN' | 'en-US';
  handedness: Handedness;
  netDirection: NetDirection;
  voiceEnabled: boolean;
  targetPoseFps: number;
  cameraFacing: 'environment' | 'user';
}

export interface AppConfig {
  camera: CameraConfig;
  pose: PoseConfig;
  features: FeatureConfig;
  detection: DetectionConfig;
  segmentation: SegmentationConfig;
  metrics: MetricsConfig;
  scoring: ScoringConfig;
  coaching: CoachingConfig;
  speech: SpeechConfig;
  /** Strokes shown in the on-screen history. */
  historySize: number;
}

const INF = Number.POSITIVE_INFINITY;

export const DEFAULT_CONFIG: AppConfig = {
  camera: {
    facingMode: 'environment',
    idealWidth: 1280,
    idealHeight: 720,
    idealFrameRate: 30,
  },
  pose: {
    wasmPath: 'mediapipe/wasm',
    modelPath: 'models/pose_landmarker_lite.task',
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    targetFps: 30,
    minFps: 12,
    maxFps: 60,
    inferenceBudget: 0.8,
  },
  features: {
    minVisibility: 0.5,
    smoothingMinCutoff: 1.5,
    smoothingBeta: 0.4,
    smoothingDCutoff: 1.0,
    maxGapMs: 250,
    velocityWindowFrames: 2,
    bodyScaleAlpha: 0.1,
    shoulderWidthPrior: 0.8,
    shoulderWidthMin: 0.55,
    shoulderWidthMax: 1.1,
    hipWidthPrior: 0.6,
    hipWidthMin: 0.4,
    hipWidthMax: 0.9,
  },
  detection: {
    bufferWindowMs: 3000,
    prepSpeed: 1.2,
    swingSpeed: 4,
    minPeakSpeed: 5.5,
    followThroughDropRatio: 0.6,
    confirmDelayMs: 400,
    cooldownMs: 450,
    prepTimeoutMs: 3000,
    preContactWindowMs: 1600,
    minSwingMs: 50,
    maxTrackingGapMs: 300,
    twoHandedMaxDistance: 0.35,
    twoHandedMinFraction: 0.7,
    facingMinOffset: 0.05,
    directionMinVotes: 2,
    directionMinAgreement: 0.75,
  },
  segmentation: {
    contactSearchBeforeMs: 200,
    contactSearchAfterMs: 100,
    contactHalfWindowMs: 50,
    backswingStartSpeed: 0.8,
    followThroughEndSpeed: 1.5,
  },
  metrics: {
    unitTurnFraction: 0.8,
    pauseSpeed: 1.0,
  },
  scoring: {
    // Starting points derived from coaching literature and synthetic tests.
    // They are heuristics and should be tuned with real recordings.
    ranges: {
      unitTurnLeadMs: { hardMin: -100, idealMin: 200, idealMax: INF, hardMax: INF },
      shoulderTurnDeg: { hardMin: 20, idealMin: 60, idealMax: 90, hardMax: INF },
      hipTurnDeg: { hardMin: 5, idealMin: 30, idealMax: 90, hardMax: INF },
      separationDeg: { hardMin: -20, idealMin: 5, idealMax: 60, hardMax: 90 },
      shoulderUnwindDeg: { hardMin: 0, idealMin: 30, idealMax: INF, hardMax: INF },
      shoulderTurnAtContactDeg: { hardMin: -INF, idealMin: -INF, idealMax: 40, hardMax: 80 },
      trunkLeanDeg: { hardMin: -30, idealMin: -12, idealMax: 20, hardMax: 45 },
      headDriftRatio: { hardMin: -INF, idealMin: -INF, idealMax: 0.3, hardMax: 1.0 },
      stanceWidthRatio: { hardMin: 0.3, idealMin: 0.7, idealMax: 2.2, hardMax: 3.2 },
      weightTransferRatio: { hardMin: -0.25, idealMin: 0.12, idealMax: INF, hardMax: INF },
      contactForwardRatio: { hardMin: -0.2, idealMin: 0.25, idealMax: 1.1, hardMax: 1.9 },
      contactHeightRatio: { hardMin: -0.9, idealMin: -0.25, idealMax: 0.75, hardMax: 1.4 },
      elbowAngleAtContactDeg: { hardMin: 70, idealMin: 115, idealMax: INF, hardMax: INF },
      forwardSwingMs: { hardMin: 40, idealMin: 90, idealMax: 350, hardMax: 700 },
      transitionPauseMs: { hardMin: -INF, idealMin: -INF, idealMax: 120, hardMax: 500 },
      followThroughHeightRatio: { hardMin: -1.0, idealMin: -0.1, idealMax: INF, hardMax: INF },
      followThroughTravelRatio: { hardMin: 0.3, idealMin: 1.2, idealMax: INF, hardMax: INF },
    },
    categoryMetrics: {
      preparation: { unitTurnLeadMs: 2, shoulderTurnDeg: 1 },
      rotation: { shoulderTurnDeg: 2, hipTurnDeg: 1, separationDeg: 1, shoulderUnwindDeg: 1 },
      balance: { trunkLeanDeg: 1, headDriftRatio: 1, stanceWidthRatio: 1 },
      weightTransfer: { weightTransferRatio: 1 },
      contact: { contactForwardRatio: 3, contactHeightRatio: 1, elbowAngleAtContactDeg: 1 },
      timing: { shoulderTurnAtContactDeg: 1, transitionPauseMs: 1, forwardSwingMs: 1 },
      followThrough: { followThroughHeightRatio: 1, followThroughTravelRatio: 1 },
    },
    categoryWeights: {
      contact: 0.22,
      rotation: 0.18,
      preparation: 0.15,
      followThrough: 0.12,
      balance: 0.12,
      weightTransfer: 0.11,
      timing: 0.1,
    },
    weakestAreaWeight: 0.35,
    goodVisibility: 0.8,
  },
  coaching: {
    minIssueSeverity: 0.3,
    highSeverity: 0.8,
    resolvedSeverity: 0.15,
    memorySize: 10,
    repeatWindow: 5,
    repeatCount: 3,
    repeatCooldownStrokes: 4,
    sameMessageCooldownStrokes: 1,
    improvementLookback: 3,
    praiseMinScore: 80,
    praiseCategoryMinScore: 85,
    praiseEveryStrokes: 2,
    minConfidence: 0.45,
  },
  speech: {
    rate: 1.05,
    maxQueuedAgeMs: 2500,
  },
  historySize: 8,
};

export const DEFAULT_SETTINGS: UserSettings = {
  handedness: 'right',
  netDirection: 'auto',
  voiceEnabled: true,
  targetPoseFps: DEFAULT_CONFIG.pose.targetFps,
  cameraFacing: 'environment',
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Returns a copy of the default config with overrides deep-merged in. */
export function createConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  return deepMerge(
    structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as unknown as AppConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = target[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      deepMerge(existing, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

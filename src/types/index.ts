// Shared data types that flow between the pipeline stages.
//
// Coordinate convention (important for every module):
//   Pose landmarks are expressed in *isotropic image units*: y is the
//   normalized image row (0 = top, 1 = bottom) and x is the normalized image
//   column multiplied by the frame aspect ratio (width / height). One unit
//   therefore has the same physical length horizontally and vertically, which
//   keeps angles and distances meaningful. y grows downwards.

export type Handedness = 'right' | 'left';

/** Which side of the camera image the net is on. `auto` learns it from swings. */
export type NetDirection = 'auto' | 'left' | 'right';

/** +1: "forward" (towards the net) is +x in the image; -1: forward is -x. */
export type ForwardSign = 1 | -1;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Landmark {
  x: number;
  y: number;
  /** Relative depth as reported by the pose model (not used for core metrics). */
  z: number;
  /** 0..1 likelihood that the landmark is visible. */
  visibility: number;
}

/** One pose observation from a pose estimator. */
export interface PoseFrame {
  timestampMs: number;
  /** 33 landmarks in MediaPipe BlazePose order, isotropic image units. */
  landmarks: Landmark[];
  /** width / height of the source frame. */
  aspect: number;
}

/**
 * Per-frame body features derived from a pose frame. Positions marked
 * "body-relative" are (point - hipCenter) / bodyScale, i.e. measured in torso
 * lengths from the middle of the hips. Nulls mean "not reliably observed".
 */
export interface BodyFeatures {
  t: number;
  /** True when the torso was visible enough to compute a body scale. */
  valid: boolean;
  /** Torso length (mid-shoulder to mid-hip) in image units, smoothed. */
  bodyScale: number;
  hipCenter: Vec2 | null;
  shoulderCenter: Vec2 | null;
  /** Dominant wrist, body-relative. */
  wrist: Vec2 | null;
  /** Dominant wrist velocity, body-relative (torso lengths / second). */
  wristVel: Vec2 | null;
  wristSpeed: number | null;
  /** Magnitude of dominant wrist acceleration (torso lengths / s^2). */
  wristAccel: number | null;
  /** Non-dominant wrist, body-relative (used to reject two-handed swings). */
  offWrist: Vec2 | null;
  /** Dominant elbow angle shoulder-elbow-wrist, degrees (180 = straight). */
  elbowAngle: number | null;
  /** Dominant arm elevation: angle between torso (down) and upper arm, degrees. */
  shoulderAngle: number | null;
  /** Estimated shoulder-line turn away from "square to the net", degrees 0..90. */
  shoulderTurn: number | null;
  /** Estimated hip-line turn, degrees 0..90. */
  hipTurn: number | null;
  /** Torso lean from vertical, degrees, positive = top of torso towards +x. */
  trunkLean: number | null;
  /** Ankle-to-ankle distance in torso lengths. */
  stanceWidth: number | null;
  /** Mid-ankle point, absolute image units. */
  ankleCenter: Vec2 | null;
  /** Nose, absolute image units. */
  head: Vec2 | null;
  /**
   * Horizontal offset of the nose from the ear midpoint (T). In a side view
   * the face points towards the net, so its sign indicates "forward".
   */
  facing: number | null;
  /** Mean visibility of the key landmarks (0..1). */
  visibility: number;
}

/** Live state of the stroke event detector, used by the UI. */
export type DetectorState = 'idle' | 'preparing' | 'swinging' | 'followThrough' | 'cooldown';

/** A detected forehand, emitted after its follow-through has been observed. */
export interface StrokeEvent {
  id: number;
  /** Beginning of the analysis window (movement onset or look-back limit). */
  windowStartT: number;
  /** Time of peak dominant-wrist speed (approximate contact). */
  peakT: number;
  /** Time the stroke was confirmed; end of the analysis window. */
  endT: number;
  peakSpeed: number;
  /** Direction of the peak swing in image x. */
  swingSign: ForwardSign;
  /** Forward sign used for analysis (configured, learned, or this swing's). */
  forwardSign: ForwardSign;
}

export type PhaseName = 'preparation' | 'backswing' | 'forwardSwing' | 'contact' | 'followThrough';

export interface PhaseInterval {
  startT: number;
  endT: number;
  startIndex: number;
  endIndex: number;
}

export interface StrokePhases {
  preparation: PhaseInterval;
  backswing: PhaseInterval;
  forwardSwing: PhaseInterval;
  /** Approximate contact region (estimated from kinematics, not ball detection). */
  contact: PhaseInterval;
  followThrough: PhaseInterval;
  /** Frame index of estimated contact (peak forward wrist speed). */
  contactIndex: number;
  /** Frame index where the backswing ends (rearmost wrist position). */
  backswingEndIndex: number;
}

export const METRIC_IDS = [
  'unitTurnLeadMs',
  'backswingDurationMs',
  'shoulderTurnDeg',
  'hipTurnDeg',
  'separationDeg',
  'shoulderUnwindDeg',
  'shoulderTurnAtContactDeg',
  'trunkLeanDeg',
  'headDriftRatio',
  'stanceWidthRatio',
  'weightTransferRatio',
  'contactForwardRatio',
  'contactHeightRatio',
  'elbowAngleAtContactDeg',
  'forwardSwingMs',
  'transitionPauseMs',
  'peakWristSpeed',
  'followThroughHeightRatio',
  'followThroughTravelRatio',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

/** Per-stroke technical metrics; null = could not be measured. */
export type StrokeMetrics = Record<MetricId, number | null>;

export const CATEGORY_IDS = [
  'preparation',
  'rotation',
  'balance',
  'weightTransfer',
  'contact',
  'timing',
  'followThrough',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface StrokeScore {
  /** 0..100 weighted overall score. */
  overall: number;
  categories: Record<CategoryId, number | null>;
  metricScores: Partial<Record<MetricId, number>>;
  /** 0..1 confidence in the measurement (visibility and metric coverage). */
  confidence: number;
}

export type FeedbackKind = 'issue' | 'repeat' | 'improvement' | 'praise' | 'visibility';

export interface CoachingFeedback {
  text: string;
  kind: FeedbackKind;
  /** Issue this feedback is about, if any. */
  issueId: string | null;
  /** Higher = more important; used by the speech queue. */
  priority: number;
  /** Whether the feedback controller wants this spoken aloud. */
  speak: boolean;
  /** Short developer-facing explanation of the decision. */
  reason: string;
}

export interface IssueAssessment {
  id: string;
  category: CategoryId;
  /** 0..1 how pronounced the issue is. */
  severity: number;
  /** severity x issue importance, used for ranking. */
  rank: number;
}

export interface StrokeAnalysis {
  index: number;
  event: StrokeEvent;
  phases: StrokePhases;
  metrics: StrokeMetrics;
  score: StrokeScore;
  issues: IssueAssessment[];
  feedback: CoachingFeedback;
  /** Time from estimated contact to feedback being ready, ms (stream time). */
  feedbackDelayMs: number;
}

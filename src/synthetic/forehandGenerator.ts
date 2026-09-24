// Synthetic pose generator: a kinematic stick-figure player hitting
// forehands, seen from the side (camera looking along the baseline), exactly
// as the app assumes. Used by the unit tests (no camera in CI) and by the
// in-app demo mode.
//
// World frame (units: torso lengths T): X = towards the net, Y = up,
// Z = towards the camera. Trajectories are Hermite splines through
// keyframes, so velocities are continuous and peak during the forward swing.
// Technique parameters (turn, contact point, weight shift, ...) can be varied
// to produce good and flawed strokes with known ground truth.

import type { ForwardSign, Handedness, Landmark, PoseFrame } from '../types';
import { LM, NUM_LANDMARKS } from '../pose/landmarks';
import { gaussian, mulberry32 } from '../utils/random';

export interface ForehandParams {
  /** Max shoulder turn at the end of the backswing (deg). */
  shoulderTurnDeg: number;
  hipTurnDeg: number;
  /** Wrist position at contact, torso lengths in front of the hip center. */
  contactForward: number;
  /** Follow-through finish height relative to the default (T). */
  followThroughHeight: number;
  /** Forward travel of the hips during the stroke (T). */
  weightShift: number;
  /** Trunk lean at contact (deg, positive = towards the net). */
  leanDeg: number;
  stanceWidth: number;
  /** Elbow bend offset (T); larger = more cramped arm. */
  elbowBend: number;
  /** Head sway amplitude during the swing (T). */
  headSway: number;
  /** Unit turn happens late (just before the forward swing). */
  latePreparation: boolean;
  /** Only the backswing happens; no forward swing (e.g. a let-ball). */
  incomplete: boolean;
  /** Off hand stays on the racket (two-handed swing). */
  twoHanded: boolean;
  /** >1 = slower stroke, <1 = faster. */
  timeScale: number;
}

export const GOOD_FOREHAND: ForehandParams = {
  shoulderTurnDeg: 80,
  hipTurnDeg: 45,
  contactForward: 0.6, // = GOOD_CONTACT
  followThroughHeight: 0.4,
  weightShift: 0.4,
  leanDeg: 5,
  stanceWidth: 1.4,
  elbowBend: 0.2,
  headSway: 0.03,
  latePreparation: false,
  incomplete: false,
  twoHanded: false,
  timeScale: 1,
};

/** Nominal stroke duration from start of preparation to recovered (ms). */
export const STROKE_DURATION_MS = 1800;
/** Stroke-local time of the contact keyframe (ms, before timeScale). */
export const CONTACT_TIME_MS = 880;

export interface StrokeSpec {
  startMs: number;
  params?: Partial<ForehandParams>;
}

export interface Dropout {
  landmarks: number[];
  fromMs: number;
  toMs: number;
}

export interface SessionSpec {
  durationMs: number;
  fps: number;
  strokes: StrokeSpec[];
  handedness?: Handedness;
  /** +1: the net is to the right of the image. */
  forwardSign?: ForwardSign;
  /** Landmark position noise, standard deviation in image units. */
  noise?: number;
  /** Probability that the dominant wrist is dropped in any frame. */
  wristDropoutProb?: number;
  dropouts?: Dropout[];
  /** Random timestamp jitter (ms) to mimic irregular inference rate. */
  timeJitterMs?: number;
  seed?: number;
  aspect?: number;
  /** Torso length in image units (camera distance / player size). */
  torso?: number;
  /** Horizontal position of the player in the image (0..aspect). */
  centerX?: number;
}

type Key = [number, number];

/** Cubic Hermite interpolation with Catmull-Rom tangents on non-uniform times. */
export function spline(keys: readonly Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys.length - 1;
  if (t >= keys[last][0]) return keys[last][1];
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i];
  const [t1, p1] = keys[i + 1];
  const tangent = (j: number) =>
    j <= 0 || j >= last ? 0 : (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0]);
  const h = t1 - t0;
  const s = (t - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0 +
    (s3 - 2 * s2 + s) * h * tangent(i) +
    (-2 * s3 + 3 * s2) * p1 +
    (s3 - s2) * h * tangent(i + 1)
  );
}

interface BodyPose {
  shoulderTurn: number;
  hipTurn: number;
  wrist: [number, number, number];
  hipShift: number;
  lean: number;
  headSway: number;
}

const GOOD_CONTACT = 0.6;
const READY_WRIST: [number, number, number] = [0.7, 0.3, 0.5];

function strokePose(tau: number, p: ForehandParams): BodyPose {
  const k = p.timeScale;
  const T = (ms: number) => ms * k;
  const S = p.shoulderTurnDeg;
  const H = p.hipTurnDeg;

  if (p.incomplete) {
    const wx: Key[] = [[0, 0.7], [T(300), -0.3], [T(600), -1.4], [T(1500), 0.7]];
    const wy: Key[] = [[0, 0.3], [T(300), 0.9], [T(600), 0.9], [T(1500), 0.3]];
    return {
      shoulderTurn: spline([[0, 10], [T(300), 0.85 * S], [T(600), S], [T(1500), 10]], tau),
      hipTurn: spline([[0, 5], [T(300), 0.8 * H], [T(600), H], [T(1500), 5]], tau),
      wrist: [spline(wx, tau), spline(wy, tau), 0.7],
      hipShift: 0,
      lean: 0,
      headSway: 0,
    };
  }

  const cf = p.contactForward;
  const ft = p.followThroughHeight;
  // Forward swing keyframes are spaced so that wrist speed peaks around the
  // contact keyframe, then the wrist continues forward, rises and wraps.
  // A late contact delays the loop as well (the arm lags behind the body),
  // so that wrist speed still peaks near the contact point.
  const lag = cf - GOOD_CONTACT;
  const wx: Key[] = [[0, 0.7], [T(300), -0.3], [T(600), -1.4], [T(740), -1.0 + lag], [T(880), cf], [T(1000), cf + 0.9], [T(1150), 0.4], [T(1350), 0.0], [T(1800), 0.7]];
  const wy: Key[] = [[0, 0.3], [T(300), 0.9], [T(600), 0.9], [T(740), 0.0], [T(880), 0.2], [T(1000), 0.7 + ft], [T(1150), 1.0 + ft], [T(1350), 1.0 + ft], [T(1800), 0.3]];
  const wz: Key[] = [[0, 0.5], [T(300), 0.9], [T(600), 0.9], [T(740), 1.0], [T(880), 1.1], [T(1000), 0.6], [T(1150), -0.3], [T(1350), -0.8], [T(1800), 0.5]];

  const shoulderKeys: Key[] = p.latePreparation
    ? [[0, 10], [T(300), 12], [T(500), 0.45 * S], [T(620), S], [T(760), 0.8 * S], [T(880), 20], [T(1000), -45], [T(1200), -60], [T(1800), 10]]
    : [[0, 10], [T(300), 0.85 * S], [T(600), S], [T(760), 0.8 * S], [T(880), 20], [T(1000), -45], [T(1200), -60], [T(1800), 10]];
  const hipKeys: Key[] = p.latePreparation
    ? [[0, 5], [T(300), 6], [T(500), 0.4 * H], [T(620), H], [T(760), 0.4 * H], [T(880), 0], [T(1000), -30], [T(1200), -45], [T(1800), 5]]
    : [[0, 5], [T(300), 0.8 * H], [T(600), H], [T(760), 0.4 * H], [T(880), 0], [T(1000), -30], [T(1200), -45], [T(1800), 5]];

  const W = p.weightShift;
  return {
    shoulderTurn: spline(shoulderKeys, tau),
    hipTurn: spline(hipKeys, tau),
    wrist: [spline(wx, tau), spline(wy, tau), spline(wz, tau)],
    hipShift: spline([[0, 0], [T(600), -0.5 * W], [T(880), 0.1 * W], [T(1200), 0.5 * W], [T(1800), 0]], tau),
    lean: spline([[0, 0], [T(600), 0], [T(880), p.leanDeg], [T(1200), p.leanDeg], [T(1800), 0]], tau),
    headSway: spline([[0, 0], [T(600), 0], [T(880), p.headSway], [T(1200), -p.headSway], [T(1800), 0]], tau),
  };
}

const IDLE_POSE = (tMs: number): BodyPose => ({
  shoulderTurn: 10 + 2 * Math.sin(tMs / 700),
  hipTurn: 5,
  wrist: [READY_WRIST[0] + 0.02 * Math.sin(tMs / 500), READY_WRIST[1], READY_WRIST[2]],
  hipShift: 0.02 * Math.sin(tMs / 900),
  lean: 0,
  headSway: 0,
});

type V3 = [number, number, number];

/** Builds all landmarks for one body pose (world T units, before projection). */
function bodyLandmarks(pose: BodyPose, p: ForehandParams, hand: Handedness): Map<number, V3> {
  const d = hand === 'right' ? 1 : -1; // dominant side is towards the camera for d=+1
  const rad = Math.PI / 180;
  const HIP_H = 2.0;
  const SW = 0.4; // half shoulder width
  const HW = 0.3; // half hip width
  const hip: V3 = [pose.hipShift, HIP_H, 0];
  const lean = pose.lean * rad;
  const sh: V3 = [hip[0] + Math.sin(lean), hip[1] + Math.cos(lean), 0];
  const st = pose.shoulderTurn * rad;
  const ht = pose.hipTurn * rad;
  // Turning the dominant shoulder back = moving it to -X.
  const domSh: V3 = [sh[0] - SW * Math.sin(st), sh[1], d * SW * Math.cos(st)];
  const offSh: V3 = [sh[0] + SW * Math.sin(st), sh[1], -d * SW * Math.cos(st)];
  const domHip: V3 = [hip[0] - HW * Math.sin(ht), hip[1], d * HW * Math.cos(ht)];
  const offHip: V3 = [hip[0] + HW * Math.sin(ht), hip[1], -d * HW * Math.cos(ht)];

  const wrist: V3 = [hip[0] + pose.wrist[0], hip[1] + pose.wrist[1], d * pose.wrist[2]];
  const elbow = elbowBetween(domSh, wrist, p.elbowBend);

  const offWrist: V3 = p.twoHanded
    ? [wrist[0] + 0.08, wrist[1] + 0.05, wrist[2]]
    : [offSh[0] + 0.5, offSh[1] - 0.6, offSh[2]];
  const offElbow = elbowBetween(offSh, offWrist, 0.2);

  // Feet stay planted; the front foot is the non-dominant one (neutral stance).
  const half = p.stanceWidth / 2;
  const frontAnkle: V3 = [half, 0, -d * 0.2];
  const backAnkle: V3 = [-half, 0, d * 0.2];
  const knee = (hipP: V3, ank: V3): V3 => [(hipP[0] + ank[0]) / 2 + 0.1, (hipP[1] + ank[1]) / 2, (hipP[2] + ank[2]) / 2];
  const nose: V3 = [sh[0] + 0.15 + pose.headSway, sh[1] + 0.45, 0];
  const ear = (side: number): V3 => [sh[0] - 0.05 + pose.headSway, sh[1] + 0.48, side * 0.15];

  const R = hand === 'right';
  const m = new Map<number, V3>();
  m.set(LM.NOSE, nose);
  m.set(LM.LEFT_EAR, ear(-d));
  m.set(LM.RIGHT_EAR, ear(d));
  m.set(R ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER, domSh);
  m.set(R ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER, offSh);
  m.set(R ? LM.RIGHT_ELBOW : LM.LEFT_ELBOW, elbow);
  m.set(R ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW, offElbow);
  m.set(R ? LM.RIGHT_WRIST : LM.LEFT_WRIST, wrist);
  m.set(R ? LM.LEFT_WRIST : LM.RIGHT_WRIST, offWrist);
  m.set(R ? LM.RIGHT_HIP : LM.LEFT_HIP, domHip);
  m.set(R ? LM.LEFT_HIP : LM.RIGHT_HIP, offHip);
  m.set(R ? LM.RIGHT_ANKLE : LM.LEFT_ANKLE, backAnkle);
  m.set(R ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE, frontAnkle);
  m.set(R ? LM.RIGHT_KNEE : LM.LEFT_KNEE, knee(domHip, backAnkle));
  m.set(R ? LM.LEFT_KNEE : LM.RIGHT_KNEE, knee(offHip, frontAnkle));
  return m;
}

/** Elbow placed off the shoulder-wrist midpoint, bent downwards in the image plane. */
function elbowBetween(sh: V3, wr: V3, bend: number): V3 {
  const mx = (sh[0] + wr[0]) / 2;
  const my = (sh[1] + wr[1]) / 2;
  const dx = wr[0] - sh[0];
  const dy = wr[1] - sh[1];
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular in the X-Y plane, chosen to point downwards (-Y).
  let px = -dy / len;
  let py = dx / len;
  if (py > 0) {
    px = -px;
    py = -py;
  }
  return [mx + px * bend, my + py * bend, (sh[2] + wr[2]) / 2];
}

/** Generates a full session of pose frames. */
export function generateSession(spec: SessionSpec): PoseFrame[] {
  const hand = spec.handedness ?? 'right';
  const fsgn = spec.forwardSign ?? 1;
  const aspect = spec.aspect ?? 16 / 9;
  const rand = mulberry32(spec.seed ?? 1);
  const noise = spec.noise ?? 0;
  const TORSO = spec.torso ?? 0.22; // torso length in image units
  const groundY = 0.5 + TORSO * 1.95;
  const baseX = spec.centerX ?? aspect / 2;
  const strokes = [...spec.strokes].sort((a, b) => a.startMs - b.startMs);
  const frames: PoseFrame[] = [];
  const dtMs = 1000 / spec.fps;

  for (let i = 0, t = 0; t <= spec.durationMs; i++, t = i * dtMs) {
    const ts = t + (spec.timeJitterMs ? (rand() - 0.5) * 2 * spec.timeJitterMs : 0);
    // Latest stroke that has started and not finished defines the pose.
    let pose = IDLE_POSE(ts);
    let params: ForehandParams = GOOD_FOREHAND;
    for (const s of strokes) {
      const prm = { ...GOOD_FOREHAND, ...s.params };
      if (ts >= s.startMs && ts < s.startMs + STROKE_DURATION_MS * prm.timeScale) {
        pose = strokePose(ts - s.startMs, prm);
        params = prm;
      }
    }
    const world = bodyLandmarks(pose, params, hand);
    const landmarks: Landmark[] = [];
    const hip = world.get(LM.LEFT_HIP)!;
    for (let j = 0; j < NUM_LANDMARKS; j++) {
      const w = world.get(j) ?? hip;
      const known = world.has(j);
      landmarks.push({
        x: baseX + fsgn * w[0] * TORSO + noise * gaussian(rand),
        y: groundY - w[1] * TORSO + noise * gaussian(rand),
        z: -w[2] * TORSO,
        visibility: known ? 0.97 : 0.3,
      });
    }
    for (const d of spec.dropouts ?? []) {
      if (ts >= d.fromMs && ts <= d.toMs) for (const j of d.landmarks) landmarks[j].visibility = 0.05;
    }
    if (spec.wristDropoutProb && rand() < spec.wristDropoutProb) {
      landmarks[hand === 'right' ? LM.RIGHT_WRIST : LM.LEFT_WRIST].visibility = 0.05;
    }
    frames.push({ timestampMs: Math.max(ts, frames.length ? frames[frames.length - 1].timestampMs + 1 : 0), landmarks, aspect });
  }
  return frames;
}

/** Stream time (ms) of a stroke's contact keyframe. */
export function contactTime(stroke: StrokeSpec): number {
  return stroke.startMs + CONTACT_TIME_MS * (stroke.params?.timeScale ?? 1);
}

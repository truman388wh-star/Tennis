// Turns raw pose frames into smoothed, body-normalized per-frame features.
//
// Normalization: positions are expressed relative to the hip center and
// divided by the torso length ("body scale"), so thresholds work regardless of
// camera distance or player size. Smoothing uses One Euro filters per
// landmark coordinate. Low-visibility landmarks are treated as missing and all
// dependent features become null instead of being guessed.

import type { FeatureConfig } from '../config/config';
import type { BodyFeatures, Handedness, Landmark, PoseFrame, Vec2 } from '../types';
import { angleAt, angleBetween, distance, foreshorteningAngle, midpoint, sub, tiltFromVertical, clamp } from '../utils/geometry';
import { OneEuroFilter } from '../utils/oneEuro';
import { KEY_LANDMARKS, LM, dominantArm, offArm } from '../pose/landmarks';

export interface FeatureExtractorLike {
  process(frame: PoseFrame): BodyFeatures;
  reset(): void;
}

interface WristSample {
  t: number;
  p: Vec2;
}

export class FeatureExtractor implements FeatureExtractorLike {
  private readonly filters = new Map<number, [OneEuroFilter, OneEuroFilter]>();
  private readonly lastSeen = new Map<number, number>();
  private bodyScale: number | null = null;
  private shoulderRef: number;
  private hipRef: number;
  private wristHistory: WristSample[] = [];
  private lastVel: { t: number; v: Vec2 } | null = null;

  constructor(
    private readonly cfg: FeatureConfig,
    private readonly handedness: Handedness,
  ) {
    this.shoulderRef = cfg.shoulderWidthPrior;
    this.hipRef = cfg.hipWidthPrior;
  }

  reset(): void {
    this.filters.clear();
    this.lastSeen.clear();
    this.bodyScale = null;
    this.shoulderRef = this.cfg.shoulderWidthPrior;
    this.hipRef = this.cfg.hipWidthPrior;
    this.wristHistory = [];
    this.lastVel = null;
  }

  process(frame: PoseFrame): BodyFeatures {
    const t = frame.timestampMs;
    const pts = this.smoothLandmarks(frame.landmarks, t);
    const get = (i: number): Vec2 | null => pts.get(i) ?? null;

    const lSh = get(LM.LEFT_SHOULDER);
    const rSh = get(LM.RIGHT_SHOULDER);
    const lHip = get(LM.LEFT_HIP);
    const rHip = get(LM.RIGHT_HIP);
    const shoulderCenter = lSh && rSh ? midpoint(lSh, rSh) : null;
    const hipCenter = lHip && rHip ? midpoint(lHip, rHip) : null;

    const visibility = meanVisibility(frame.landmarks);
    const empty = (): BodyFeatures => ({
      t,
      valid: false,
      bodyScale: this.bodyScale ?? 0,
      hipCenter,
      shoulderCenter,
      wrist: null,
      wristVel: null,
      wristSpeed: null,
      wristAccel: null,
      offWrist: null,
      elbowAngle: null,
      shoulderAngle: null,
      shoulderTurn: null,
      hipTurn: null,
      trunkLean: null,
      stanceWidth: null,
      ankleCenter: null,
      head: get(LM.NOSE),
      facing: null,
      visibility,
    });

    if (!shoulderCenter || !hipCenter) {
      this.maybeDropVelocityHistory(t);
      return empty();
    }

    // Body scale: torso length, EMA-smoothed because it is the denominator of
    // almost every feature and must not jitter.
    const torso = distance(shoulderCenter, hipCenter);
    if (torso < 1e-4) return empty();
    this.bodyScale =
      this.bodyScale === null ? torso : this.bodyScale + this.cfg.bodyScaleAlpha * (torso - this.bodyScale);
    const s = this.bodyScale;
    const rel = (p: Vec2): Vec2 => ({ x: (p.x - hipCenter.x) / s, y: (p.y - hipCenter.y) / s });

    const dom = dominantArm(this.handedness);
    const off = offArm(this.handedness);
    const dShoulder = get(dom.shoulder);
    const dElbow = get(dom.elbow);
    const dWristAbs = get(dom.wrist);
    const oWristAbs = get(off.wrist);
    const wrist = dWristAbs ? rel(dWristAbs) : null;

    // Rotation from foreshortening of the shoulder / hip lines (see geometry.ts).
    // The full-width reference is learned as the largest width observed,
    // bounded by anatomical priors so a single outlier cannot corrupt it.
    const shoulderW = lSh && rSh ? Math.abs(lSh.x - rSh.x) / s : null;
    const hipW = lHip && rHip ? Math.abs(lHip.x - rHip.x) / s : null;
    if (shoulderW !== null)
      this.shoulderRef = clamp(Math.max(this.shoulderRef, shoulderW), this.cfg.shoulderWidthMin, this.cfg.shoulderWidthMax);
    if (hipW !== null) this.hipRef = clamp(Math.max(this.hipRef, hipW), this.cfg.hipWidthMin, this.cfg.hipWidthMax);

    const nose = get(LM.NOSE);
    const lEar = get(LM.LEFT_EAR);
    const rEar = get(LM.RIGHT_EAR);
    const earMid = lEar && rEar ? midpoint(lEar, rEar) : (lEar ?? rEar);
    const facing = nose && earMid ? (nose.x - earMid.x) / s : null;

    const lAnk = get(LM.LEFT_ANKLE);
    const rAnk = get(LM.RIGHT_ANKLE);

    const { vel, speed, accel } = this.updateVelocity(t, wrist);

    return {
      t,
      valid: true,
      bodyScale: s,
      hipCenter,
      shoulderCenter,
      wrist,
      wristVel: vel,
      wristSpeed: speed,
      wristAccel: accel,
      offWrist: oWristAbs ? rel(oWristAbs) : null,
      elbowAngle: dShoulder && dElbow && dWristAbs ? angleAt(dShoulder, dElbow, dWristAbs) : null,
      shoulderAngle:
        dShoulder && dElbow ? angleBetween(sub(hipCenter, shoulderCenter), sub(dElbow, dShoulder)) : null,
      shoulderTurn: shoulderW === null ? null : foreshorteningAngle(shoulderW, this.shoulderRef),
      hipTurn: hipW === null ? null : foreshorteningAngle(hipW, this.hipRef),
      trunkLean: tiltFromVertical(sub(shoulderCenter, hipCenter)),
      stanceWidth: lAnk && rAnk ? distance(lAnk, rAnk) / s : null,
      ankleCenter: lAnk && rAnk ? midpoint(lAnk, rAnk) : null,
      head: nose,
      facing,
      visibility,
    };
  }

  private smoothLandmarks(landmarks: Landmark[], t: number): Map<number, Vec2> {
    const out = new Map<number, Vec2>();
    for (const i of KEY_LANDMARKS) {
      const lm = landmarks[i];
      if (!lm || !(lm.visibility >= this.cfg.minVisibility) || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
        continue;
      }
      let pair = this.filters.get(i);
      const last = this.lastSeen.get(i);
      if (!pair) {
        const p = { minCutoff: this.cfg.smoothingMinCutoff, beta: this.cfg.smoothingBeta, dCutoff: this.cfg.smoothingDCutoff };
        pair = [new OneEuroFilter(p), new OneEuroFilter(p)];
        this.filters.set(i, pair);
      } else if (last !== undefined && t - last > this.cfg.maxGapMs) {
        // After a long gap the old state is meaningless: restart the filter.
        pair[0].reset();
        pair[1].reset();
      }
      this.lastSeen.set(i, t);
      out.set(i, { x: pair[0].filter(lm.x, t), y: pair[1].filter(lm.y, t) });
    }
    return out;
  }

  /**
   * Velocity is a backward finite difference over `velocityWindowFrames`
   * frames of the smoothed, body-relative wrist position. Using body-relative
   * coordinates removes whole-body translation (e.g. stepping in).
   */
  private updateVelocity(t: number, wrist: Vec2 | null): { vel: Vec2 | null; speed: number | null; accel: number | null } {
    if (!wrist) {
      this.maybeDropVelocityHistory(t);
      return { vel: null, speed: null, accel: null };
    }
    const hist = this.wristHistory;
    if (hist.length && t - hist[hist.length - 1].t > this.cfg.maxGapMs) {
      hist.length = 0;
      this.lastVel = null;
    }
    hist.push({ t, p: wrist });
    const k = Math.max(1, this.cfg.velocityWindowFrames);
    while (hist.length > k + 1) hist.shift();
    if (hist.length < 2) return { vel: null, speed: null, accel: null };

    const first = hist[0];
    const dt = (t - first.t) / 1000;
    if (dt <= 0) return { vel: null, speed: null, accel: null };
    const vel = { x: (wrist.x - first.p.x) / dt, y: (wrist.y - first.p.y) / dt };
    const speed = Math.hypot(vel.x, vel.y);

    let accel: number | null = null;
    if (this.lastVel && t > this.lastVel.t) {
      const adt = (t - this.lastVel.t) / 1000;
      accel = Math.hypot(vel.x - this.lastVel.v.x, vel.y - this.lastVel.v.y) / adt;
    }
    this.lastVel = { t, v: vel };
    return { vel, speed, accel };
  }

  private maybeDropVelocityHistory(t: number): void {
    const hist = this.wristHistory;
    if (hist.length && t - hist[hist.length - 1].t > this.cfg.maxGapMs) {
      hist.length = 0;
      this.lastVel = null;
    }
  }
}

function meanVisibility(landmarks: Landmark[]): number {
  let sum = 0;
  let n = 0;
  for (const i of KEY_LANDMARKS) {
    const lm = landmarks[i];
    sum += lm ? clamp(lm.visibility, 0, 1) : 0;
    n++;
  }
  return n ? sum / n : 0;
}

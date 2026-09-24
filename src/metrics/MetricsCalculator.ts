// Computes interpretable, body-normalized technique metrics for one stroke.
//
// All distances are in torso lengths (T), angles in degrees, times in ms.
// "Forward" means towards the net (event.forwardSign). Every metric is a
// heuristic proxy measured from 2D pose; each returns null when the needed
// landmarks were not visible rather than guessing.
//
// Rotation metrics rely on the foreshortening model in utils/geometry.ts and
// assume the camera looks roughly along the baseline (side view).

import type { MetricsConfig } from '../config/config';
import type { BodyFeatures, StrokeEvent, StrokeMetrics, StrokePhases, Vec2 } from '../types';
import { METRIC_IDS } from '../types';
import { compact, median } from '../utils/stats';

export interface StrokeMetricsCalculator {
  compute(frames: readonly BodyFeatures[], phases: StrokePhases, event: StrokeEvent): StrokeMetrics;
}

export function emptyMetrics(): StrokeMetrics {
  return Object.fromEntries(METRIC_IDS.map((id) => [id, null])) as StrokeMetrics;
}

export class HeuristicMetricsCalculator implements StrokeMetricsCalculator {
  constructor(private readonly cfg: MetricsConfig) {}

  compute(frames: readonly BodyFeatures[], phases: StrokePhases, event: StrokeEvent): StrokeMetrics {
    const m = emptyMetrics();
    const fs = event.forwardSign;
    const c = phases.contactIndex;
    const b1 = phases.backswingEndIndex;
    const b0 = phases.backswing.startIndex;
    const p0 = phases.preparation.startIndex;
    const ftEnd = phases.followThrough.endIndex;
    const at = (i: number) => frames[i];
    const tAt = (i: number) => frames[i].t;
    const scale = median(compact(frames.map((f) => (f.valid ? f.bodyScale : null)))) ?? null;

    // --- Preparation & rotation -------------------------------------------
    // Shoulder / hip turn at the loaded position (between preparation start
    // and the end of the backswing).
    const maxShoulder = maxOver(frames, (f) => f.shoulderTurn, p0, b1);
    const maxHip = maxOver(frames, (f) => f.hipTurn, p0, b1);
    m.shoulderTurnDeg = maxShoulder?.value ?? null;
    m.hipTurnDeg = maxHip?.value ?? null;

    // X-factor style shoulder-hip separation during the backswing.
    m.separationDeg = maxOver(
      frames,
      (f) => (f.shoulderTurn !== null && f.hipTurn !== null ? f.shoulderTurn - f.hipTurn : null),
      b0,
      b1,
    )?.value ?? null;

    const shoulderAtContact = at(c).shoulderTurn;
    m.shoulderTurnAtContactDeg = shoulderAtContact;
    if (maxShoulder && shoulderAtContact !== null) m.shoulderUnwindDeg = maxShoulder.value - shoulderAtContact;

    // Unit-turn lead: how long before the forward swing the shoulders had
    // reached most of their turn. Early preparation = large positive value.
    if (maxShoulder) {
      const target = maxShoulder.value * this.cfg.unitTurnFraction;
      for (let i = p0; i <= b1; i++) {
        const s = at(i).shoulderTurn;
        if (s !== null && s >= target) {
          m.unitTurnLeadMs = tAt(b1) - tAt(i);
          break;
        }
      }
    }
    m.backswingDurationMs = tAt(b1) - tAt(b0);

    // --- Timing ---------------------------------------------------------------
    m.forwardSwingMs = tAt(c) - tAt(b1);
    m.peakWristSpeed = at(c).wristSpeed ?? event.peakSpeed;
    // Pause around the backswing->forward transition: a hitch here usually
    // means the swing started late and was rushed (or the loop was broken).
    m.transitionPauseMs = pauseDuration(frames, b0, c, b1, this.cfg.pauseSpeed);

    // --- Contact (estimated) --------------------------------------------------
    const wc = at(c).wrist;
    if (wc) {
      m.contactForwardRatio = wc.x * fs;
      m.contactHeightRatio = -wc.y; // body-relative y is down; positive = above hips
    }
    m.elbowAngleAtContactDeg = at(c).elbowAngle;

    // --- Balance ------------------------------------------------------------
    const lean = at(c).trunkLean;
    if (lean !== null) m.trunkLeanDeg = lean * fs; // positive = leaning into the shot
    m.stanceWidthRatio = at(c).stanceWidth ?? nearest(frames, c, (f) => f.stanceWidth);
    // Head movement relative to the hips from the loaded position through the
    // follow-through. Relative to the hips so that stepping into the ball
    // (good weight transfer) is not mistaken for an unstable head.
    if (scale) {
      const heads = compact(
        frames.slice(b1, ftEnd + 1).map((f) => (f.head && f.hipCenter ? { x: f.head.x - f.hipCenter.x, y: f.head.y - f.hipCenter.y } : null)),
      );
      if (heads.length >= 2) m.headDriftRatio = extent(heads) / scale;
    }

    // --- Weight transfer ------------------------------------------------------
    // Forward travel of the hip center from the loaded position to the end of
    // the follow-through, a proxy for moving the weight into the ball.
    const hipLoaded = at(b1).hipCenter;
    const hipFinish = at(ftEnd).hipCenter;
    if (scale && hipLoaded && hipFinish) m.weightTransferRatio = ((hipFinish.x - hipLoaded.x) * fs) / scale;

    // --- Follow-through -------------------------------------------------------
    // Height: highest wrist point after contact relative to the shoulder line.
    // Travel: wrist path length after contact.
    let best: number | null = null;
    let travel = 0;
    let prev: Vec2 | null = null;
    for (let i = c; i <= ftEnd; i++) {
      const f = at(i);
      if (f.wrist && f.shoulderCenter && f.hipCenter && f.bodyScale > 0) {
        const shoulderRelY = (f.shoulderCenter.y - f.hipCenter.y) / f.bodyScale;
        const h = shoulderRelY - f.wrist.y; // positive = above the shoulders
        best = best === null ? h : Math.max(best, h);
      }
      if (f.wrist) {
        if (prev) travel += Math.hypot(f.wrist.x - prev.x, f.wrist.y - prev.y);
        prev = f.wrist;
      }
    }
    m.followThroughHeightRatio = best;
    m.followThroughTravelRatio = prev ? travel : null;

    return m;
  }
}

function maxOver(
  frames: readonly BodyFeatures[],
  f: (x: BodyFeatures) => number | null,
  from: number,
  to: number,
): { index: number; value: number } | null {
  let best: { index: number; value: number } | null = null;
  for (let i = Math.max(0, from); i <= Math.min(to, frames.length - 1); i++) {
    const v = f(frames[i]);
    if (v !== null && (best === null || v > best.value)) best = { index: i, value: v };
  }
  return best;
}

function nearest(frames: readonly BodyFeatures[], i: number, f: (x: BodyFeatures) => number | null): number | null {
  for (let d = 1; d < frames.length; d++) {
    for (const j of [i - d, i + d]) {
      if (j >= 0 && j < frames.length) {
        const v = f(frames[j]);
        if (v !== null) return v;
      }
    }
  }
  return null;
}

/** Largest axis extent (max of x-range and y-range) of a point set. */
function extent(points: readonly Vec2[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Length of the contiguous low-speed run containing `pivot` within [from, to]. */
function pauseDuration(frames: readonly BodyFeatures[], from: number, to: number, pivot: number, pauseSpeed: number): number {
  const slow = (i: number) => {
    const s = frames[i].wristSpeed;
    return s !== null && s < pauseSpeed;
  };
  if (!slow(pivot)) return 0;
  let a = pivot;
  let b = pivot;
  while (a > from && slow(a - 1)) a--;
  while (b < to && slow(b + 1)) b++;
  return frames[b].t - frames[a].t;
}

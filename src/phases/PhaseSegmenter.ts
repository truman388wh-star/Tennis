// Splits a detected stroke's feature window into technical phases.
//
// "Forward position" u(t) is the dominant wrist's body-relative x multiplied
// by the forward sign, i.e. how far in front of the hips the wrist is (T).
//
//   contact        ≈ frame of peak *forward* wrist speed near the detector
//                    peak. There is no ball detection in the MVP, so this is
//                    an ESTIMATED contact region, not measured impact.
//   backswing end  = rearmost wrist position (min u) before contact.
//   backswing start= last frame before that where the wrist was not yet
//                    moving back faster than `backswingStartSpeed`.
//   preparation    = from the lowest shoulder turn (still facing the net)
//                    before the backswing start, up to the backswing start.
//   forward swing  = backswing end -> contact region start.
//   follow-through = contact region end -> wrist slows below
//                    `followThroughEndSpeed` (or window end).

import type { SegmentationConfig } from '../config/config';
import type { BodyFeatures, ForwardSign, PhaseInterval, StrokeEvent, StrokePhases } from '../types';
import { argMax, argMin } from '../utils/stats';

export interface StrokePhaseSegmenter {
  segment(frames: readonly BodyFeatures[], event: StrokeEvent): StrokePhases | null;
}

export class HeuristicPhaseSegmenter implements StrokePhaseSegmenter {
  constructor(private readonly cfg: SegmentationConfig) {}

  segment(frames: readonly BodyFeatures[], event: StrokeEvent): StrokePhases | null {
    const n = frames.length;
    if (n < 5) return null;
    const fs: ForwardSign = event.forwardSign;
    const u = (f: BodyFeatures): number | null => (f.wrist ? f.wrist.x * fs : null);
    const vf = (f: BodyFeatures): number | null => (f.wristVel ? f.wristVel.x * fs : null);

    // 1. Contact: peak forward wrist speed around the detector's peak.
    const from = indexAtOrAfter(frames, event.peakT - this.cfg.contactSearchBeforeMs);
    const to = indexAtOrBefore(frames, event.peakT + this.cfg.contactSearchAfterMs);
    let c = argMax(frames, vf, from, to);
    if (c < 0) c = argMax(frames, (f) => f.wristSpeed, from, to);
    if (c < 1) return null;

    // 2. Backswing end: rearmost wrist position before contact.
    let b1 = argMin(frames, u, 0, c - 1);
    if (b1 < 0) b1 = Math.max(0, c - 1);

    // 3. Backswing start: walk back while the wrist was moving backwards.
    let b0 = b1;
    while (b0 > 0) {
      const v = vf(frames[b0 - 1]);
      if (v === null || v > -this.cfg.backswingStartSpeed) break;
      b0--;
    }
    // Include the frame where backward motion began.
    b0 = Math.max(0, b0 - 1);

    // 4. Preparation start: least-turned shoulders before the backswing start.
    let p0 = argMin(frames, (f) => f.shoulderTurn, 0, b0);
    if (p0 < 0) p0 = 0;

    // 5. Contact region: +/- half window around the contact frame.
    const tc = frames[c].t;
    const c0 = Math.max(b1, indexAtOrAfter(frames, tc - this.cfg.contactHalfWindowMs));
    const c1 = Math.max(c, indexAtOrBefore(frames, tc + this.cfg.contactHalfWindowMs));

    // 6. Follow-through end: wrist has slowed down after contact.
    let e = n - 1;
    for (let i = c1 + 1; i < n; i++) {
      const s = frames[i].wristSpeed;
      if (s !== null && s < this.cfg.followThroughEndSpeed) {
        e = i;
        break;
      }
    }

    return {
      preparation: interval(frames, p0, b0),
      backswing: interval(frames, b0, b1),
      forwardSwing: interval(frames, b1, Math.max(b1, c0)),
      contact: interval(frames, c0, c1),
      followThrough: interval(frames, c1, Math.max(c1, e)),
      contactIndex: c,
      backswingEndIndex: b1,
    };
  }
}

function interval(frames: readonly BodyFeatures[], i0: number, i1: number): PhaseInterval {
  return { startIndex: i0, endIndex: i1, startT: frames[i0].t, endT: frames[i1].t };
}

function indexAtOrAfter(frames: readonly BodyFeatures[], t: number): number {
  for (let i = 0; i < frames.length; i++) if (frames[i].t >= t) return i;
  return frames.length - 1;
}

function indexAtOrBefore(frames: readonly BodyFeatures[], t: number): number {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].t <= t) return i;
  return 0;
}

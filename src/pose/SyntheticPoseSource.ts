// Demo pose source: replays a generated practice session in real time so the
// complete app (detection, scoring, coaching, speech, UI) can be tried without
// a camera or a player. Clearly labelled as a demo in the UI.

import type { Handedness, PoseFrame } from '../types';
import { generateSession, type StrokeSpec } from '../synthetic/forehandGenerator';

const DEMO_PERIOD_MS = 3200;
const DEMO_STROKES: StrokeSpec['params'][] = [
  { contactForward: -0.3 },
  { contactForward: -0.25 },
  {},
  { shoulderTurnDeg: 35, hipTurnDeg: 15 },
  {},
  { weightShift: -0.1 },
  { followThroughHeight: -1.3 },
  {},
  { latePreparation: true },
  {},
];

export class SyntheticPoseSource {
  private readonly frames: PoseFrame[];
  private readonly loopMs: number;

  constructor(handedness: Handedness, fps = 30) {
    const strokes = DEMO_STROKES.map((params, i) => ({ startMs: 600 + i * DEMO_PERIOD_MS, params }));
    this.loopMs = 600 + DEMO_STROKES.length * DEMO_PERIOD_MS;
    this.frames = generateSession({ durationMs: this.loopMs, fps, strokes, handedness, noise: 0.0015, seed: 7 });
  }

  /** Pose at stream time t (ms since demo start); loops forever. */
  frameAt(t: number): PoseFrame {
    const loop = Math.floor(t / this.loopMs);
    const local = t - loop * this.loopMs;
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].timestampMs <= local) lo = mid;
      else hi = mid - 1;
    }
    const f = this.frames[lo];
    return { ...f, timestampMs: loop * this.loopMs + f.timestampMs };
  }
}

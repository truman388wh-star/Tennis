// End-to-end pipeline scenarios on synthetic pose sequences (no camera).
import { describe, expect, it } from 'vitest';
import { LM } from '../src/pose/landmarks';
import { contactTime, generateSession, type StrokeSpec } from '../src/synthetic/forehandGenerator';
import { runFrames } from './helpers';

const strokesEvery = (n: number, periodMs: number, first = 500, params = {}): StrokeSpec[] =>
  Array.from({ length: n }, (_, i) => ({ startMs: first + i * periodMs, params }));

describe('stroke detection scenarios', () => {
  it('no stroke: idle player produces no events', () => {
    const frames = generateSession({ durationMs: 15_000, fps: 30, strokes: [], noise: 0.002 });
    const r = runFrames(frames);
    expect(r.analyses).toHaveLength(0);
  });

  it('one valid forehand is detected once, with contact near the true contact', () => {
    const stroke = { startMs: 500 };
    const r = runFrames(generateSession({ durationMs: 4000, fps: 30, strokes: [stroke] }));
    expect(r.analyses).toHaveLength(1);
    const a = r.analyses[0];
    const contactT = a.phases.contact.startT + (a.phases.contact.endT - a.phases.contact.startT) / 2;
    expect(Math.abs(contactT - contactTime(stroke))).toBeLessThan(80);
    // Feedback is ready soon after contact (confirm delay + one frame or so).
    expect(a.feedbackDelayMs).toBeLessThan(600);
  });

  it('multiple forehands are each detected exactly once', () => {
    const strokes = strokesEvery(8, 3000);
    const r = runFrames(generateSession({ durationMs: 25_000, fps: 30, strokes, noise: 0.002, seed: 4 }));
    expect(r.analyses).toHaveLength(8);
    r.analyses.forEach((a, i) => expect(Math.abs(a.event.peakT - contactTime(strokes[i]))).toBeLessThan(150));
  });

  it('incomplete stroke (backswing without forward swing) is ignored', () => {
    const r = runFrames(
      generateSession({ durationMs: 6000, fps: 30, strokes: [{ startMs: 500, params: { incomplete: true } }, { startMs: 3000 }] }),
    );
    expect(r.analyses).toHaveLength(1);
    expect(r.analyses[0].event.peakT).toBeGreaterThan(3000);
  });

  it('noisy pose: strokes still detected, no duplicates', () => {
    const strokes = strokesEvery(5, 3000);
    const r = runFrames(generateSession({ durationMs: 16_000, fps: 30, strokes, noise: 0.006, seed: 11 }));
    expect(r.analyses).toHaveLength(5);
  });

  it('missing landmarks: random wrist dropouts and a full occlusion are tolerated', () => {
    const strokes = strokesEvery(4, 3000);
    const frames = generateSession({
      durationMs: 13_000,
      fps: 30,
      strokes,
      noise: 0.002,
      wristDropoutProb: 0.08,
      // The whole body disappears between strokes 2 and 3.
      dropouts: [{ landmarks: Array.from({ length: 33 }, (_, i) => i), fromMs: 5000, toMs: 6200 }],
      seed: 5,
    });
    const r = runFrames(frames);
    expect(r.analyses.length).toBeGreaterThanOrEqual(3);
    expect(r.analyses.length).toBeLessThanOrEqual(4);
  });

  it('occluded dominant wrist during the swing yields no stroke rather than a wrong one', () => {
    const stroke = { startMs: 500 };
    const c = contactTime(stroke);
    const frames = generateSession({
      durationMs: 3500,
      fps: 30,
      strokes: [stroke],
      dropouts: [{ landmarks: [LM.RIGHT_WRIST, LM.RIGHT_ELBOW], fromMs: c - 400, toMs: c + 600 }],
    });
    expect(runFrames(frames).analyses).toHaveLength(0);
  });

  it('rapid consecutive strokes (ball machine every 1.5 s) are separated', () => {
    const strokes = strokesEvery(6, 1500);
    const r = runFrames(generateSession({ durationMs: 10_500, fps: 30, strokes, noise: 0.002 }));
    expect(r.analyses).toHaveLength(6);
    for (let i = 1; i < r.analyses.length; i++) {
      expect(r.analyses[i].event.windowStartT).toBeGreaterThanOrEqual(r.analyses[i - 1].event.endT);
    }
  });

  it('works for left-handed players with the net on the left', () => {
    const strokes = strokesEvery(3, 3000);
    const frames = generateSession({ durationMs: 10_000, fps: 30, strokes, handedness: 'left', forwardSign: -1 });
    const r = runFrames(frames, { handedness: 'left' });
    expect(r.analyses).toHaveLength(3);
    expect(r.analyses.every((a) => a.event.forwardSign === -1)).toBe(true);
    expect(r.analyses[0].score.overall).toBeGreaterThan(85);
  });

  it('works at a low, irregular inference rate (slow phone)', () => {
    const strokes = strokesEvery(4, 3000);
    const frames = generateSession({ durationMs: 13_000, fps: 15, strokes, timeJitterMs: 12, noise: 0.002, seed: 9 });
    const r = runFrames(frames);
    expect(r.analyses).toHaveLength(4);
  });

  it('works with the player small and off-center in the frame', () => {
    const strokes = strokesEvery(3, 3000);
    const frames = generateSession({ durationMs: 10_000, fps: 30, strokes, torso: 0.11, centerX: 0.5, noise: 0.001 });
    const r = runFrames(frames);
    expect(r.analyses).toHaveLength(3);
    expect(r.analyses[0].score.overall).toBeGreaterThan(85);
  });

  it('ignores two-handed swings', () => {
    const r = runFrames(generateSession({ durationMs: 4000, fps: 30, strokes: [{ startMs: 500, params: { twoHanded: true } }] }));
    expect(r.analyses).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toContain('two-handed');
  });

  it('memory stays bounded over a long session', () => {
    const strokes = strokesEvery(40, 1500);
    const r = runFrames(generateSession({ durationMs: 61_000, fps: 30, strokes }));
    expect(r.analyses).toHaveLength(40);
    expect(r.session.stages.coach.memory.count).toBeLessThanOrEqual(10);
  });
});

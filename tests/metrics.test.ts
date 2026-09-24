import { describe, expect, it } from 'vitest';
import { generateSession, type ForehandParams } from '../src/synthetic/forehandGenerator';
import type { StrokeAnalysis } from '../src/types';
import { runFrames } from './helpers';

function analyze(params: Partial<ForehandParams> = {}, extra = {}): StrokeAnalysis {
  const r = runFrames(generateSession({ durationMs: 4000, fps: 30, strokes: [{ startMs: 500, params }], noise: 0.001, ...extra }));
  expect(r.analyses).toHaveLength(1);
  return r.analyses[0];
}

describe('technical metrics', () => {
  const good = analyze();

  it('measures a good forehand inside the ideal ranges', () => {
    const m = good.metrics;
    expect(m.shoulderTurnDeg!).toBeGreaterThan(65);
    expect(m.hipTurnDeg!).toBeGreaterThan(35);
    expect(m.separationDeg!).toBeGreaterThan(10);
    expect(m.contactForwardRatio!).toBeGreaterThan(0.3);
    expect(m.weightTransferRatio!).toBeGreaterThan(0.2);
    expect(m.followThroughHeightRatio!).toBeGreaterThan(0);
    expect(m.elbowAngleAtContactDeg!).toBeGreaterThan(120);
    expect(m.unitTurnLeadMs!).toBeGreaterThan(150);
    expect(m.stanceWidthRatio!).toBeCloseTo(1.4, 0);
    expect(m.peakWristSpeed!).toBeGreaterThan(6);
  });

  it('late contact moves the contact point back', () => {
    expect(analyze({ contactForward: -0.3 }).metrics.contactForwardRatio!).toBeLessThan(good.metrics.contactForwardRatio! - 0.5);
  });

  it('small turn lowers shoulder and hip rotation', () => {
    const m = analyze({ shoulderTurnDeg: 30, hipTurnDeg: 10 }).metrics;
    expect(m.shoulderTurnDeg!).toBeLessThan(40);
    expect(m.hipTurnDeg!).toBeLessThan(20);
  });

  it('no weight shift lowers the weight-transfer proxy', () => {
    expect(analyze({ weightShift: -0.1 }).metrics.weightTransferRatio!).toBeLessThan(0.05);
  });

  it('short follow-through keeps the wrist below the shoulders', () => {
    expect(analyze({ followThroughHeight: -1.3 }).metrics.followThroughHeightRatio!).toBeLessThan(-0.5);
  });

  it('late preparation shortens the unit-turn lead', () => {
    expect(analyze({ latePreparation: true }).metrics.unitTurnLeadMs!).toBeLessThan(good.metrics.unitTurnLeadMs! - 100);
  });

  it('leaning back gives a negative trunk lean', () => {
    expect(analyze({ leanDeg: -25 }).metrics.trunkLeanDeg!).toBeLessThan(-15);
  });

  it('a cramped arm lowers the elbow angle at contact', () => {
    expect(analyze({ elbowBend: 0.6 }).metrics.elbowAngleAtContactDeg!).toBeLessThan(110);
  });

  it('metrics are the same when the camera is further away (scale invariance)', () => {
    const far = analyze({}, { torso: 0.12 });
    for (const id of ['shoulderTurnDeg', 'contactForwardRatio', 'weightTransferRatio', 'elbowAngleAtContactDeg'] as const) {
      expect(far.metrics[id]!).toBeCloseTo(good.metrics[id]!, 0);
    }
  });

  it('metrics mirror correctly when the net is on the left', () => {
    const mirrored = analyze({}, { forwardSign: -1 });
    expect(mirrored.event.forwardSign).toBe(-1);
    expect(mirrored.metrics.contactForwardRatio!).toBeCloseTo(good.metrics.contactForwardRatio!, 1);
    expect(mirrored.metrics.weightTransferRatio!).toBeCloseTo(good.metrics.weightTransferRatio!, 1);
    expect(mirrored.metrics.trunkLeanDeg!).toBeCloseTo(good.metrics.trunkLeanDeg!, 0);
  });
});

describe('end-to-end coaching on synthetic flaws', () => {
  const cases: [string, Partial<ForehandParams>, string][] = [
    ['late contact', { contactForward: -0.3 }, 'late-contact'],
    ['small shoulder turn', { shoulderTurnDeg: 30, hipTurnDeg: 10 }, 'small-shoulder-turn'],
    ['no weight transfer', { weightShift: -0.1 }, 'no-weight-transfer'],
    ['short follow-through', { followThroughHeight: -1.3 }, 'short-follow-through'],
    ['late preparation', { latePreparation: true }, 'late-preparation'],
    ['leaning back', { leanDeg: -25 }, 'leaning-back'],
    ['cramped arm', { elbowBend: 0.6 }, 'cramped-arm'],
  ];

  const goodStroke = analyze();

  it('a good forehand scores high and gets praise', () => {
    expect(goodStroke.score.overall).toBeGreaterThanOrEqual(90);
    expect(goodStroke.feedback.kind).toBe('praise');
    expect(goodStroke.issues.filter((i) => i.severity >= 0.3)).toEqual([]);
  });

  it.each(cases)('%s is identified as the primary issue', (_name, params, issueId) => {
    const a = analyze(params);
    expect(a.feedback.issueId).toBe(issueId);
    expect(a.feedback.speak).toBe(true);
    expect(a.score.overall).toBeLessThan(goodStroke.score.overall);
    expect(a.score.categories[a.issues[0].category]!).toBeLessThan(95);
  });
});

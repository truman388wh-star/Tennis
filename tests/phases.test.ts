import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config/config';
import { HeuristicPhaseSegmenter } from '../src/phases/PhaseSegmenter';
import { contactTime, generateSession } from '../src/synthetic/forehandGenerator';
import { runFrames } from './helpers';

describe('phase segmentation', () => {
  const stroke = { startMs: 500 };
  const [a] = runFrames(generateSession({ durationMs: 4000, fps: 30, strokes: [stroke], noise: 0.001 })).analyses;
  const p = a.phases;

  it('orders the phases in time without gaps', () => {
    const order = [p.preparation, p.backswing, p.forwardSwing, p.contact, p.followThrough];
    for (const ph of order) expect(ph.endT).toBeGreaterThanOrEqual(ph.startT);
    for (let i = 1; i < order.length; i++) expect(order[i].startT).toBe(order[i - 1].endT);
  });

  it('places the backswing end near the rearmost wrist position and contact near the true contact', () => {
    // Generator: backswing end keyframe at +600..740 ms, contact at +880 ms.
    expect(p.backswing.endT).toBeGreaterThan(stroke.startMs + 550);
    expect(p.backswing.endT).toBeLessThan(stroke.startMs + 800);
    expect(Math.abs(p.contactIndex >= 0 ? a.phases.contact.startT + 50 - contactTime(stroke) : 1e9)).toBeLessThan(80);
    expect(p.forwardSwing.endT - p.forwardSwing.startT).toBeGreaterThan(60);
    expect(p.forwardSwing.endT - p.forwardSwing.startT).toBeLessThan(350);
  });

  it('has a follow-through that ends after the wrist slows down', () => {
    expect(p.followThrough.endT - p.followThrough.startT).toBeGreaterThan(150);
  });

  it('returns null for windows that are too short', () => {
    const seg = new HeuristicPhaseSegmenter(createConfig().segmentation);
    expect(seg.segment([], a.event)).toBeNull();
  });
});

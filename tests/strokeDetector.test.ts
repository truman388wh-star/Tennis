import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config/config';
import { HeuristicStrokeDetector } from '../src/stroke/StrokeDetector';
import { ForwardDirectionEstimator } from '../src/stroke/ForwardDirection';
import type { BodyFeatures, StrokeEvent } from '../src/types';
import { feat, speedProfile } from './helpers';

const cfg = createConfig().detection;

function run(det: HeuristicStrokeDetector, frames: BodyFeatures[]) {
  const states: string[] = [];
  const events: StrokeEvent[] = [];
  const rejected: string[] = [];
  for (const f of frames) {
    const u = det.update(f);
    if (states[states.length - 1] !== u.state) states.push(u.state);
    if (u.event) events.push(u.event);
    if (u.rejected) rejected.push(u.rejected);
  }
  return { states, events, rejected };
}

// A forehand-like speed profile: slow take-back, fast forward swing, slow down.
const SWING = [0, 0, 1.5, 2, 2.5, 2, 1.5, 3, 6, 10, 12, 9, 5, 3, 2, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const REST = (n: number) => Array(n).fill(0.2);

describe('HeuristicStrokeDetector', () => {
  it('walks through the state machine and emits one event per swing', () => {
    const det = new HeuristicStrokeDetector(cfg, 'right');
    const { states, events } = run(det, speedProfile([...SWING, ...REST(30)]));
    expect(states).toEqual(['idle', 'preparing', 'swinging', 'followThrough', 'cooldown', 'idle']);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.peakSpeed).toBe(12);
    expect(e.peakT).toBeCloseTo(10 * 33.3);
    expect(e.endT - e.peakT).toBeGreaterThanOrEqual(cfg.confirmDelayMs);
    expect(e.forwardSign).toBe(1);
  });

  it('stays idle without significant motion', () => {
    const det = new HeuristicStrokeDetector(cfg);
    const { events, states } = run(det, speedProfile(REST(100)));
    expect(events).toHaveLength(0);
    expect(states).toEqual(['idle']);
  });

  it('rejects swings that are too slow', () => {
    const det = new HeuristicStrokeDetector(cfg);
    const { events, rejected } = run(det, speedProfile([0, 2, 4.5, 5, 4.5, 2, ...REST(20)]));
    expect(events).toHaveLength(0);
    expect(rejected).toContain('too-slow');
  });

  it('keeps the faster forward swing when the backswing was fast too', () => {
    // Backswing peak 6 T/s, dip, then forward swing peak 12 T/s.
    const speeds = [0, 3, 5, 6, 4, 2, 1, 3, 8, 12, 8, 3, 1, ...REST(20)];
    const det = new HeuristicStrokeDetector(cfg, 'right');
    const { events } = run(det, speedProfile(speeds));
    expect(events).toHaveLength(1);
    expect(events[0].peakSpeed).toBe(12);
  });

  it('applies a cooldown so one swing never produces two events', () => {
    // Follow-through with a second, smaller speed bump shortly after emission.
    const speeds = [...SWING.slice(0, 17), 5, 7, 5, 2, ...REST(30)];
    const det = new HeuristicStrokeDetector(cfg, 'right');
    const { events } = run(det, speedProfile(speeds));
    expect(events).toHaveLength(1);
  });

  it('detects consecutive swings once the cooldown has passed', () => {
    const det = new HeuristicStrokeDetector(cfg, 'right');
    const { events } = run(det, speedProfile([...SWING, ...REST(10), ...SWING, ...REST(10), ...SWING, ...REST(10)]));
    expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
    // Analysis windows never overlap the previous stroke.
    expect(events[1].windowStartT).toBeGreaterThanOrEqual(events[0].endT);
  });

  it('rejects swings against the configured net direction', () => {
    const det = new HeuristicStrokeDetector(cfg, 'left'); // forward = -x
    const { events, rejected } = run(det, speedProfile([...SWING, ...REST(10)], 33.3, +1));
    expect(events).toHaveLength(0);
    expect(rejected).toContain('wrong-direction');
  });

  it('uses the facing cue to reject a backswing before the direction is known', () => {
    const det = new HeuristicStrokeDetector(cfg, 'auto');
    // Player faces -x, swing goes +x: that's a take-back, not a forehand.
    const { events, rejected } = run(det, speedProfile([...SWING, ...REST(10)], 33.3, +1, { facing: -0.2 }));
    expect(events).toHaveLength(0);
    expect(rejected).toContain('backswing');
  });

  it('learns the forward direction from strokes', () => {
    const det = new HeuristicStrokeDetector(cfg, 'auto');
    expect(det.forwardSign).toBeNull();
    run(det, speedProfile([...SWING, ...REST(10), ...SWING, ...REST(10)], 33.3, -1, { facing: -0.2 }));
    expect(det.forwardSign).toBe(-1);
  });

  it('rejects two-handed swings', () => {
    const det = new HeuristicStrokeDetector(cfg);
    const frames = speedProfile([...SWING, ...REST(10)]).map((f) => ({ ...f, offWrist: { x: f.wrist!.x + 0.1, y: f.wrist!.y } }));
    const { events, rejected } = run(det, frames);
    expect(events).toHaveLength(0);
    expect(rejected).toContain('two-handed');
  });

  it('abandons a swing when tracking is lost', () => {
    const det = new HeuristicStrokeDetector(cfg);
    const frames = speedProfile(SWING.slice(0, 11));
    const lost = Array.from({ length: 15 }, (_, i) => feat(frames.length * 33.3 + i * 33.3, { wrist: null, wristVel: null, wristSpeed: null }));
    const { events, rejected } = run(det, [...frames, ...lost]);
    expect(events).toHaveLength(0);
    expect(rejected).toContain('lost-tracking');
    expect(det.state).toBe('idle');
  });

  it('resets', () => {
    const det = new HeuristicStrokeDetector(cfg);
    run(det, speedProfile(SWING.slice(0, 10)));
    det.reset();
    expect(det.state).toBe('idle');
  });
});

describe('ForwardDirectionEstimator', () => {
  it('honours fixed settings', () => {
    expect(new ForwardDirectionEstimator('left', 2, 0.75).sign).toBe(-1);
    expect(new ForwardDirectionEstimator('right', 2, 0.75).sign).toBe(1);
  });

  it('needs enough agreeing votes in auto mode', () => {
    const d = new ForwardDirectionEstimator('auto', 2, 0.75);
    d.vote(1);
    expect(d.sign).toBeNull();
    d.vote(1);
    expect(d.sign).toBe(1);
    d.vote(-1);
    expect(d.sign).toBeNull(); // 2/3 < 0.75
    d.vote(1);
    expect(d.sign).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config/config';
import { FeatureExtractor } from '../src/features/FeatureExtractor';
import { LM } from '../src/pose/landmarks';
import { generateSession } from '../src/synthetic/forehandGenerator';
import type { Landmark, PoseFrame } from '../src/types';

const cfg = createConfig().features;

function staticFrame(t: number, points: Partial<Record<number, [number, number]>>, vis = 0.95): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [i, p] of Object.entries(points)) landmarks[Number(i)] = { x: p![0], y: p![1], z: 0, visibility: vis };
  return { timestampMs: t, landmarks, aspect: 1 };
}

/** Upright player, torso length 0.2, dominant (right) wrist at `wrist`. */
function body(wrist: [number, number]): Partial<Record<number, [number, number]>> {
  return {
    [LM.NOSE]: [0.52, 0.22],
    [LM.LEFT_EAR]: [0.49, 0.21],
    [LM.RIGHT_EAR]: [0.49, 0.21],
    [LM.LEFT_SHOULDER]: [0.45, 0.3],
    [LM.RIGHT_SHOULDER]: [0.55, 0.3],
    [LM.LEFT_HIP]: [0.47, 0.5],
    [LM.RIGHT_HIP]: [0.53, 0.5],
    [LM.RIGHT_ELBOW]: [0.6, 0.4],
    [LM.RIGHT_WRIST]: wrist,
    [LM.LEFT_WRIST]: [0.4, 0.45],
    [LM.LEFT_ANKLE]: [0.36, 0.9],
    [LM.RIGHT_ANKLE]: [0.64, 0.9],
  };
}

describe('FeatureExtractor', () => {
  it('normalizes positions by torso length relative to the hips', () => {
    const fx = new FeatureExtractor(cfg, 'right');
    const f = fx.process(staticFrame(0, body([0.7, 0.5])));
    expect(f.valid).toBe(true);
    expect(f.bodyScale).toBeCloseTo(0.2);
    expect(f.wrist!.x).toBeCloseTo(1.0); // 0.2 right of hip center / 0.2
    expect(f.wrist!.y).toBeCloseTo(0);
    expect(f.stanceWidth).toBeCloseTo(0.28 / 0.2);
    expect(f.facing).toBeGreaterThan(0);
  });

  it('is invariant to camera distance (scale) and player position', () => {
    const scaleFrame = (fr: PoseFrame, k: number, dx: number): PoseFrame => ({
      ...fr,
      landmarks: fr.landmarks.map((l) => ({ ...l, x: l.x * k + dx, y: l.y * k })),
    });
    const a = new FeatureExtractor(cfg, 'right').process(staticFrame(0, body([0.7, 0.45])));
    const b = new FeatureExtractor(cfg, 'right').process(scaleFrame(staticFrame(0, body([0.7, 0.45])), 0.5, 0.3));
    expect(b.wrist!.x).toBeCloseTo(a.wrist!.x);
    expect(b.wrist!.y).toBeCloseTo(a.wrist!.y);
    expect(b.elbowAngle!).toBeCloseTo(a.elbowAngle!);
    expect(b.shoulderTurn!).toBeCloseTo(a.shoulderTurn!);
  });

  it('computes wrist velocity in torso lengths per second', () => {
    const fx = new FeatureExtractor({ ...cfg, smoothingMinCutoff: 1000, smoothingBeta: 0 }, 'right'); // ~no smoothing
    let last;
    for (let i = 0; i < 10; i++) {
      // Wrist moves 0.02 image units per 20 ms = 1 unit/s = 5 T/s.
      last = fx.process(staticFrame(i * 20, body([0.6 + i * 0.02, 0.5])));
    }
    expect(last!.wristVel!.x).toBeCloseTo(5, 0);
    expect(last!.wristSpeed!).toBeCloseTo(5, 0);
    expect(last!.wristAccel!).toBeLessThan(5);
  });

  it('uses the left arm for left-handed players', () => {
    const pts = body([0.7, 0.5]);
    pts[LM.LEFT_WRIST] = [0.3, 0.5];
    const f = new FeatureExtractor(cfg, 'left').process(staticFrame(0, pts));
    expect(f.wrist!.x).toBeCloseTo(-1.0);
    expect(f.offWrist!.x).toBeCloseTo(1.0);
  });

  it('treats low-visibility landmarks as missing instead of guessing', () => {
    const fx = new FeatureExtractor(cfg, 'right');
    const fr = staticFrame(0, body([0.7, 0.5]));
    fr.landmarks[LM.RIGHT_WRIST].visibility = 0.1;
    const f = fx.process(fr);
    expect(f.valid).toBe(true);
    expect(f.wrist).toBeNull();
    expect(f.wristSpeed).toBeNull();
    expect(f.elbowAngle).toBeNull();

    const noTorso = staticFrame(33, body([0.7, 0.5]));
    noTorso.landmarks[LM.LEFT_HIP].visibility = 0;
    const g = fx.process(noTorso);
    expect(g.valid).toBe(false);
    expect(g.wrist).toBeNull();
  });

  it('does not compute velocity across long tracking gaps', () => {
    const fx = new FeatureExtractor(cfg, 'right');
    fx.process(staticFrame(0, body([0.6, 0.5])));
    fx.process(staticFrame(33, body([0.6, 0.5])));
    const after = fx.process(staticFrame(2000, body([0.9, 0.5])));
    expect(after.wristSpeed).toBeNull();
  });

  it('shoulder turn estimate grows with the synthetic turn angle', () => {
    const frames = generateSession({ durationMs: 1200, fps: 30, strokes: [{ startMs: 0 }] });
    const fx = new FeatureExtractor(cfg, 'right');
    const out = frames.map((f) => fx.process(f));
    const atStart = out[0].shoulderTurn!;
    const atBackswing = Math.max(...out.slice(10, 22).map((f) => f.shoulderTurn ?? 0));
    expect(atStart).toBeLessThan(25);
    expect(atBackswing).toBeGreaterThan(65);
  });
});

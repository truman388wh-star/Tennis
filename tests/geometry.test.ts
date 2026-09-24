import { describe, expect, it } from 'vitest';
import { angleAt, angleBetween, clamp, distance, foreshorteningAngle, midpoint, tiltFromVertical } from '../src/utils/geometry';
import { argMax, argMin, mean, median, slope } from '../src/utils/stats';

describe('geometry', () => {
  it('computes joint angles', () => {
    expect(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(angleAt({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(45);
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('computes angles between vectors', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 2 })).toBeCloseTo(90);
    expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('measures tilt from vertical in image coordinates (y down)', () => {
    expect(tiltFromVertical({ x: 0, y: -1 })).toBeCloseTo(0);
    expect(tiltFromVertical({ x: 1, y: -1 })).toBeCloseTo(45);
    expect(tiltFromVertical({ x: -1, y: -1 })).toBeCloseTo(-45);
  });

  it('estimates rotation from foreshortening', () => {
    expect(foreshorteningAngle(0, 0.8)).toBeCloseTo(0);
    expect(foreshorteningAngle(0.8, 0.8)).toBeCloseTo(90);
    expect(foreshorteningAngle(0.4, 0.8)).toBeCloseTo(30);
    expect(foreshorteningAngle(-0.4, 0.8)).toBeCloseTo(30);
    expect(foreshorteningAngle(1.2, 0.8)).toBeCloseTo(90); // clamped
    expect(foreshorteningAngle(0.4, 0)).toBeNull();
  });

  it('has basic vector helpers', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({ x: 1, y: 2 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });
});

describe('stats', () => {
  it('computes median, mean and slope', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1);
    expect(slope([5])).toBeNull();
  });

  it('finds argmax/argmin skipping nulls within bounds', () => {
    const xs = [1, null, 5, 3, 9];
    expect(argMax(xs, (v) => v)).toBe(4);
    expect(argMax(xs, (v) => v, 0, 3)).toBe(2);
    expect(argMin(xs, (v) => v, 1, 4)).toBe(3);
    expect(argMax([null], (v) => v)).toBe(-1);
  });
});

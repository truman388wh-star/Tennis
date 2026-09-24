import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../src/buffer/RingBuffer';
import { PoseBuffer } from '../src/buffer/PoseBuffer';
import { OneEuroFilter } from '../src/utils/oneEuro';
import { feat } from './helpers';
import { gaussian, mulberry32 } from '../src/utils/random';

describe('RingBuffer', () => {
  it('keeps at most capacity items, oldest first', () => {
    const rb = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((v) => rb.push(v));
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.latest()).toBe(5);
    expect(rb.at(0)).toBe(3);
    expect(rb.at(5)).toBeUndefined();
  });

  it('drops from the front and queries ranges', () => {
    const rb = new RingBuffer<number>(10);
    [1, 2, 3, 4, 5].forEach((v) => rb.push(v));
    rb.dropWhile((v) => v < 3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.range((v) => v, 4, 10)).toEqual([4, 5]);
    rb.clear();
    expect(rb.size).toBe(0);
  });

  it('rejects invalid capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});

describe('PoseBuffer', () => {
  it('only retains the configured time window (bounded memory)', () => {
    const buf = new PoseBuffer(1000);
    for (let t = 0; t <= 60_000; t += 33) buf.push(feat(t));
    expect(buf.size).toBeLessThanOrEqual(32);
    expect(buf.latest()!.t).toBe(59_994);
    const r = buf.range(59_000, 60_000);
    expect(r.every((f) => f.t >= 59_000)).toBe(true);
  });
});

describe('OneEuroFilter', () => {
  it('reduces jitter on a static signal', () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.4, dCutoff: 1 });
    const rand = mulberry32(1);
    const out: number[] = [];
    for (let i = 0; i < 200; i++) out.push(f.filter(1 + 0.01 * gaussian(rand), i * 33));
    const tail = out.slice(50);
    const std = Math.sqrt(tail.reduce((a, v) => a + (v - 1) ** 2, 0) / tail.length);
    expect(std).toBeLessThan(0.006);
  });

  it('follows fast motion with little lag', () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.4, dCutoff: 1 });
    let y = 0;
    for (let i = 0; i < 30; i++) y = f.filter(i * 0.3, i * 33); // fast ramp
    expect(29 * 0.3 - y).toBeLessThan(0.6); // lag well under 2 frames of motion
  });

  it('resets', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    f.filter(5, 0);
    f.reset();
    expect(f.filter(1, 10)).toBe(1);
  });
});

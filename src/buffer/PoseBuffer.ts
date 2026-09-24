// Temporal buffer of per-frame body features covering a sliding time window.

import type { BodyFeatures } from '../types';
import { RingBuffer } from './RingBuffer';

/** Generous capacity: window (s) x max fps, with headroom. */
const MAX_FPS = 120;

export class PoseBuffer {
  private readonly ring: RingBuffer<BodyFeatures>;

  constructor(private readonly windowMs: number) {
    this.ring = new RingBuffer<BodyFeatures>(Math.ceil((windowMs / 1000) * MAX_FPS) + 16);
  }

  push(f: BodyFeatures): void {
    this.ring.push(f);
    const cutoff = f.t - this.windowMs;
    this.ring.dropWhile((item) => item.t < cutoff);
  }

  range(t0: number, t1: number): BodyFeatures[] {
    return this.ring.range((f) => f.t, t0, t1);
  }

  get size(): number {
    return this.ring.size;
  }

  latest(): BodyFeatures | undefined {
    return this.ring.latest();
  }

  clear(): void {
    this.ring.clear();
  }
}

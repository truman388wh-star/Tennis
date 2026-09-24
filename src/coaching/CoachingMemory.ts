// Short-term memory of recent strokes, used to avoid repetitive feedback,
// detect recurring problems and notice improvements.

import type { CategoryId, FeedbackKind } from '../types';
import { RingBuffer } from '../buffer/RingBuffer';

export interface StrokeRecord {
  index: number;
  overall: number;
  confidence: number;
  categories: Record<CategoryId, number | null>;
  /** Primary issue of the stroke (after ranking), if any. */
  primaryIssue: string | null;
  /** Severity of every detected issue on that stroke. */
  severities: Record<string, number>;
  /** Text that was spoken for the stroke, if anything was spoken. */
  spoken: string | null;
  spokenKind: FeedbackKind | null;
  spokenIssue: string | null;
}

export class CoachingMemory {
  private readonly ring: RingBuffer<StrokeRecord>;

  constructor(readonly size: number) {
    this.ring = new RingBuffer(size);
  }

  add(record: StrokeRecord): void {
    this.ring.push(record);
  }

  /** Most recent first. */
  recent(n = this.size): StrokeRecord[] {
    return this.ring.toArray().reverse().slice(0, n);
  }

  get count(): number {
    return this.ring.size;
  }

  /** How many of the last n strokes had this primary issue. */
  countPrimary(issueId: string, n: number): number {
    return this.recent(n).filter((r) => r.primaryIssue === issueId).length;
  }

  /** Strokes since `text` was last spoken (Infinity if never / forgotten). */
  strokesSinceSpoken(pred: (r: StrokeRecord) => boolean): number {
    const recent = this.recent();
    for (let i = 0; i < recent.length; i++) if (recent[i].spoken && pred(recent[i])) return i + 1;
    return Number.POSITIVE_INFINITY;
  }

  /** Strokes since anything was spoken. */
  strokesSinceAnySpoken(): number {
    return this.strokesSinceSpoken(() => true);
  }

  clear(): void {
    this.ring.clear();
  }
}

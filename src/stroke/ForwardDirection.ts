// Determines which image direction is "forward" (towards the net).
// With the camera beside the player, every forehand's forward swing moves the
// wrist the same way across the image, so a majority vote over the fastest
// swing direction of detected strokes identifies it. Users can also fix it in
// settings, which is more robust for the first stroke of a session.

import type { ForwardSign, NetDirection } from '../types';

export class ForwardDirectionEstimator {
  private plus = 0;
  private minus = 0;

  constructor(
    private readonly setting: NetDirection,
    private readonly minVotes: number,
    private readonly minAgreement: number,
  ) {}

  /** The established forward sign, or null while still unknown. */
  get sign(): ForwardSign | null {
    if (this.setting === 'right') return 1;
    if (this.setting === 'left') return -1;
    const total = this.plus + this.minus;
    if (total < this.minVotes) return null;
    if (this.plus / total >= this.minAgreement) return 1;
    if (this.minus / total >= this.minAgreement) return -1;
    return null;
  }

  vote(sign: ForwardSign): void {
    if (sign === 1) this.plus++;
    else this.minus++;
  }

  reset(): void {
    this.plus = 0;
    this.minus = 0;
  }
}

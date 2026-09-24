// One Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter that
// smooths jitter strongly when a signal moves slowly and follows it closely
// (little lag) when it moves fast. Well suited to pose landmarks during a
// swing, where plain moving averages would smear the fast forward swing.

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

function alpha(cutoff: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(private readonly params: OneEuroParams) {}

  /** Filters value observed at time tMs. */
  filter(value: number, tMs: number): number {
    if (this.x === null || this.lastT === null || tMs <= this.lastT) {
      this.x = value;
      this.dx = 0;
      this.lastT = tMs;
      return value;
    }
    const dt = (tMs - this.lastT) / 1000;
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }
}

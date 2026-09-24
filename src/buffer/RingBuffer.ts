// Fixed-capacity circular buffer with time-window queries. Used as the
// temporal pose buffer: memory stays bounded for arbitrarily long sessions.

export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!(capacity > 0)) throw new Error('RingBuffer capacity must be positive');
    this.items = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const idx = (this.start + this.count) % this.capacity;
    this.items[idx] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** i = 0 is the oldest item. */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    return this.items[(this.start + i) % this.capacity];
  }

  latest(): T | undefined {
    return this.at(this.count - 1);
  }

  /** Drops items from the front while the predicate holds. */
  dropWhile(pred: (item: T) => boolean): void {
    while (this.count > 0 && pred(this.items[this.start] as T)) {
      this.items[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.count--;
    }
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.at(i) as T);
    return out;
  }

  /** Items whose time (via getT) lies in [t0, t1]. */
  range(getT: (item: T) => number, t0: number, t1: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.at(i) as T;
      const t = getT(item);
      if (t >= t0 && t <= t1) out.push(item);
    }
    return out;
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.count = 0;
  }
}

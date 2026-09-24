// Numeric helpers for arrays with missing values (null).

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function compact<T>(values: readonly (T | null | undefined)[]): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined);
}

/** Index of the maximum of f over [from, to] (inclusive), skipping nulls. */
export function argMax<T>(items: readonly T[], f: (item: T) => number | null, from = 0, to = items.length - 1): number {
  let best = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let i = Math.max(0, from); i <= Math.min(to, items.length - 1); i++) {
    const v = f(items[i]);
    if (v !== null && v > bestValue) {
      bestValue = v;
      best = i;
    }
  }
  return best;
}

/** Index of the minimum of f over [from, to] (inclusive), skipping nulls. */
export function argMin<T>(items: readonly T[], f: (item: T) => number | null, from = 0, to = items.length - 1): number {
  return argMax(items, (item) => {
    const v = f(item);
    return v === null ? null : -v;
  }, from, to);
}

/** Least-squares slope of y over x. */
export function slope(ys: readonly number[]): number | null {
  const n = ys.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys) as number;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return num / den;
}

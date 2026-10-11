/** A copy of `values` sorted ascending; the list itself is left as is. */
function ascending(values: ArrayLike<number>) {
  return Array.from(values).sort((a, b) => a - b)
}

/**
 * The value at rank `q` (in (0, 1]) of a sorted, non-empty list, never interpolated: the nearest
 * rank, `sorted[ceil(q * length) - 1]`. The median of ten values is the fifth, the 95th percentile
 * of twenty the nineteenth. The list must be sorted ascending; `q` of 0 or an empty list gives
 * `undefined`, and `q > 1` reads past the end (also `undefined`).
 */
function quantile(sorted: ArrayLike<number>, q: number): number | undefined {
  return sorted[Math.ceil(q * sorted.length) - 1]
}

/** The median of a sorted, non-empty list: its middle value for an odd length, the mean of the two
 *  middle ones for an even length, `(s[m − 1] + s[m]) / 2`. Interpolated, unlike `quantile`. */
function median(sorted: ArrayLike<number>) {
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** `quantile` of an unsorted list: a copy is sorted ascending first, the list itself is left as is. */
export function quantileOf(values: ArrayLike<number>, q: number): number | undefined {
  return quantile(ascending(values), q)
}

/** `median` of an unsorted list: a copy is sorted ascending first, the list itself is left as is. */
export function medianOf(values: ArrayLike<number>) {
  return median(ascending(values))
}

/** The arithmetic mean of `values`, summed left to right from 0 then divided by the count: the
 *  `reduce((a, b) => a + b, 0) / length` form, bit for bit. An empty list gives NaN. */
export function mean(values: ArrayLike<number>) {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

/** The numbers of a list of values, from `summaryOf`. */
export interface Summary {
  /** How many values. */
  n: number
  /** The arithmetic mean (`mean`). */
  mean: number
  /** The lowest value. */
  min: number
  /** The highest value. */
  max: number
  /** The 50th percentile, by the nearest rank (`quantile`): the lower of the two middle values
   *  of an even count. */
  p50: number
  /** The 95th percentile, by the nearest rank (`quantile`). */
  p95: number
  /** The 99th percentile, by the nearest rank (`quantile`). */
  p99: number
}

/** THE summary of a list of times or errors, in one sort: its count, mean, lowest, highest
 *  its nearest-rank 50th, 95th and 99th percentiles (`quantile`); `null` for an empty list. The values must
 *  be comparable (no NaN), or the order is the caller's to blame. */
export function summaryOf(values: ArrayLike<number>): Summary | null {
  if (!values.length) return null
  const sorted = ascending(values)
  return {
    n: sorted.length,
    mean: mean(sorted),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: quantile(sorted, 0.5)!,
    p95: quantile(sorted, 0.95)!,
    p99: quantile(sorted, 0.99)!,
  }
}

/**
 * The value at rank `q` (in (0, 1]) of a sorted, non-empty list, never interpolated: the nearest
 * rank, `sorted[ceil(q * length) - 1]`. The median of ten values is the fifth, the 95th percentile
 * of twenty the nineteenth. The list must be sorted ascending; `q` of 0 or an empty list gives
 * `undefined`, and `q > 1` reads past the end (also `undefined`).
 */
export function quantile(sorted: ArrayLike<number>, q: number): number | undefined {
  return sorted[Math.ceil(q * sorted.length) - 1]
}

/** The median of a sorted, non-empty list: its middle value for an odd length, the mean of the two
 *  middle ones for an even length, `(s[m − 1] + s[m]) / 2`. Interpolated, unlike `quantile`. */
export function median(sorted: ArrayLike<number>) {
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The value at rank `q` (in [0, 1]) of a sorted list by the floor rank, never interpolated:
 *  `sorted[min(length − 1, floor(q · length))]`, so `q = 1` is the last value and `q = 0.5` the
 *  upper of the two middle ones (`length >> 1`). An empty list gives `undefined`. Unlike
 *  `quantile`'s ceil rank, the 95th percentile of twenty values is the twentieth. */
export function quantileFloor(sorted: ArrayLike<number>, q: number): number | undefined {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** `quantile` of an unsorted list: a copy is sorted ascending first, the list itself is left as is. */
export function quantileOf(values: ArrayLike<number>, q: number): number | undefined {
  return quantile(
    Array.from(values).sort((a, b) => a - b),
    q,
  )
}

/** `median` of an unsorted list: a copy is sorted ascending first, the list itself is left as is. */
export function medianOf(values: ArrayLike<number>) {
  return median(Array.from(values).sort((a, b) => a - b))
}

/** `quantileFloor` of an unsorted list: a copy is sorted ascending first, the list itself is left as is. */
export function quantileFloorOf(values: ArrayLike<number>, q: number): number | undefined {
  return quantileFloor(
    Array.from(values).sort((a, b) => a - b),
    q,
  )
}

/** The arithmetic mean of `values`, summed left to right from 0 then divided by the count: the
 *  `reduce((a, b) => a + b, 0) / length` form, bit for bit. An empty list gives NaN. */
export function mean(values: ArrayLike<number>) {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

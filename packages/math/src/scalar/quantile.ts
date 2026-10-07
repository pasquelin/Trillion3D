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

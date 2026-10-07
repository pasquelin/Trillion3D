/**
 * The value at rank `q` (in (0, 1]) of a sorted, non-empty list, never interpolated: the nearest
 * rank, `sorted[ceil(q * length) - 1]`. The median of ten values is the fifth, the 95th percentile
 * of twenty the nineteenth. The list must be sorted ascending; `q` of 0 or an empty list gives
 * `undefined`, and `q > 1` reads past the end (also `undefined`).
 */
export function quantile(sorted: ArrayLike<number>, q: number): number | undefined {
  return sorted[Math.ceil(q * sorted.length) - 1]
}

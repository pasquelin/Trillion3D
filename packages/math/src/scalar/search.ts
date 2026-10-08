/** Binary searches over an integer range `[low, high]` for the edge of a monotone predicate. */

/** The last index of `[low, high]` where `holds` — true up to some index, false after — is true,
 *  `low` when none is (or the range is empty, `high <= low`): `holds(low)` is never asked. The
 *  bounds are safe integers. The midpoint rounds up and is taken from `lo`,
 *  `lo + ceil((hi − lo) / 2)`, never from the sum `lo + hi`, which rounds past 2^53: it lies in
 *  `(lo, hi]`, so every step shrinks the range. */
export function lastTrue(low: number, high: number, holds: (index: number) => boolean) {
  let lo = low,
    hi = high
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2)
    if (holds(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The first index of `[low, high]` where `holds` — false up to some index, true after — is true,
 *  `high` when none is, `low` when the range is empty (`high <= low`): `holds(high)` is never
 *  asked. The bounds are safe integers. The midpoint rounds down and is taken from `lo`,
 *  `lo + floor((hi − lo) / 2)`, never from the sum `lo + hi`, which rounds past 2^53: it lies in
 *  `[lo, hi)`, so every step shrinks the range. */
export function firstTrue(low: number, high: number, holds: (index: number) => boolean) {
  let lo = low,
    hi = high
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (holds(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

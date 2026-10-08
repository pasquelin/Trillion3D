/** Binary searches over an integer range `[low, high]` for the edge of a monotone predicate. */

import { ceilDiv } from './integers.ts'

/** The last index of `[low, high]` where `holds` — true up to some index, false after — is true,
 *  `low` when none is (or the range is empty, `high <= low`): `holds(low)` is never asked. The
 *  midpoint rounds up, `ceilDiv(lo + hi, 2)`, exact for every safe integer. */
export function lastTrue(low: number, high: number, holds: (index: number) => boolean) {
  let lo = low,
    hi = high
  while (lo < hi) {
    const mid = ceilDiv(lo + hi, 2)
    if (holds(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The first index of `[low, high]` where `holds` — false up to some index, true after — is true,
 *  `high` when none is, `low` when the range is empty (`high <= low`): `holds(high)` is never
 *  asked. The midpoint rounds down, `Math.floor((lo + hi) / 2)`, exact for every safe integer. */
export function firstTrue(low: number, high: number, holds: (index: number) => boolean) {
  let lo = low,
    hi = high
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (holds(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

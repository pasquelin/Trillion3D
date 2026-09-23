/** Skipped pages one write covers rather than opening a second. */
const RESIDENCY_RANGE_GAP = 64;
/** Ranges at most per flush: beyond that, everything is written at once. Thousands of small writes
 *  cost more than the one they replace. */
export const RESIDENCY_RANGE_MAX = 32;

/**
 * Groups increasing page indices into contiguous ranges, written into `into` as `[first, last]`
 * pairs. Two ranges separated by fewer than `RESIDENCY_RANGE_GAP` pages become one: the in-between
 * pages are rewritten with their current value, which changes nothing and avoids a second write.
 * Returns the range count, or `1` covering everything when there would be more than
 * `RESIDENCY_RANGE_MAX`.
 */
export function coalesceResidencyRanges(sorted: Int32Array, count: number, into: Int32Array) {
  if (count <= 0) return 0;
  let ranges = 0,
    from = sorted[0],
    to = sorted[0];
  /** Writes the current range and returns true. Returns false when there would be one more than
   *  `RESIDENCY_RANGE_MAX`: the single range covering everything is then written in its place. */
  const close = () => {
    if (ranges === RESIDENCY_RANGE_MAX) {
      into[0] = sorted[0];
      into[1] = sorted[count - 1];
      return false;
    }
    into[ranges * 2] = from;
    into[ranges * 2 + 1] = to;
    ranges++;
    return true;
  };
  for (let i = 1; i < count; i++) {
    const page = sorted[i];
    if (page - to <= RESIDENCY_RANGE_GAP) {
      to = page;
      continue;
    }
    if (!close()) return 1;
    from = page;
    to = page;
  }
  return close() ? ranges : 1;
}

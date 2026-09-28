/**
 * The two measurement tools of the path governor (`governor.ts`): the fineness of
 * the thread clock, and the sliding median it arbitrates on. Nothing here knows
 * paths or operations.
 */

/** Executions retained per path: the median then follows a minute of play, not a frame. */
const PATH_WINDOW = 30;
/**
 * Clock resolution beyond which no arbitration is attempted. An engine batch lasts
 * tenths of a millisecond: a coarser clock than that yields only zeros and jumps,
 * from which no median comes. This is not a machine constant, it is the order of magnitude of
 * what is measured.
 */
export const CLOCK_RESOLUTION_MS = 0.1;
/** Clock reads used to estimate its resolution: enough to see the smallest step. */
const CLOCK_PROBES = 32;

/**
 * The smallest non-zero gap between two successive reads of `now`, in milliseconds. A
 * deliberately truncated clock yields it as-is; `null` if no read has moved.
 */
export function estimateClockResolutionMs(now: () => number) {
  let smallest: number | null = null;
  let previous = now();
  for (let i = 0; i < CLOCK_PROBES; i++) {
    const current = now();
    const step = current - previous;
    if (step > 0 && (smallest === null || step < smallest)) smallest = step;
    previous = current;
  }
  return smallest;
}

/** Whether `a` comes strictly before `b` in a typed array's sort: ascending, -0 before +0, NaN last. */
const sortsBefore = (a: number, b: number) =>
  a < b || (b !== b && a === a) || (a === 0 && b === 0 && 1 / a < 0 && 1 / b > 0);

/**
 * A sliding median over the last `PATH_WINDOW` values, with no allocation per execution (#983): the
 * values are kept sorted as they arrive — the one that leaves taken out by identity (NaN is
 * itself, -0 is not +0), the new one inserted after its equals —, so the sorted copy is always the
 * typed sort of the last values, bit for bit, and the median is read from it without sorting or a view.
 */
export class SlidingMedian {
  private readonly values = new Float64Array(PATH_WINDOW);
  private readonly sorted = new Float64Array(PATH_WINDOW);
  private next = 0;
  count = 0;
  add(value: number) {
    const { sorted, values } = this;
    let n = this.count;
    if (n === PATH_WINDOW) {
      const leaving = values[this.next];
      let i = 0;
      while (!Object.is(sorted[i], leaving)) i++;
      sorted.copyWithin(i, i + 1, n--);
    } else this.count++;
    values[this.next] = value;
    this.next = (this.next + 1) % PATH_WINDOW;
    for (; n > 0 && sortsBefore(value, sorted[n - 1]); n--) sorted[n] = sorted[n - 1];
    sorted[n] = value;
  }
  median() {
    const { sorted, count } = this;
    if (!count) return null;
    const middle = count >> 1;
    return count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
}

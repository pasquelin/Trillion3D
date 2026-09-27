/** Skipped pages one residency write covers rather than opening a second. */
export const RESIDENCY_RANGE_GAP = 64;
/** Residency ranges at most per flush: beyond that, everything is written at once. Thousands of
 *  small writes cost more than the one they replace. */
export const RESIDENCY_RANGE_MAX = 32;

/**
 * How increasing indices become write ranges. `gap`: the largest step between two neighbours still
 * sent in one range — the indices in between are rewritten with their current value, which changes
 * nothing and saves a write. `cap`: the most ranges returned. Past it, `steps` given (a scratch of
 * at least `count` ints), the ranges across the narrowest steps are joined until `cap` remain;
 * without, one range covers everything.
 */
export type RangeRule = { gap: number; cap: number; steps?: Int32Array };

/**
 * Groups the `count` increasing, distinct indices of `sorted` into ranges under `rule`, written
 * into `into` as `[first, last]` pairs (room for `rule.cap` of them); returns their count. One
 * coalescer for every flush that sends what changed: the residency bits and nodes, the texture
 * page tables (#961).
 */
export function coalesceRanges(
  sorted: Int32Array,
  count: number,
  into: Int32Array,
  { gap, cap, steps }: RangeRule,
) {
  if (count <= 0) return 0;
  let join = gap,
    far = 0;
  for (let i = 1; i < count; i++) {
    const step = sorted[i] - sorted[i - 1];
    if (step <= gap) continue;
    if (steps) steps[far] = step;
    far++;
  }
  if (far >= cap) {
    if (!steps) {
      into[0] = sorted[0];
      into[1] = sorted[count - 1];
      return 1;
    }
    join = steps.subarray(0, far).sort()[far - cap];
  }
  let ranges = 0,
    from = sorted[0];
  for (let i = 1; i <= count; i++) {
    if (i < count && sorted[i] - sorted[i - 1] <= join) continue;
    into[ranges * 2] = from;
    into[ranges * 2 + 1] = sorted[i - 1];
    ranges++;
    if (i < count) from = sorted[i];
  }
  return ranges;
}

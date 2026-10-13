import { resized } from '../../../../math/src/sequence/resized.ts'

/**
 * How increasing indices become write ranges. `gap`: the largest step between two neighbours still
 * sent in one range — the indices in between are rewritten with their current value, which changes
 * nothing and saves a write. `cap`: the most ranges returned. Past it, `overflow` says what is
 * joined: everything into one range, or the ranges across the `narrowest` steps until `cap` remain
 * (`steps`: a scratch of at least `count` ints).
 */
export type RangeRule = { gap: number; cap: number } & (
  { overflow: 'whole' } | { overflow: 'narrowest'; steps: Int32Array }
)

/** Residency flushes: skipped pages closer than 64 share a write, and past 32 ranges everything is
 *  written at once — thousands of small writes cost more than the one they replace. */
export const RESIDENCY_RULE: RangeRule = { gap: 64, cap: 32, overflow: 'whole' }

/**
 * Groups the `count` increasing, distinct indices of `sorted` into ranges under `rule`, written
 * into `into` as `[first, last]` pairs (room for `rule.cap` of them); returns their count. One
 * coalescer for every flush that sends what changed: the residency bits and nodes, the texture
 * page tables.
 */
export function coalesceRanges(
  sorted: Int32Array,
  count: number,
  into: Int32Array,
  rule: RangeRule,
) {
  const { gap, cap } = rule
  if (count <= 0) return 0
  let join = gap,
    far = 0
  for (let i = 1; i < count; i++) {
    const step = sorted[i] - sorted[i - 1]
    if (step <= gap) continue
    if (rule.overflow === 'narrowest') rule.steps[far] = step
    else if (far + 1 >= cap) {
      into[0] = sorted[0]
      into[1] = sorted[count - 1]
      return 1
    }
    far++
  }
  if (rule.overflow === 'narrowest' && far >= cap)
    join = rule.steps.subarray(0, far).sort()[far - cap]
  let ranges = 0,
    from = sorted[0]
  for (let i = 1; i <= count; i++) {
    if (i < count && sorted[i] - sorted[i - 1] <= join) continue
    into[ranges * 2] = from
    into[ranges * 2 + 1] = sorted[i - 1]
    ranges++
    if (i < count) from = sorted[i]
  }
  return ranges
}

/**
 * The indices that changed since the last upload, each once, and the runs they make under the
 * coalescer: the one changed list of every flush that sends what changed. `gap` is the largest step
 * two neighbours share a run across, `cap` the most runs (none bounds them: every run stays apart).
 * The runs are made when asked, once per change.
 */
export function createChangedRuns(size: number, gap: number, cap = Infinity) {
  let marked = new Uint8Array(size)
  let changed = new Int32Array(64),
    count = 0
  /** The runs as `[first, last]` pairs, valid while `joined`. */
  let pairs = new Int32Array(128),
    runCount = 0,
    joined = true
  const rule = { gap, cap, overflow: 'narrowest', steps: new Int32Array(64) } satisfies RangeRule
  return {
    /** How many indices changed. */
    get count() {
      return count
    },
    /** `index` changed since the last `clear`. */
    mark(index: number) {
      if (marked[index]) return
      marked[index] = 1
      if (count === changed.length) changed = resized(changed, count + 1)
      changed[count++] = index
      joined = false
    },
    /** The runs of the changed indices, in increasing order, as `[first, last]` pairs. */
    runs() {
      if (!joined) {
        rule.cap = Math.min(cap, count)
        rule.steps = resized(rule.steps, count)
        pairs = resized(pairs, 2 * rule.cap)
        runCount = coalesceRanges(changed.subarray(0, count).sort(), count, pairs, rule)
        joined = true
      }
      return { count: runCount, pairs }
    },
    /** Every change sent: nothing is marked. */
    clear() {
      for (let i = 0; i < count; i++) marked[changed[i]] = 0
      count = runCount = 0
      joined = true
    },
    /** The indices run to `size`: the marks held so far are kept. */
    grow(size: number) {
      marked = resized(marked, size)
    },
  }
}

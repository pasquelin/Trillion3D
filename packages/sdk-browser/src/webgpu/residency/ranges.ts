import { resized } from '../../../../math/src/sequence/resized.ts'
import { createMarkedList } from '../../../../math/src/sequence/markedList.ts'

/**
 * How increasing indices become write ranges. `gap`: the largest step between two neighbours still
 * sent in one range — the indices in between are rewritten with their current value, which changes
 * nothing and saves a write. `cap`: the most ranges returned; past it, the ranges across the
 * narrowest steps are joined until `cap` remain (`steps`: a scratch of at least `count` ints).
 */
export type RangeRule = { gap: number; cap: number; steps: Int32Array }

/** Bytes a write may leave unchanged between two changed records and still be one write. */
const WRITE_GAP_BYTES = 256
/** Writes an upload makes at most: past it, the narrowest gaps join. */
export const WRITE_CAP = 64

/**
 * THE write rule of every upload that sends changed records from a table it mirrors — the
 * changed words of a buffer (`../../gpu/core/writeChanged.ts`), the run writes of the engine's
 * tables (`../../gpu/dag/runWrites.ts`), the texture page tables: `rule` set for records of
 * `strideWords` words and `count` indices — a run spans at most `WRITE_GAP_BYTES` unchanged, up to
 * `WRITE_CAP` writes. Scattered changes never rewrite everything between the lowest and the highest.
 */
export function writeRule(rule: RangeRule, strideWords: number, count: number) {
  rule.steps = resized(rule.steps, count)
  rule.gap = 1 + Math.floor(WRITE_GAP_BYTES / (strideWords * 4))
  rule.cap = WRITE_CAP
  return rule
}

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
    rule.steps[far++] = step
  }
  if (far >= cap) join = rule.steps.subarray(0, far).sort()[far - cap]
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
 * The indices that changed since the last upload, each once: the one changed list of every flush
 * that sends what changed — rows, words, slots, records, placements. A flush takes them as runs
 * (`runs`), made when asked, once per change: an upload from a table it mirrors gives its records'
 * `strideWords` and joins them by the write rule (`writeRule`); a walk of the changed indices
 * themselves gives none and gets every run of neighbours apart, no unchanged index in it. A writer
 * whose runs follow the stride of its records takes them increasing instead (`take`) and coalesces
 * them by their bytes (`../../gpu/dag/runWrites.ts`, `writeRanges`).
 *
 * An index is marked by a byte, the marks grown to the largest marked: the indices are those of a
 * table the engine holds, so the marks weigh a byte per entry of it at most, and a mark is one array
 * write — no probe, which a flush of every row of a rebuilt table would pay per row.
 */
export function createChangedRuns(strideWords = 0) {
  const changed = createMarkedList()
  /** The last `take`, increasing: a view the next take overwrites. */
  let taken = new Int32Array(0)
  /** The runs as `[first, last]` pairs, valid while `joined`. */
  let pairs = new Int32Array(0),
    runCount = 0,
    joined = true
  const rule: RangeRule = { gap: 1, cap: 0, steps: new Int32Array(0) }
  const runs = {
    /** How many indices changed. */
    get count() {
      return changed.count
    },
    /** Bytes of the marks, the lists and the runs. */
    get byteLength() {
      return changed.byteLength + taken.byteLength + pairs.byteLength + rule.steps.byteLength
    },
    /** `index` changed since the last `clear`. */
    mark(index: number) {
      if (changed.add(index)) joined = false
    },
    /** The runs of the changed indices, in increasing order, as `[first, last]` pairs. */
    runs() {
      if (!joined) {
        const { count } = changed
        if (strideWords) writeRule(rule, strideWords, count)
        else rule.steps = resized(rule.steps, count)
        rule.cap = strideWords ? Math.min(WRITE_CAP, count) : count
        pairs = resized(pairs, 2 * rule.cap)
        runCount = coalesceRanges(changed.list.subarray(0, count).sort(), count, pairs, rule)
        joined = true
      }
      return { count: runCount, pairs }
    },
    /** The changed indices, increasing, every mark cleared: a view the next take overwrites. */
    take() {
      const { count } = changed
      taken = resized(taken, count)
      const sorted = taken.subarray(0, count)
      sorted.set(changed.list.subarray(0, count))
      sorted.sort()
      runs.clear()
      return sorted
    },
    /** Every change sent: nothing is marked. */
    clear() {
      changed.clear()
      runCount = 0
      joined = true
    },
  }
  return runs
}

export type ChangedRuns = ReturnType<typeof createChangedRuns>

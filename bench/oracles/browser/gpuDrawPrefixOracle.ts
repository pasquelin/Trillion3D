/**
 * Oracle: faithful, line-by-line ports of the `prefixGroups` kernel of packages/sdk-browser/src/visibility/draw/shader.ts.
 *
 * `prefixSerial` is the one-thread kernel (`@workgroup_size(1)`): it walks slots in order and
 * advances a single cursor. `prefixScan` is the kernel shader.ts carries: the slots in order, an
 * unused one skipped, each used one's groups spread over the 64 lanes in contiguous runs whose
 * totals are scanned in workgroup memory. All compute in u32
 * (`>>> 0`), as WGSL does.
 *
 * Both read and write the kernel's one `groups` buffer (`drawGroupWords`) by its regions, as the
 * WGSL `groupOffsetAt` and `groupCountAt` place them: each group's count read at
 * `[entries, 2·entries)`, its offset written at `[0, entries)`.
 *
 * This file depends on no real GPU run: `tests/kit/fakeDevice/fakeCompute.ts` does not replay
 * `prefixGroups` (it short-circuits the whole compaction with the CPU oracle `evaluateDrawCompact`),
 * so equivalence of the kernels is proved here by direct transcription and comparison.
 */
import { drawGroupWords } from '../../../packages/sdk-browser/src/visibility/draw/contract.ts'

const WORKGROUP = 64
const U32 = (n: number) => n >>> 0

export type PrefixResult = {
  totals: Uint32Array // what writeCmd(slot, ...) would write into indirect[slot*4+1]
  /** The offsets region of `groups`, groupCount*slots words; 0 for an empty slot (never read). */
  offsets: Uint32Array
}

/** Transcribes WGSL `groupOffsetAt`: group `group`'s offset in `slot`, the first region. */
const groupOffsetAt = (slots: number, group: number, slot: number) => group * slots + slot
/** Transcribes WGSL `groupCountAt`: its count, `entries` words further. */
export const groupCountAt = (entries: number, slots: number, group: number, slot: number) =>
  entries + groupOffsetAt(slots, group, slot)

/** A `groups` buffer for `groupCount` groups of `slots` slots (`drawGroupWords`, a table of
 *  `groupCount` full groups), `counts` — one per group and slot — in its counts region. */
export function groupsWithCounts(counts: Uint32Array, groupCount: number, slots: number) {
  const { entries, words } = drawGroupWords(groupCount * WORKGROUP, slots)
  const groups = new Uint32Array(words)
  groups.set(counts, entries)
  return { groups, entries }
}

/** The run's own copy of `groups`, its offsets region cleared, what it reads and writes, and the
 *  region it returns. */
function prefixRun(groups: Uint32Array, groupCount: number, slots: number) {
  const { entries } = drawGroupWords(groupCount * WORKGROUP, slots)
  const held = groups.slice().fill(0, 0, entries)
  return {
    count: (group: number, slot: number) => held[groupCountAt(entries, slots, group, slot)],
    put: (group: number, slot: number, cursor: number) => {
      held[groupOffsetAt(slots, group, slot)] = cursor
    },
    result: (totals: Uint32Array): PrefixResult => ({ totals, offsets: held.slice(0, entries) }),
  }
}

export function prefixSerial(
  overflow: boolean,
  slotUsed: Uint32Array,
  groups: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots)
  const run = prefixRun(groups, groupCount, slots)
  if (overflow) return run.result(totals)
  let slotStart = 0
  for (let slot = 0; slot < slots; slot++) {
    if (slotUsed[slot] === 0) continue
    let total = 0
    for (let group = 0; group < groupCount; group++) total = U32(total + run.count(group, slot))
    let cursor = slotStart
    for (let group = 0; group < groupCount; group++) {
      run.put(group, slot, cursor)
      cursor = U32(cursor + run.count(group, slot))
    }
    totals[slot] = total
    slotStart = U32(slotStart + total)
  }
  return run.result(totals)
}

export function prefixScan(
  overflow: boolean,
  slotUsed: Uint32Array,
  groups: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots)
  const at = prefixRun(groups, groupCount, slots)
  if (overflow) return at.result(totals)
  const run = Math.floor((groupCount + WORKGROUP - 1) / WORKGROUP)
  const first = (lane: number) => Math.min(lane * run, groupCount)
  const last = (lane: number) => Math.min(first(lane) + run, groupCount)
  let start = 0
  for (let slot = 0; slot < slots; slot++) {
    if (slotUsed[slot] === 0) continue
    const sums = new Uint32Array(WORKGROUP)
    for (let lane = 0; lane < WORKGROUP; lane++)
      for (let group = first(lane); group < last(lane); group++)
        sums[lane] = U32(sums[lane] + at.count(group, slot))
    const lanes = Uint32Array.from(sums)
    // Hillis-Steele: every lane reads `step` below, a barrier, then every lane adds.
    for (let step = 1; step < WORKGROUP; step <<= 1) {
      const below = lanes.map((_, lane) => (lane >= step ? lanes[lane - step] : 0))
      for (let lane = 0; lane < WORKGROUP; lane++) lanes[lane] = U32(lanes[lane] + below[lane])
    }
    const total = lanes[WORKGROUP - 1]
    for (let lane = 0; lane < WORKGROUP; lane++) {
      let cursor = U32(start + lanes[lane] - sums[lane])
      for (let group = first(lane); group < last(lane); group++) {
        at.put(group, slot, cursor)
        cursor = U32(cursor + at.count(group, slot))
      }
    }
    totals[slot] = total
    start = U32(start + total)
  }
  return at.result(totals)
}

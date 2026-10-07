import { grown } from '../../page/cut/sparseInts.ts'
import { ADMISSION_BUCKETS } from '../../gpu/dag/request.ts'

/** What admission reads of a readback: its requests, in the GPU's order, whether that order is
 *  admission's (`admitByLevel`, coarsest level first) or the cut's own, and, ranked by admission,
 *  how many requests each admission bucket holds (`SelectionResult.levelCounts`). */
type Requests = {
  readonly uniforms: { readonly admitByLevel?: boolean }
  readonly result: { readonly pageIds: ArrayLike<number>; readonly levelCounts?: Uint32Array }
}
/** What admission reads of the views' cuts: each view's readback last adopted, a drawn capture's
 *  apart — ranked first (#268) — (`../cut/publication.ts`, `viewReadbacks`). */
export type ViewReadbacks = {
  readonly cuts: readonly Requests[]
  readonly first: Requests | null
}
type Merged = { ids: Int32Array; levels: Int32Array; count: number; first: number }

/**
 * The views' requests as one list, merged level by level (`requestAdmission.ts`): each view's in
 * the GPU's order, which ranks a short pool's coarsest level first (`../../gpu/dag/request.ts`), so
 * the merge only interleaves them; a capture's lead, lifted above every level of the union. No
 * list is sorted. Lists ranked by admission come with each bucket's count: the merge copies them
 * level by level, a block a view, and reads no request's level; a list in the cut's own order (the
 * readback before the pool turned short) is interleaved by `levelOf`, a request's admission level.
 * `bucketLevel` is the admission level of a bucket.
 */
export function createReadbackMerge(
  levelOf: (id: number) => number,
  bucketLevel: (bucket: number) => number,
) {
  const merged: Merged = { ids: new Int32Array(0), levels: new Int32Array(0), count: 0, first: 0 }
  let heads = new Int32Array(4)
  /** Merges `readbacks`, a capture's lifted by `lift`: `ids`, `levels`, `count`, and `first`, the
   *  ranks the capture's list leads with. */
  const merge = ({ cuts, first }: ViewReadbacks, lift: number) => {
    merged.first = first?.result.pageIds.length ?? 0
    let total = merged.first
    for (const cut of cuts) total += cut.result.pageIds.length
    if (merged.ids.length < total) {
      merged.ids = grown(merged.ids, total)
      merged.levels = grown(merged.levels, total)
    }
    if (heads.length < cuts.length) heads = new Int32Array(cuts.length)
    const counted = cuts.every(countedWhole) && (!first || countedWhole(first))
    if (counted) {
      const at = first ? byBuckets(merged, [first], heads, 0, lift, bucketLevel) : 0
      merged.count = byBuckets(merged, cuts, heads, at, 0, bucketLevel)
    } else {
      const at = first ? byLevelOf(merged, [first], heads, 0, lift, levelOf) : 0
      merged.count = byLevelOf(merged, cuts, heads, at, 0, levelOf)
    }
    return merged
  }
  return { merge, merged }
}

/** True when `cut` is ranked by admission and its counts name each of its requests. */
function countedWhole({ uniforms, result }: Requests) {
  const counts = result.levelCounts
  if (!uniforms.admitByLevel || !counts) return false
  let total = 0
  for (let b = 0; b < ADMISSION_BUCKETS; b++) total += counts[b]
  return total === result.pageIds.length
}

/** `cuts` merged at `at`, the coarsest bucket first, each view's block of a bucket in view order —
 *  what interleaving by level gives —, lifted by `lift`; returns the next free rank. */
function byBuckets(
  merged: Merged,
  cuts: readonly Requests[],
  heads: Int32Array,
  at: number,
  lift: number,
  bucketLevel: (bucket: number) => number,
) {
  heads.fill(0, 0, cuts.length)
  for (let b = ADMISSION_BUCKETS - 1; b >= 0; b--) {
    const level = bucketLevel(b) + lift
    for (let c = 0; c < cuts.length; c++) {
      const { pageIds, levelCounts } = cuts[c].result,
        end = heads[c] + levelCounts![b]
      for (let s = heads[c]; s < end; s++, at++) {
        merged.ids[at] = pageIds[s]
        merged.levels[at] = level
      }
      heads[c] = end
    }
  }
  return at
}

/** `cuts` merged at `at` by each head's level (`levelOf`), the highest first, the first view on a
 *  tie, lifted by `lift`; returns the next free rank. */
function byLevelOf(
  merged: Merged,
  cuts: readonly Requests[],
  heads: Int32Array,
  at: number,
  lift: number,
  levelOf: (id: number) => number,
) {
  heads.fill(0, 0, cuts.length)
  for (;;) {
    let best = -1,
      bestLevel = -1
    for (let c = 0; c < cuts.length; c++) {
      const ids = cuts[c].result.pageIds
      if (heads[c] >= ids.length) continue
      const level = levelOf(ids[heads[c]])
      if (level <= bestLevel) continue
      best = c
      bestLevel = level
    }
    if (best < 0) return at
    merged.ids[at] = cuts[best].result.pageIds[heads[best]++]
    merged.levels[at++] = bestLevel + lift
  }
}

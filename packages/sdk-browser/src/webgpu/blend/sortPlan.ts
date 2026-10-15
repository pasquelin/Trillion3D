import { planItem } from './plan.ts'
import { precedes } from './paintOrder.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'

/**
 * FAR-TO-NEAR SORT OF SEEDS ON THE CPU (`order.ts`).
 *
 * The GPU sorts every entry of a pass (`orderWgsl.ts`); the CPU sorts only what it must encode by
 * itself — the own entries, each its own draw (`runs.ts`) — and the CPU model sorts the whole pass
 * (`expandCpu.fixture.ts`). It sorts seed indices: a seed's key is its item's, and the seed itself
 * breaks equal keys, as on the GPU.
 *
 * One NATURAL merge sort under the total order `precedes`: one walk finds the runs already in paint
 * order, then neighbouring runs are merged bottom-up. A list the previous frame left sorted — a
 * still or slow camera — is one run: `n − 1` comparisons and no copy; a camera jump costs at most
 * `n·log₂n`, so its cost has one bound. Keys are gathered once into a flat array aligned with the
 * order and moved with it: the merge compares numbers in contiguous memory instead of following a
 * seed to its item.
 */
let sortKeys = new Float64Array(0),
  mergeKeys = new Float64Array(0),
  mergeOrder = new Uint32Array(0),
  runStarts = new Uint32Array(0)

function growSortScratch(n: number) {
  if (sortKeys.length >= n) return
  const size = grownLength(sortKeys.length, n)
  sortKeys = new Float64Array(size)
  mergeKeys = new Float64Array(size)
  mergeOrder = new Uint32Array(size)
  runStarts = new Uint32Array(size + 1)
}

/** Merges the runs `[lo, mid)` and `[mid, hi)` of `fromO`/`fromK` into `toO`/`toK`, stably: the
 *  right entry goes first only when it strictly precedes the left one. */
function mergeRuns(
  fromO: Uint32Array,
  fromK: Float64Array,
  toO: Uint32Array,
  toK: Float64Array,
  lo: number,
  mid: number,
  hi: number,
) {
  let i = lo,
    j = mid,
    k = lo
  while (i < mid && j < hi) {
    const from = precedes(fromK[i], fromO[i], fromK[j], fromO[j]) ? j++ : i++
    toO[k] = fromO[from]
    toK[k++] = fromK[from]
  }
  for (; i < mid; i++, k++) {
    toO[k] = fromO[i]
    toK[k] = fromK[i]
  }
  for (; j < hi; j++, k++) {
    toO[k] = fromO[j]
    toK[k] = fromK[j]
  }
}

/** Sorts `order` — seed indices of `seeds` — in place by `keys`, one per item by source rank. */
export function sortSeedsFarToNear(order: Uint32Array, seeds: Uint32Array, keys: Float64Array) {
  const n = order.length
  if (n < 2) return
  growSortScratch(n)
  for (let k = 0; k < n; k++) sortKeys[k] = keys[planItem(seeds[order[k]])]
  // The runs already in paint order: a new one where an entry must recede behind the next.
  let runs = 0
  runStarts[runs++] = 0
  for (let i = 1; i < n; i++)
    if (precedes(sortKeys[i - 1], order[i - 1], sortKeys[i], order[i])) runStarts[runs++] = i
  if (runs === 1) return
  runStarts[runs] = n
  let srcO: Uint32Array = order,
    srcK = sortKeys,
    dstO: Uint32Array = mergeOrder,
    dstK = mergeKeys
  while (runs > 1) {
    let merged = 0
    for (let r = 0; r < runs; r += 2) {
      const lo = runStarts[r],
        mid = runStarts[Math.min(r + 1, runs)],
        hi = runStarts[Math.min(r + 2, runs)]
      mergeRuns(srcO, srcK, dstO, dstK, lo, mid, hi)
      runStarts[merged++] = lo
    }
    runStarts[merged] = n
    runs = merged
    ;[srcO, dstO] = [dstO, srcO]
    ;[srcK, dstK] = [dstK, srcK]
  }
  if (srcO !== order) order.set(srcO.subarray(0, n))
}

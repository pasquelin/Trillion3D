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
 * One bottom-up merge sort under the total order `precedes`: `n·log₂n` comparisons whatever the
 * previous frame left — a small step or a camera jump —, so the result is the one sorted list and
 * its cost has one bound. Keys are gathered once into a flat array aligned with the order and moved
 * with it: the merge compares numbers in contiguous memory instead of following a seed to its item.
 */
let sortKeys = new Float64Array(0),
  mergeKeys = new Float64Array(0),
  mergeOrder = new Uint32Array(0)

function growSortScratch(n: number) {
  if (sortKeys.length >= n) return
  const size = grownLength(sortKeys.length, n)
  sortKeys = new Float64Array(size)
  mergeKeys = new Float64Array(size)
  mergeOrder = new Uint32Array(size)
}

/** Bottom-up stable merge sort of `order` with its aligned keys, on `[0, n)`. */
function mergeSortSeeds(order: Uint32Array, n: number) {
  let srcO: Uint32Array = order,
    srcK = sortKeys,
    dstO: Uint32Array = mergeOrder,
    dstK = mergeKeys
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n),
        hi = Math.min(lo + 2 * width, n)
      let i = lo,
        j = mid,
        k = lo
      while (i < mid && j < hi) {
        // Right goes first only when it strictly precedes left: equal entries keep their order.
        const from = precedes(srcK[i], srcO[i], srcK[j], srcO[j]) ? j++ : i++
        dstO[k] = srcO[from]
        dstK[k++] = srcK[from]
      }
      for (; i < mid; i++, k++) {
        dstO[k] = srcO[i]
        dstK[k] = srcK[i]
      }
      for (; j < hi; j++, k++) {
        dstO[k] = srcO[j]
        dstK[k] = srcK[j]
      }
    }
    const o = srcO,
      kk = srcK
    srcO = dstO
    srcK = dstK
    dstO = o
    dstK = kk
  }
  if (srcO !== order) order.set(srcO.subarray(0, n))
}

/** Sorts `order` — seed indices of `seeds` — in place by `keys`, one per item by source rank. */
export function sortSeedsFarToNear(order: Uint32Array, seeds: Uint32Array, keys: Float64Array) {
  const n = order.length
  if (n < 2) return
  growSortScratch(n)
  for (let k = 0; k < n; k++) sortKeys[k] = keys[planItem(seeds[order[k]])]
  mergeSortSeeds(order, n)
}

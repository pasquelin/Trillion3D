import { planItem } from './plan.ts';

/**
 * FAR-TO-NEAR SORT OF SEEDS ON THE CPU, on the order the previous frame left (`order.ts`).
 *
 * The GPU sorts every entry of a pass (`orderWgsl.ts`); the CPU sorts only what it must encode by
 * itself — the own entries, each its own draw (`runs.ts`) — and, on a device without a compute
 * stage, the whole pass for the CPU model (`expandCpu.ts`). It sorts seed indices: a seed's key is
 * its item's, and the seed itself breaks equal keys, as on the GPU.
 *
 * A camera that moves little leaves the list almost sorted: insertion takes it back in one walk
 * and a few shifts. A camera jump (a teleport, a cut, a respawn) makes insertion quadratic: past a
 * shift budget proportional to the list, the sort hands over to a STABLE merge sort. Both sort
 * under the same total order, so both reach the one sorted list — bit-identical.
 *
 * Keys are gathered once into a flat array aligned with the order and shifted with it: the inner
 * loop compares numbers in contiguous memory instead of following a seed to its item.
 */
const SHIFT_BUDGET_PER_ENTRY = 8,
  SHIFT_BUDGET_FLOOR = 256;

/**
 * Total order every path produces: decreasing key, then increasing rank — the GPU's and the CPU
 * model's rank is the seed, the fallback pass's the item, both in source order.
 *
 * Rank breaks equal keys, so the result depends neither on the previous frame, nor on arrival
 * order, nor on the machine — two overlapping items cannot swap from one frame to the next, so
 * the image does not flicker. A NaN key — a non-finite eye or item position — ranks farthest,
 * NaN keys among themselves by rank: compared as it is, a NaN would answer false both ways and
 * leave the entry wherever the previous frame had put it. `true` says the already-placed entry
 * must recede.
 */
export function precedes(keyA: number, rankA: number, keyB: number, rankB: number) {
  if (keyA === keyB) return rankA > rankB;
  if (keyB !== keyB) return keyA === keyA || rankA > rankB;
  return keyA < keyB;
}

let sortKeys = new Float64Array(0),
  mergeKeys = new Float64Array(0),
  mergeOrder = new Uint32Array(0);

function growSortScratch(n: number) {
  if (sortKeys.length >= n) return;
  const size = Math.max(n, sortKeys.length * 2);
  sortKeys = new Float64Array(size);
  mergeKeys = new Float64Array(size);
  mergeOrder = new Uint32Array(size);
}

/** Bottom-up stable merge sort of `order` with its aligned keys, on `[0, n)`. */
function mergeSortSeeds(order: Uint32Array, n: number) {
  let srcO: Uint32Array = order,
    srcK = sortKeys,
    dstO: Uint32Array = mergeOrder,
    dstK = mergeKeys;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n),
        hi = Math.min(lo + 2 * width, n);
      let i = lo,
        j = mid,
        k = lo;
      while (i < mid && j < hi) {
        // Right goes first only when it strictly precedes left: equal entries keep their order.
        const from = precedes(srcK[i], srcO[i], srcK[j], srcO[j]) ? j++ : i++;
        dstO[k] = srcO[from];
        dstK[k++] = srcK[from];
      }
      for (; i < mid; i++, k++) {
        dstO[k] = srcO[i];
        dstK[k] = srcK[i];
      }
      for (; j < hi; j++, k++) {
        dstO[k] = srcO[j];
        dstK[k] = srcK[j];
      }
    }
    const o = srcO,
      kk = srcK;
    srcO = dstO;
    srcK = dstK;
    dstO = o;
    dstK = kk;
  }
  if (srcO !== order) order.set(srcO.subarray(0, n));
}

/** Sorts `order` — seed indices of `seeds` — in place by `keys`, one per item by source rank. */
export function sortSeedsFarToNear(order: Uint32Array, seeds: Uint32Array, keys: Float64Array) {
  const n = order.length;
  if (n < 2) return;
  growSortScratch(n);
  const sorted = sortKeys;
  for (let k = 0; k < n; k++) sorted[k] = keys[planItem(seeds[order[k]])];
  let budget = SHIFT_BUDGET_PER_ENTRY * n + SHIFT_BUDGET_FLOOR;
  for (let i = 1; i < n; i++) {
    const moved = order[i],
      movedKey = sorted[i];
    let j = i - 1;
    while (j >= 0 && precedes(sorted[j], order[j], movedKey, moved)) {
      order[j + 1] = order[j];
      sorted[j + 1] = sorted[j];
      j--;
    }
    // One question per entry, not one write per shift.
    if (j + 1 === i) continue;
    order[j + 1] = moved;
    sorted[j + 1] = movedKey;
    budget -= i - j - 1;
    // `[0, i]` is sorted, the rest is the previous frame's: the stable merge of the whole is the
    // same sorted list insertion would have reached.
    if (budget < 0) return mergeSortSeeds(order, n);
  }
}

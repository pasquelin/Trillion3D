import { planItem } from './plan.ts';

/**
 * FAR-TO-NEAR SORT OF A PASS'S PLAN, on the buffer the previous frame left (`order.ts`).
 *
 * The order is `precedes`. Both entries of a double-sided item drawn in two passes carry the same
 * rank: they never overtake each other, and the back stays in front of the face.
 *
 * A camera that moves little leaves the list almost sorted: insertion takes it back in one walk
 * and a few shifts. A camera jump (a teleport, a cut, a respawn) makes insertion quadratic: past a
 * shift budget proportional to the list, the sort hands over to a STABLE merge sort. Insertion is
 * itself stable, and both sort the same sequence under the same preorder, so both reach the one
 * stable order — bit-identical. A NaN key breaks the preorder (it compares equal to everything):
 * the budget is then infinite and insertion alone decides, exactly as before.
 *
 * Keys and ranks are gathered once into two flat arrays aligned with the order and shifted with
 * it: the inner loop compares numbers in contiguous memory instead of following an entry to its
 * item.
 */
const SHIFT_BUDGET_PER_ENTRY = 8,
  SHIFT_BUDGET_FLOOR = 256;

/**
 * Total order both paths produce (`order.ts`): decreasing key, then increasing source rank.
 *
 * Rank breaks equal keys, so the result depends neither on the previous frame, nor on arrival
 * order, nor on the machine — two overlapping items cannot swap from one frame to the next, so
 * the image does not flicker. `true` says the already-placed entry must recede.
 */
export const precedes = (keyA: number, rankA: number, keyB: number, rankB: number) =>
  keyA < keyB || (keyA === keyB && rankA > rankB);

let sortKeys = new Float64Array(0),
  sortRanks = new Uint32Array(0),
  mergeKeys = new Float64Array(0),
  mergeRanks = new Uint32Array(0),
  mergeEntries = new Uint32Array(0);

function growSortScratch(n: number) {
  if (sortKeys.length >= n) return;
  const size = Math.max(n, sortKeys.length * 2);
  sortKeys = new Float64Array(size);
  sortRanks = new Uint32Array(size);
  mergeKeys = new Float64Array(size);
  mergeRanks = new Uint32Array(size);
  mergeEntries = new Uint32Array(size);
}

/** Bottom-up stable merge sort of `order`, with its aligned keys and ranks, on `[0, n)`. */
function mergeSortPlan(order: Uint32Array, n: number) {
  let srcE: Uint32Array = order,
    srcK = sortKeys,
    srcR = sortRanks,
    dstE: Uint32Array = mergeEntries,
    dstK = mergeKeys,
    dstR = mergeRanks;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n),
        hi = Math.min(lo + 2 * width, n);
      let i = lo,
        j = mid,
        k = lo;
      while (i < mid && j < hi) {
        // Right goes first only when it strictly precedes left: equal entries keep their order.
        const from = precedes(srcK[i], srcR[i], srcK[j], srcR[j]) ? j++ : i++;
        dstE[k] = srcE[from];
        dstK[k] = srcK[from];
        dstR[k++] = srcR[from];
      }
      for (; i < mid; i++, k++) {
        dstE[k] = srcE[i];
        dstK[k] = srcK[i];
        dstR[k] = srcR[i];
      }
      for (; j < hi; j++, k++) {
        dstE[k] = srcE[j];
        dstK[k] = srcK[j];
        dstR[k] = srcR[j];
      }
    }
    const e = srcE,
      kk = srcK,
      rr = srcR;
    srcE = dstE;
    srcK = dstK;
    srcR = dstR;
    dstE = e;
    dstK = kk;
    dstR = rr;
  }
  if (srcE !== order) order.set(srcE.subarray(0, n));
}

/**
 * Sorts `order` in place by `keys`, one per item by source rank; a NaN key keeps pure insertion.
 * Returns the first position the sort rewrote, `order.length` when nothing moved: the runs before
 * it still describe the list (`runs.ts`).
 */
export function sortPlanFarToNear(order: Uint32Array, keys: Float64Array) {
  const n = order.length;
  if (n < 2) return n;
  growSortScratch(n);
  const sorted = sortKeys,
    ranks = sortRanks;
  let ordered = true;
  for (let k = 0; k < n; k++) {
    const rank = planItem(order[k]),
      key = keys[rank];
    sorted[k] = key;
    ranks[k] = rank;
    if (key !== key) ordered = false;
  }
  let budget = ordered ? SHIFT_BUDGET_PER_ENTRY * n + SHIFT_BUDGET_FLOOR : Infinity;
  let first = n;
  for (let i = 1; i < n; i++) {
    const entry = order[i],
      movedKey = sorted[i],
      movedRank = ranks[i];
    let j = i - 1;
    while (j >= 0) {
      const heldKey = sorted[j];
      if (!precedes(heldKey, ranks[j], movedKey, movedRank)) break;
      order[j + 1] = order[j];
      sorted[j + 1] = heldKey;
      ranks[j + 1] = ranks[j];
      j--;
    }
    // One question per entry, not one write per shift.
    if (j + 1 === i) continue;
    order[j + 1] = entry;
    sorted[j + 1] = movedKey;
    ranks[j + 1] = movedRank;
    if (j + 1 < first) first = j + 1;
    budget -= i - j - 1;
    if (budget < 0) {
      // `[0, i]` is sorted, the rest is the previous frame's: the stable merge of the whole is
      // the same stable order insertion would have reached. Where it first differs is unknown.
      mergeSortPlan(order, n);
      return 0;
    }
  }
  return first;
}

import { planItem } from './plan.ts';

/**
 * FAR-TO-NEAR SORT OF A PASS'S PLAN, on the buffer the previous frame left (`order.ts`).
 *
 * The order is decreasing key, then increasing source rank: the rank breaks equal keys, so two
 * overlapping items cannot swap from one frame to the next. Both entries of a double-sided item
 * drawn in two passes carry the same rank: they never overtake each other, and the back stays in
 * front of the face.
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

/** Key of each ITEM, by source rank: written by the key walk, read by the gather below. */
let itemKeys = new Float64Array(0);
let sortKeys = new Float64Array(0),
  sortRanks = new Uint32Array(0),
  mergeKeys = new Float64Array(0),
  mergeRanks = new Uint32Array(0),
  mergeEntries = new Uint32Array(0);

/** The per-item key array, at least `count` long: the key walk fills it before a sort. */
export function planKeys(count: number) {
  if (itemKeys.length < count) itemKeys = new Float64Array(Math.max(count, itemKeys.length * 2));
  return itemKeys;
}

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
        const kl = srcK[i],
          kr = srcK[j];
        const from = kl < kr || (kl === kr && srcR[i] > srcR[j]) ? j++ : i++;
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
 * Sorts `order` in place by the keys `planKeys` holds; `ordered` false (a NaN key) keeps pure
 * insertion. Returns the first position the sort rewrote, `order.length` when nothing moved: the
 * runs before it still describe the list (`runs.ts`).
 */
export function sortPlanFarToNear(order: Uint32Array, ordered: boolean) {
  const n = order.length;
  if (n < 2) return n;
  growSortScratch(n);
  const keys = sortKeys,
    ranks = sortRanks,
    byItem = itemKeys;
  for (let k = 0; k < n; k++) {
    const rank = planItem(order[k]);
    keys[k] = byItem[rank];
    ranks[k] = rank;
  }
  let budget = ordered ? SHIFT_BUDGET_PER_ENTRY * n + SHIFT_BUDGET_FLOOR : Infinity;
  let first = n;
  for (let i = 1; i < n; i++) {
    const entry = order[i],
      movedKey = keys[i],
      movedRank = ranks[i];
    let j = i - 1;
    while (j >= 0) {
      const heldKey = keys[j];
      if (!(heldKey < movedKey || (heldKey === movedKey && ranks[j] > movedRank))) break;
      order[j + 1] = order[j];
      keys[j + 1] = heldKey;
      ranks[j + 1] = ranks[j];
      j--;
    }
    // One question per entry, not one write per shift.
    if (j + 1 === i) continue;
    order[j + 1] = entry;
    keys[j + 1] = movedKey;
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

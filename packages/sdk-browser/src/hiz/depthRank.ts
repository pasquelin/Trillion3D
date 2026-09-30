// The depth rank of the Hi-Z occluder split (`split.ts`): the boxes in front of the near plane,
// nearest first, by a stable radix sort on their depth's sortable bits.
import { HIZ_BOUNDS_VALUES } from './corners.ts';

let splitLow = new Uint32Array(0),
  splitHigh = new Uint32Array(0),
  splitOrder = new Uint32Array(0),
  splitScratch = new Uint32Array(0);
const splitCounts = new Uint32Array(256);
const splitKeyDouble = new Float64Array(1),
  splitKeyWords = new Uint32Array(splitKeyDouble.buffer);

/**
 * Sortable keys of boxes that do not clip the near plane, and their count; `splitOrder[0..n-1]`
 * carries their indices in candidate order. Sortable image of a double: every bit of a negative
 * inverted, the sign bit of a positive set, so the unsigned comparison of (high, low) yields
 * the order of the doubles.
 *
 * Engine depth is REVERSE-Z: nearest carries the greatest depth. The key is therefore that of
 * its OPPOSITE, so the increasing order of keys stays nearest to farthest — and everything that
 * follows (stable sort, rank selection) does not change by a line.
 */
function chargeCles(count: number, bounds: Float64Array) {
  if (splitLow.length < count) {
    splitLow = new Uint32Array(count);
    splitHigh = new Uint32Array(count);
    splitOrder = new Uint32Array(count);
    splitScratch = new Uint32Array(count);
  }
  let inFront = 0;
  for (let i = 0; i < count; i++) {
    if (bounds[i * HIZ_BOUNDS_VALUES + 5] !== 0) continue;
    splitKeyDouble[0] = -bounds[i * HIZ_BOUNDS_VALUES + 4];
    const low = splitKeyWords[0],
      high = splitKeyWords[1];
    const negative = (high & 0x80000000) !== 0;
    splitLow[i] = negative ? ~low >>> 0 : low;
    splitHigh[i] = negative ? ~high >>> 0 : (high ^ 0x80000000) >>> 0;
    splitOrder[inFront++] = i;
  }
  return inFront;
}

/**
 * Ranks the same boxes by depth, nearest to farthest: `order[0..inFront-1]` their indices. Stable
 * radix sort, no allocation: equal depths therefore fall back on candidate order, exactly like
 * `a.nearest-b.nearest||a.index-b.index`. `order` is reused by the next call.
 */
export function rankByDepth(count: number, bounds: Float64Array) {
  const inFront = chargeCles(count, bounds);
  if (!inFront) return { inFront, order: splitOrder };
  let order = splitOrder,
    scratch = splitScratch;
  for (let pass = 0; pass < 8; pass++) {
    const keys = pass < 4 ? splitLow : splitHigh,
      shift = (pass & 3) * 8;
    splitCounts.fill(0);
    for (let i = 0; i < inFront; i++) splitCounts[(keys[order[i]] >>> shift) & 255]++;
    let total = 0;
    for (let digit = 0; digit < 256; digit++) {
      const n = splitCounts[digit];
      splitCounts[digit] = total;
      total += n;
    }
    for (let i = 0; i < inFront; i++) {
      const index = order[i];
      scratch[splitCounts[(keys[index] >>> shift) & 255]++] = index;
    }
    const swap = order;
    order = scratch;
    scratch = swap;
  }
  splitOrder = order;
  splitScratch = scratch;
  return { inFront, order };
}

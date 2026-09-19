import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';
import { boundsFor, projectBoxesFlat } from './hizProjection.ts';
import type { HizPage } from './hizTypes.ts';
import type { EngineCamera } from './cameraWorld.ts';

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
 * Ranks the same boxes by depth, nearest to farthest. Stable radix sort, no allocation: equal
 * depths therefore fall back on candidate order, exactly like
 * `a.nearest-b.nearest||a.index-b.index`.
 */
function rangParProfondeur(count: number, bounds: Float64Array) {
  const inFront = chargeCles(count, bounds);
  if (!inFront) return 0;
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
  return inFront;
}

/**
 * The nearest half becomes the frame's occluders: `rest[i]` is 0 for an occluder and 1 otherwise,
 * and the occluder count is returned. Boxes that clip the near plane stay in the rest, where they
 * cannot hide any other.
 *
 * Only the set of this half is read, never its order: what is needed is therefore a selection,
 * not a sort. It walks bytes from strongest to weakest, marks whole buckets that fit under the
 * sought rank in one go and only descends into the one that contains it — one pass over every
 * candidate, then over one in two hundred and fifty-six on average, instead of eight scatter
 * passes. The returned set is that of the stable sort, term for term: everything strictly
 * nearer than the rank key, then the first equal keys in candidate order — the order bucket
 * partition keeps, as the stable sort kept it.
 */
export function splitOccludersFlat(count: number, bounds: Float64Array, rest: Uint8Array) {
  for (let i = 0; i < count; i++) rest[i] = 1;
  let inFront = chargeCles(count, bounds);
  if (!inFront) return 0;
  const occluders = Math.max(1, Math.floor(inFront / 2));
  let need = occluders,
    pool = splitOrder,
    scratch = splitScratch;
  for (let pass = 7; pass >= 0 && need > 0; pass--) {
    const keys = pass < 4 ? splitLow : splitHigh,
      shift = (pass & 3) * 8;
    splitCounts.fill(0);
    for (let i = 0; i < inFront; i++) splitCounts[(keys[pool[i]] >>> shift) & 255]++;
    // Bucket of the sought rank: all those before it fit entirely below.
    let below = 0,
      digit = 0;
    for (; digit < 255 && below + splitCounts[digit] < need; digit++) below += splitCounts[digit];
    let kept = 0;
    for (let i = 0; i < inFront; i++) {
      const index = pool[i],
        d = (keys[index] >>> shift) & 255;
      if (d < digit) rest[index] = 0;
      else if (d === digit) scratch[kept++] = index;
    }
    need -= below;
    const swap = pool;
    pool = scratch;
    scratch = swap;
    inFront = kept;
  }
  // What remains has the same eight bytes: candidate order breaks ties, as in the sort.
  for (let i = 0; i < need; i++) rest[pool[i]] = 0;
  splitOrder = pool;
  splitScratch = scratch;
  return occluders;
}

/**
 * The same split, returned as pages rather than flags: `occluders` receives the nearest half in
 * sort order, `rest` the rest of the sort then the near-plane clips in candidate order. No page
 * is projected twice and nothing is allocated per frame.
 */
export function splitOccludersInto<T extends HizPage>(
  pages: T[],
  cam: EngineCamera,
  viewport: [number, number],
  occluders: T[],
  rest: T[],
) {
  occluders.length = 0;
  rest.length = 0;
  const count = pages.length,
    bounds = boundsFor(count);
  projectBoxesFlat(pages, count, cam, viewport, bounds);
  const inFront = rangParProfondeur(count, bounds);
  if (!inFront) {
    for (let i = 0; i < count; i++) rest.push(pages[i]);
    return 0;
  }
  const mid = Math.max(1, Math.floor(inFront / 2));
  for (let i = 0; i < mid; i++) occluders.push(pages[splitOrder[i]]);
  for (let i = mid; i < inFront; i++) rest.push(pages[splitOrder[i]]);
  for (let i = 0; i < count; i++) if (bounds[i * HIZ_BOUNDS_VALUES + 5] !== 0) rest.push(pages[i]);
  return mid;
}

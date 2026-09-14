import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';
import { projectBoxToScreen } from './hizProjection.ts';
import type { HizBounds, HizPage } from './hizTypes.ts';

let splitLow = new Uint32Array(0),
  splitHigh = new Uint32Array(0),
  splitOrder = new Uint32Array(0),
  splitScratch = new Uint32Array(0);
const splitCounts = new Uint32Array(256);
const splitKeyDouble = new Float64Array(1),
  splitKeyWords = new Uint32Array(splitKeyDouble.buffer);
/**
 * `splitOccluders` over the flat bounds `projectBoxesFlat` wrote, without allocating and without any
 * frame history: `rest[i]` becomes 0 for an occluder and 1 otherwise, and the occluder count is
 * returned. The order is the sorting twin's to the bit — a stable radix over the orderable image of
 * the double `nearestDepth`, so equal depths fall back to the candidate order exactly as
 * `a.nearest-b.nearest||a.index-b.index` does.
 */
export function splitOccludersFlat(count: number, bounds: Float64Array, rest: Uint8Array) {
  if (splitLow.length < count) {
    splitLow = new Uint32Array(count);
    splitHigh = new Uint32Array(count);
    splitOrder = new Uint32Array(count);
    splitScratch = new Uint32Array(count);
  }
  let inFront = 0;
  for (let i = 0; i < count; i++) {
    rest[i] = 1;
    if (bounds[i * HIZ_BOUNDS_VALUES + 5] !== 0) continue;
    splitKeyDouble[0] = bounds[i * HIZ_BOUNDS_VALUES + 4];
    const low = splitKeyWords[0],
      high = splitKeyWords[1];
    // Orderable image of a double: flip every bit of a negative, set the sign bit of a positive.
    const negative = (high & 0x80000000) !== 0;
    splitLow[i] = negative ? ~low >>> 0 : low;
    splitHigh[i] = negative ? ~high >>> 0 : (high ^ 0x80000000) >>> 0;
    splitOrder[inFront++] = i;
  }
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
  const occluders = Math.max(1, Math.floor(inFront / 2));
  for (let i = 0; i < occluders; i++) rest[order[i]] = 0;
  return occluders;
}

/** In-front closer half becomes this-frame occluders. Near-plane crossings stay in rest so they cannot hide others. */
export function splitOccluders<T extends HizPage>(
  pages: T[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  boundsMap?: Map<T, HizBounds>,
) {
  const ranked = pages.map((page, index) => {
    const bounds =
      boundsMap?.get(page) ?? projectBoxToScreen(page.min, page.max, page.matrix, camera, viewport);
    if (boundsMap) boundsMap.set(page, bounds);
    return { page, index, nearest: bounds.nearestDepth, clipsNear: bounds.clipsNear };
  });
  ranked.sort((a, b) => a.nearest - b.nearest || a.index - b.index);
  const inFront = ranked.filter((item) => !item.clipsNear),
    crossing = ranked.filter((item) => item.clipsNear);
  if (!inFront.length) return { occluders: [] as T[], rest: pages };
  const mid = Math.max(1, Math.floor(inFront.length / 2));
  return {
    occluders: inFront.slice(0, mid).map((item) => item.page),
    rest: [...inFront.slice(mid), ...crossing].map((item) => item.page),
  };
}

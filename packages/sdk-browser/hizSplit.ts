import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';
import { boundsFor, projectBoxesFlat } from './hizProjection.ts';
import type { HizPage } from './hizTypes.ts';

let splitLow = new Uint32Array(0),
  splitHigh = new Uint32Array(0),
  splitOrder = new Uint32Array(0),
  splitScratch = new Uint32Array(0);
const splitCounts = new Uint32Array(256);
const splitKeyDouble = new Float64Array(1),
  splitKeyWords = new Uint32Array(splitKeyDouble.buffer);

/**
 * Classe par profondeur les boîtes qui ne coupent pas le plan proche, et renvoie leur nombre ;
 * `splitOrder[0..n-1]` porte leurs indices, du plus proche au plus lointain. Tri radix stable sur
 * l'image ordonnable du double `nearestDepth`, sans allocation : les profondeurs égales retombent
 * donc sur l'ordre des candidats, exactement comme `a.nearest-b.nearest||a.index-b.index`.
 */
function rangParProfondeur(count: number, bounds: Float64Array) {
  if (splitLow.length < count) {
    splitLow = new Uint32Array(count);
    splitHigh = new Uint32Array(count);
    splitOrder = new Uint32Array(count);
    splitScratch = new Uint32Array(count);
  }
  let inFront = 0;
  for (let i = 0; i < count; i++) {
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
  return inFront;
}

/**
 * La moitié la plus proche devient les occulteurs de l'image : `rest[i]` vaut 0 pour un occulteur et
 * 1 sinon, et le nombre d'occulteurs est renvoyé. Les boîtes qui coupent le plan proche restent dans
 * le reste, où elles ne peuvent en cacher aucune autre.
 */
export function splitOccludersFlat(count: number, bounds: Float64Array, rest: Uint8Array) {
  for (let i = 0; i < count; i++) rest[i] = 1;
  const inFront = rangParProfondeur(count, bounds);
  if (!inFront) return 0;
  const occluders = Math.max(1, Math.floor(inFront / 2));
  for (let i = 0; i < occluders; i++) rest[splitOrder[i]] = 0;
  return occluders;
}

/**
 * Le même partage, rendu en pages plutôt qu'en drapeaux : `occluders` reçoit la moitié la plus
 * proche dans l'ordre du tri, `rest` le reste du tri puis les coupes du plan proche dans l'ordre des
 * candidats. Aucune page n'est projetée deux fois et rien n'est alloué par image.
 */
export function splitOccludersInto<T extends HizPage>(
  pages: T[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  occluders: T[],
  rest: T[],
) {
  occluders.length = 0;
  rest.length = 0;
  const count = pages.length,
    bounds = boundsFor(count);
  projectBoxesFlat(pages, count, camera, viewport, bounds);
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

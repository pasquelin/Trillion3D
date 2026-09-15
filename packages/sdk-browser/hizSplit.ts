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
 * Les clés ordonnables des boîtes qui ne coupent pas le plan proche, et leur nombre ;
 * `splitOrder[0..n-1]` porte leurs indices dans l'ordre des candidats. Image ordonnable d'un double :
 * tous les bits d'un négatif inversés, le bit de signe d'un positif posé, de sorte que la comparaison
 * non signée de (haut, bas) rende l'ordre des doubles.
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
    splitKeyDouble[0] = bounds[i * HIZ_BOUNDS_VALUES + 4];
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
 * Classe par profondeur les mêmes boîtes, du plus proche au plus lointain. Tri radix stable, sans
 * allocation : les profondeurs égales retombent donc sur l'ordre des candidats, exactement comme
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
 * La moitié la plus proche devient les occulteurs de l'image : `rest[i]` vaut 0 pour un occulteur et
 * 1 sinon, et le nombre d'occulteurs est renvoyé. Les boîtes qui coupent le plan proche restent dans
 * le reste, où elles ne peuvent en cacher aucune autre.
 *
 * Seul l'ensemble de cette moitié est lu, jamais son ordre : ce qu'il faut est donc une sélection,
 * pas un tri. Elle descend les octets du plus fort au plus faible, marque d'un coup les seaux entiers
 * qui tiennent sous le rang cherché et ne redescend que dans celui qui le contient — une passe sur
 * tous les candidats, puis sur un sur deux cent cinquante-six en moyenne, au lieu de huit passes de
 * dispersion. L'ensemble rendu est celui du tri stable, terme pour terme : tout ce qui est
 * strictement plus proche que la clé de rang, puis les premières clés égales dans l'ordre des
 * candidats — l'ordre que la partition par seau conserve, comme le tri stable le conservait.
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
    // Le seau du rang cherché : tous ceux d'avant tiennent entièrement dessous.
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
  // Ce qui reste a les mêmes huit octets : l'ordre des candidats départage, comme dans le tri.
  for (let i = 0; i < need; i++) rest[pool[i]] = 0;
  splitOrder = pool;
  splitScratch = scratch;
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

import { HIZ_BOUNDS_VALUES, HIZ_TEST_VALUES, hizTestRectFlat } from './hiz.ts';
import type { HizCountSample } from './gpuHizCounters.ts';

/** What the packer tells the counters about each box, in the same pass that packs it. */
export type HizBoxObserver = {
  observe(index: number, row: number, triangles: number, bounds: Float64Array): void;
};

/**
 * Ce qu'une image laisse à téléverser : les octets de toutes les boîtes, et l'intervalle de celles
 * que cette image a réécrites. `to < from` dit qu'aucune n'a bougé et qu'il n'y a rien à envoyer.
 */
export type HizPackedBoxes = { bytes: ArrayBuffer; from: number; to: number };

/** Vrai quand les six valeurs d'une boîte sont exactement celles d'où ses octets ont été écrits.
 *  `NaN` n'est égal à rien : une borne non finie fait toujours réempaqueter, jamais réutiliser. */
function sameBox(bounds: Float64Array, held: Float64Array, at: number) {
  for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) if (bounds[at + k] !== held[at + k]) return false;
  return true;
}

/**
 * Reuse one typed buffer for the bounds tested in successive frames. A `sample` handed to a call
 * makes that call record every box into `counters` as it packs it, never in a second pass.
 *
 * Les octets d'une boîte sont une fonction de ses six valeurs projetées, de la ligne de drapeau
 * qu'elle renseigne et de la taille de la cible — de rien d'autre. Le paquet précédent est donc gardé
 * avec les entrées dont il a été écrit : une boîte dont les sept entrées n'ont pas bougé porte déjà
 * les octets qu'un réempaquetage lui donnerait, au bit près, et ni le calcul ni le téléversement ne
 * sont refaits. Une caméra immobile ne reprojette rien (`createProjectionHold`), donc aucune boîte ne
 * bouge et l'image n'envoie pas un octet ; une caméra qui tourne les réécrit toutes, comme avant.
 */
export function createHizBoundsPacker(counters?: HizBoxObserver) {
  let bytes = new ArrayBuffer(32);
  let floats = new Float32Array(bytes);
  let ints = new Int32Array(bytes);
  let words = new Uint32Array(bytes);
  // Les entrées d'où les octets tenus ont été écrits, et combien d'entrées de tête les décrivent.
  let heldBounds = new Float64Array(HIZ_BOUNDS_VALUES);
  let heldRows = new Uint32Array(1);
  let held = 0,
    heldWidth = -1,
    heldHeight = -1;
  // The level and clipped rectangle of the box being written, reused by every box of every image.
  const rect = new Int32Array(HIZ_TEST_VALUES);
  const packed: HizPackedBoxes = { bytes, from: 0, to: -1 };
  return (
    bounds: Float64Array,
    rows: Uint32Array,
    count: number,
    width: number,
    height: number,
    sizes: Array<[number, number]>,
    offsets: number[],
    sample?: HizCountSample,
  ) => {
    const need = Math.max(32, count * 32);
    if (bytes.byteLength < need) {
      bytes = new ArrayBuffer(need);
      floats = new Float32Array(bytes);
      ints = new Int32Array(bytes);
      words = new Uint32Array(bytes);
      // Les octets tenus vivaient dans le tampon qu'on vient de remplacer : plus rien n'est tenu.
      held = 0;
    }
    const slots = Math.max(1, count);
    if (heldRows.length < slots) {
      heldBounds = new Float64Array(slots * HIZ_BOUNDS_VALUES);
      heldRows = new Uint32Array(slots);
      held = 0;
    }
    // Le rectangle dépend de la cible autant que de la boîte : un redimensionnement retire tout.
    if (width !== heldWidth || height !== heldHeight) {
      heldWidth = width;
      heldHeight = height;
      held = 0;
    }
    packed.bytes = bytes;
    packed.from = 0;
    packed.to = -1;
    for (let i = 0; i < count; i++) {
      const base = i * 8,
        at = i * HIZ_BOUNDS_VALUES;
      if (sample) counters!.observe(i, rows[i], sample.triangles[i] ?? 0, bounds);
      if (i < held && rows[i] === heldRows[i] && sameBox(bounds, heldBounds, at)) continue;
      // The rectangle handed to the kernel is the one clipped to the viewport, in texels of the mip
      // that covers it exactly; `hizTestRectFlat` is the same call the CPU oracle makes, so the two
      // read the same texels of the same level.
      if (hizTestRectFlat(bounds, at, width, height, sizes.length, rect)) {
        const level = rect[0],
          scale = 2 ** level;
        ints[base] = Math.floor(rect[1] / scale);
        ints[base + 1] = Math.floor(rect[2] / scale);
        ints[base + 2] = Math.floor(rect[3] / scale);
        ints[base + 3] = Math.floor(rect[4] / scale);
        words[base + 5] = (rows[i] << 1) >>> 0;
        words[base + 6] = offsets[level];
        words[base + 7] = sizes[level][0];
      } else {
        ints[base] = ints[base + 1] = ints[base + 2] = ints[base + 3] = 0;
        words[base + 5] = ((rows[i] << 1) | 1) >>> 0;
        words[base + 6] = 0;
        words[base + 7] = width;
      }
      floats[base + 4] = bounds[at + 4];
      for (let k = 0; k < HIZ_BOUNDS_VALUES; k++) heldBounds[at + k] = bounds[at + k];
      heldRows[i] = rows[i];
      if (packed.to < 0) packed.from = i;
      packed.to = i;
    }
    // Les entrées au-delà de `count` gardent leurs octets et leurs entrées : le noyau ne les lit pas,
    // et une image plus large les retrouvera telles quelles.
    if (count > held) held = count;
    return packed;
  };
}

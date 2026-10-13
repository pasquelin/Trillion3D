/**
 * THE BINS OF THE CHUNK BOUND (`rowPageBound.ts`): what a row's (s, e) bin is, the GPU's binning
 * (`rowBinsWgsl.ts`) and the CPU's reading of it alike. s is the light-space Chebyshev distance of
 * the row's box to the reference point less its half-extent e: quarter octaves of s from 1 mm (bin
 * 0 below: inside or touching), half octaves of e, read from the f32 bits — exponent, then the
 * mantissa's top bits: the edges are the floats whose lower bits are zero. Their width only loosens
 * the bound: a row's bin has least s ≤ its s and greatest e ≥ its e.
 *
 * A full-map local light's rows are binned jointly: each row's pairs and faces met summed over the
 * lights and rounded up to an edge (`PAIR_EDGES`, `MEET_EDGES`), so the K heaviest rows are counted
 * once, not once a light. The tables the GPU reads for it are made here once (`rowBinTables`).
 */
import { fromF32Bits, f32Bits } from '../../../math/src/float/bits.ts'
import { VSM_LEVEL0_PAGES, VSM_MIPS } from './constants.ts'

/** Relative room for the GPU's f32 cull: its roundings (2⁻²⁴ each, on magnitudes below the row's
 *  distance to the level centre plus its extent) stay below 2⁻¹⁶ of them while fewer than 256. */
export const ROOM = 2 ** -16
export const S_BINS = 128,
  E_BINS = 64,
  BIN_SPAN = S_BINS * E_BINS
/** One millimetre: the least s and e a bin edge names. */
export const UNIT = 2 ** -10
export const UNIT_BITS = f32Bits(UNIT)
/** The least s of bin j: quarter octaves, the mantissa's two top bits (shift 21). */
export const sLeast = Float64Array.from({ length: S_BINS }, (_, j) =>
  j === 0 ? -Infinity : fromF32Bits(UNIT_BITS + ((j - 1) << 21)),
)
/** The greatest e of bin k: half octaves, the mantissa's top bit (shift 22). */
export const eMost = Float64Array.from({ length: E_BINS }, (_, k) =>
  k === E_BINS - 1 ? Infinity : fromF32Bits(UNIT_BITS + (k << 22)),
)
/** The greatest s and e a row is binned at: the last bins hold any larger. */
export const S_TOP = sLeast[S_BINS - 1],
  E_TOP = eMost[E_BINS - 2]

/** Pages a clipmap level takes a side. */
export const SIDE = VSM_LEVEL0_PAGES
/** Pages a row of half-extent `e` spans a side of a page of `page` metres: ceil(2e / page + 2
 *  pixels) + 1 pages, at most a level's or a mip's `side`. */
export const sideOf = (e: number, page: number, side = SIDE) =>
  Math.min(side, Math.ceil((2 * e) / page + 1 / 64) + 1)

/** Edges of a row's summed pairs: exact to 127, then sixteenth octaves; and of its summed faces
 *  met (commands: 8 a face, one a mip): exact to 63, then eighth octaves. A row's sum takes the
 *  first edge at or above it; the last edges hold any sum. */
export const PAIR_EDGES = Float64Array.from({ length: 512 }, (_, i) =>
  i < 128 ? i : i === 511 ? Number.MAX_SAFE_INTEGER : Math.ceil(128 * 2 ** ((i - 127) / 16)),
)
export const MEET_EDGES = Float64Array.from({ length: 128 }, (_, i) =>
  i < 64 ? i : i === 127 ? Number.MAX_SAFE_INTEGER : Math.ceil(64 * 2 ** ((i - 63) / 8)),
)

/** Pages a row of bin (j, k) takes over a local map's mips, its rect ≤ 4e / (s − 2e) NDC an axis
 *  (a mip of N pages: N/2 a unit), every page of the map when its depth is not positive — the
 *  same for every light. */
function mapPages(j: number, k: number) {
  const e = eMost[k],
    depth = sLeast[j] - 2 * e,
    span = depth > 0 ? Math.min(2, (4 * e) / depth) : 2
  let total = 0
  for (let mip = 0; mip < VSM_MIPS; mip++) {
    const n = SIDE >> mip
    total += sideOf(span / 4, 1 / n, n) ** 2
  }
  return total
}

/** The first s bin past `limit(k)` for each e bin k: the s bins of e bin k at or past it are those
 *  whose least s exceeds the limit. */
function firstPast(limit: (e: number) => number, out: Uint32Array = new Uint32Array(E_BINS)) {
  for (let k = 0; k < E_BINS; k++) {
    let j = 0
    while (j < S_BINS && !(sLeast[j] > limit(eMost[k]))) j++
    out[k] = j
  }
  return out
}

/** Where each table starts in `rowBinTables`' words: the pages first, at 0. */
export const TABLE_DEPTH = BIN_SPAN,
  TABLE_PAIR_EDGES = TABLE_DEPTH + E_BINS,
  TABLE_MEET_EDGES = TABLE_PAIR_EDGES + PAIR_EDGES.length
const TABLE_WORDS = TABLE_MEET_EDGES + MEET_EDGES.length

/**
 * The GPU's tables of the joint bins, the same for every light: per bin (j, k) the pages a face of
 * a local map takes (`mapPages`); per e bin, the first s bin of a positive depth (a point light's
 * row there meets 3 faces, else 6); the pair and face edges, the last held as the greatest word.
 */
export function rowBinTables() {
  const words = new Uint32Array(TABLE_WORDS)
  for (let j = 0; j < S_BINS; j++)
    for (let k = 0; k < E_BINS; k++) words[j * E_BINS + k] = mapPages(j, k)
  firstPast((e) => 2 * e, words.subarray(TABLE_DEPTH, TABLE_DEPTH + E_BINS))
  const edge = (v: number) => Math.min(v, 0xffffffff)
  PAIR_EDGES.forEach((v, i) => (words[TABLE_PAIR_EDGES + i] = edge(v)))
  MEET_EDGES.forEach((v, i) => (words[TABLE_MEET_EDGES + i] = edge(v)))
  return words
}

/** Per e bin, the first s bin past a light of `range` (with its f32 room): its rows there meet no
 *  face of it. */
export const rangeCuts = (range: number, out?: Uint32Array) =>
  firstPast((e) => range * (1 + ROOM) + 2 * e, out)

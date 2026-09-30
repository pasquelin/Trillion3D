import { clampNumber as clamp } from '../../world/math/spherical.ts';
import { PAGE_RANGE_MASK, PAGE_RANGE_SHIFT, SHADOW_PAGE } from './virtual.ts';

/**
 * THE FOOTPRINT A PAGE WAS DRAWN FOR: the texels of it a reader may take (#1250). A page drawn
 * for the receivers the CPU saw (#1211) holds the casters of their footprint alone; a reader
 * outside it — a receiver the GPU cut drew since — reads the page as not drawn: it asks for it
 * and falls back to the coarser level (`shadowPageWord`), never to a shadow missing its casters.
 *
 * It travels in the page's table word, in the bits above its depth-range slot: the shadow buffer
 * is the one binding every shading pass has, the blend stage included. Each edge takes a quarter
 * of those bits, in whole steps of `PAGE_FOOTPRINT_STEP` texels in from its side of the page, so
 * zero is the whole page: the word of a page drawn full is the word it always was.
 */
export const PAGE_FOOTPRINT_SHIFT = PAGE_RANGE_SHIFT + Math.log2(PAGE_RANGE_MASK + 1);
export const PAGE_FOOTPRINT_EDGE_BITS = (32 - PAGE_FOOTPRINT_SHIFT) / 4;
export const PAGE_FOOTPRINT_STEP = SHADOW_PAGE / 2 ** PAGE_FOOTPRINT_EDGE_BITS;
/** A page drawn for all of it. */
export const PAGE_FOOTPRINT_FULL = 0;
/** A page no receiver has named yet: every edge a whole page in, the union's neutral. Drawn so,
 *  it is drawn whole (`footprintDrawn`): what named it, a reader no box holds, may read any texel. */
export const PAGE_FOOTPRINT_EMPTY = 2 ** (4 * PAGE_FOOTPRINT_EDGE_BITS) - 1;
/** A request entry's flag (#1211): the reader found the page drawn, for a footprint that misses
 *  its texel — the one thing a readback says of a texel. Above every table entry. */
export const SHADOW_REQUEST_MISS = 2 ** 31;
/** The receiver's cell (#1211), in the five bits below `SHADOW_REQUEST_MISS`: which of the 4×4
 *  cells of the page its texel lies in, one-based, zero for a claim that named no texel (the
 *  resolve's own request). Below it, the entry: a table of up to 2^26 entries, the widest window a
 *  session opens (`referenceSunWindow`) included, never only the ordinary one. */
export const SHADOW_REQUEST_CELL_SHIFT = 26;
export const SHADOW_REQUEST_CELL_MASK = 31;
/** `2 ** SHADOW_REQUEST_CELL_SHIFT - 1`, written out: a literal a maths-only bundle drops. */
export const SHADOW_REQUEST_ENTRY_MASK = 0x3ffffff;

/** The footprint of the page-local cell `code` (1..16) a receiver marked: the 4×4 grid cell of
 *  `PAGE_FOOTPRINT_STEP` texels, one-based, zero for a claim that named no texel (whole page). */
export function cellFootprint(code: number) {
  const cells = 2 ** PAGE_FOOTPRINT_EDGE_BITS;
  if (code < 1 || code > cells ** 2) return PAGE_FOOTPRINT_FULL;
  const cell = code - 1,
    x = cell % cells,
    y = Math.floor(cell / cells),
    first = PAGE_FOOTPRINT_STEP;
  return pageFootprint(x * first, y * first, x * first + first - 1, y * first + first - 1);
}

/** The footprint of the texels `[x0, x1] × [y0, y1]` of a page, relative to its first texel —
 *  a rectangle not empty —, widened outward to whole steps and clamped to the page. */
export function pageFootprint(x0: number, y0: number, x1: number, y1: number) {
  const last = 2 ** PAGE_FOOTPRINT_EDGE_BITS - 1,
    bits = PAGE_FOOTPRINT_EDGE_BITS;
  const low = (v: number) => clamp(Math.floor(v / PAGE_FOOTPRINT_STEP), 0, last);
  const high = (v: number) => clamp(last + 1 - Math.ceil(v / PAGE_FOOTPRINT_STEP), 0, last);
  return low(x0) | (low(y0) << bits) | (high(x1) << (2 * bits)) | (high(y1) << (3 * bits));
}

/** The footprint covering both `a` and `b`: each edge the fewer steps in. */
export function footprintUnion(a: number, b: number) {
  let union = 0;
  for (let edge = 0; edge < 4; edge++) {
    const mask = (2 ** PAGE_FOOTPRINT_EDGE_BITS - 1) << (edge * PAGE_FOOTPRINT_EDGE_BITS);
    union |= Math.min(a & mask, b & mask);
  }
  return union;
}

/** What a page of target `footprint` is drawn for: a page no box named is drawn whole. */
export const footprintDrawn = (footprint: number) =>
  footprint === PAGE_FOOTPRINT_EMPTY ? PAGE_FOOTPRINT_FULL : footprint;

/**
 * The part of a page's rectangle `page` — normalised face coordinates, `u0, u1, v0, v1`, rows
 * down as `regionRect` lays them — its casters are culled to, into `out`: the footprint grown by
 * `reach` texels, the filter's reach past the texel a reader checks, clamped to the page. A page
 * drawn whole is `page` itself, to the bit.
 */
export function footprintRect(
  out: Float64Array,
  footprint: number,
  reach: number,
  page: ArrayLike<number>,
) {
  const drawn = footprintDrawn(footprint),
    last = 2 ** PAGE_FOOTPRINT_EDGE_BITS - 1,
    bits = PAGE_FOOTPRINT_EDGE_BITS;
  for (let k = 0; k < 4; k++) out[k] = page[k];
  if (drawn === PAGE_FOOTPRINT_FULL) return out;
  const edge = (at: number) => ((drawn >> (at * bits)) & last) * PAGE_FOOTPRINT_STEP;
  const x0 = clamp(edge(0) - reach, 0, SHADOW_PAGE) / SHADOW_PAGE,
    y0 = clamp(edge(1) - reach, 0, SHADOW_PAGE) / SHADOW_PAGE,
    x1 = clamp(SHADOW_PAGE - edge(2) + reach, 0, SHADOW_PAGE) / SHADOW_PAGE,
    y1 = clamp(SHADOW_PAGE - edge(3) + reach, 0, SHADOW_PAGE) / SHADOW_PAGE;
  const u = page[1] - page[0],
    v = page[3] - page[2];
  out[0] = page[0] + x0 * u;
  out[1] = page[0] + x1 * u;
  out[2] = page[3] - y1 * v;
  out[3] = page[3] - y0 * v;
  return out;
}

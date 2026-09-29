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

/** The footprint of the texels `[x0, x1] × [y0, y1]` of a page, relative to its first texel —
 *  a rectangle not empty —, widened outward to whole steps and clamped to the page. */
export function pageFootprint(x0: number, y0: number, x1: number, y1: number) {
  const last = 2 ** PAGE_FOOTPRINT_EDGE_BITS - 1,
    bits = PAGE_FOOTPRINT_EDGE_BITS;
  const low = (v: number) => clamp(Math.floor(v / PAGE_FOOTPRINT_STEP), 0, last);
  const high = (v: number) => clamp(last + 1 - Math.ceil(v / PAGE_FOOTPRINT_STEP), 0, last);
  return low(x0) | (low(y0) << bits) | (high(x1) << (2 * bits)) | (high(y1) << (3 * bits));
}

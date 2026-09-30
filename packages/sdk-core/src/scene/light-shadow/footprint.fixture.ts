import { PAGE_FOOTPRINT_EDGE_BITS, PAGE_FOOTPRINT_STEP } from './footprint.ts';
import { clampNumber as clamp } from '../../world/math/spherical.ts';

/** The footprint of the texels `[x0, x1] × [y0, y1]` of a page, relative to its first texel —
 *  a rectangle not empty —, widened outward to whole steps and clamped to the page. */
export function pageFootprint(x0: number, y0: number, x1: number, y1: number) {
  const last = 2 ** PAGE_FOOTPRINT_EDGE_BITS - 1,
    bits = PAGE_FOOTPRINT_EDGE_BITS;
  const low = (v: number) => clamp(Math.floor(v / PAGE_FOOTPRINT_STEP), 0, last);
  const high = (v: number) => clamp(last + 1 - Math.ceil(v / PAGE_FOOTPRINT_STEP), 0, last);
  return low(x0) | (low(y0) << bits) | (high(x1) << (2 * bits)) | (high(y1) << (3 * bits));
}

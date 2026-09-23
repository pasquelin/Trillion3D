import { hizFootprintFarFlat, hizOccluded } from '../sdk-core/src/index.ts';
import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';
import { HIZ_KERNEL_TEXELS } from './hizCounts.ts';
import type { HizBounds, HizPyramid } from './hizTypes.ts';

// The test kernel is a power of two: `premierNiveau` depends on that to bound the search.
const KERNEL_LOG2 = Math.log2(HIZ_KERNEL_TEXELS);
if (!Number.isInteger(KERNEL_LOG2)) throw new Error('HIZ_KERNEL_TEXELS');

/**
 * First mip level that can still fit in the kernel, for a side of `span` texels.
 *
 * `floor(x1/2^L) - floor(x0/2^L)` equals `floor(span/2^L)` or one more, so a level where
 * `floor(span/2^L) >= kernel` cannot answer: the search skips those levels instead of trying
 * them one by one. The returned level is an exact lower bound, never the kept level: the loop
 * then evaluates the same predicate as before, on the same integers.
 */
function premierNiveau(span: number) {
  if (span < HIZ_KERNEL_TEXELS) return 0;
  const niveau = 31 - Math.clz32(span) - (KERNEL_LOG2 - 1);
  return niveau > 0 ? niveau : 0;
}

/**
 * Values `hizTestRect` writes: the mip the box answers from, then the level-0 rectangle that mip is
 * read over, inclusive on both ends.
 */
export const HIZ_TEST_VALUES = 5;

/**
 * The part of a screen rectangle that can ever paint a pixel, and the mip that covers it exactly.
 *
 * The rectangle is clipped to the viewport: what falls outside it reaches no pixel, so the depth of
 * the clipped part alone is what the box competes against. That is strictly safe — the depth the test
 * compares is still the nearest corner of the *whole* box, no farther than the nearest corner of its
 * clipped part, so a box kept before clipping is still kept. It is also what makes a box straddling an
 * edge testable at all: before clipping, any box reaching past the viewport answered `undefined` and
 * was never rejected, however deeply buried it was. That mattered little for a cluster, which is small
 * on screen, but it is what would stop a group or ancestor box — large, and therefore almost always
 * touching an edge — from ever rejecting a subtree.
 *
 * The mip is the finest one whose outward-rounded footprint fits the test kernel, so the depth read is
 * the tightest the pyramid can give: a coarser mip takes the maximum over pixels the box does not
 * cover and rejects less. Writes `into[0]` = level and `into[1..4]` = the clipped level-0 rectangle;
 * returns false for a box that must never be rejected (near-plane crossing, empty rectangle, or a
 * rectangle wholly outside the viewport).
 */
export function hizTestRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  clipsNear: boolean,
  width: number,
  height: number,
  levels: number,
  into: Int32Array,
): boolean {
  if (
    clipsNear ||
    !Number.isInteger(minX) ||
    !Number.isInteger(minY) ||
    !Number.isInteger(maxX) ||
    !Number.isInteger(maxY) ||
    maxX < minX ||
    maxY < minY ||
    width < 1 ||
    height < 1 ||
    levels < 1
  )
    return false;
  const x0 = minX < 0 ? 0 : minX,
    y0 = minY < 0 ? 0 : minY,
    x1 = maxX > width - 1 ? width - 1 : maxX,
    y1 = maxY > height - 1 ? height - 1 : maxY;
  if (x1 < x0 || y1 < y0) return false;
  for (let level = premierNiveau(x1 - x0 > y1 - y0 ? x1 - x0 : y1 - y0); level < levels; level++) {
    const scale = 2 ** level;
    if (
      Math.floor(x1 / scale) - Math.floor(x0 / scale) < HIZ_KERNEL_TEXELS &&
      Math.floor(y1 / scale) - Math.floor(y0 / scale) < HIZ_KERNEL_TEXELS
    ) {
      into[0] = level;
      into[1] = x0;
      into[2] = y0;
      into[3] = x1;
      into[4] = y1;
      return true;
    }
  }
  return false;
}

/** `hizTestRect` over the flat bounds layout `projectBoxesFlat` writes. */
function hizTestRectFlat(
  bounds: Float64Array,
  base: number,
  width: number,
  height: number,
  levels: number,
  into: Int32Array,
): boolean {
  return hizTestRect(
    bounds[base],
    bounds[base + 1],
    bounds[base + 2],
    bounds[base + 3],
    bounds[base + 5] !== 0,
    width,
    height,
    levels,
    into,
  );
}

const rejectScratch = new Int32Array(HIZ_TEST_VALUES);

/** `hizRejects` on the flat layout `projectBoxesFlat` writes. */
export function hizRejectsFlat(pyramid: HizPyramid, bounds: Float64Array, base: number, bias = 0) {
  if (
    !hizTestRectFlat(
      bounds,
      base,
      pyramid.widths[0],
      pyramid.heights[0],
      pyramid.count,
      rejectScratch,
    )
  )
    return false;
  const far = hizFootprintFarFlat(
    pyramid,
    rejectScratch[1],
    rejectScratch[2],
    rejectScratch[3] + 1,
    rejectScratch[4] + 1,
    rejectScratch[0],
  );
  return hizOccluded(bounds[base + 4], far, bias);
}

const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
export function hizRejects(pyramid: HizPyramid, bounds: HizBounds, bias = 0) {
  boundsScratch[0] = bounds.minX;
  boundsScratch[1] = bounds.minY;
  boundsScratch[2] = bounds.maxX;
  boundsScratch[3] = bounds.maxY;
  boundsScratch[4] = bounds.nearestDepth;
  boundsScratch[5] = bounds.clipsNear ? 1 : 0;
  return hizRejectsFlat(pyramid, boundsScratch, 0, bias);
}

import * as THREE from 'three';
import { hizFootprintFar, hizOccluded } from '../sdk-core/index.ts';
import { projectBoxToScreen } from './hizProjection.ts';
import { HIZ_KERNEL_TEXELS, hizOversized, type HizCounts } from './hizCounts.ts';
import type { HizBounds, HizPage, HizPyramid } from './hizTypes.ts';

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
  for (let level = 0; level < levels; level++) {
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
export function hizTestRectFlat(
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

const levelScratch = new Int32Array(HIZ_TEST_VALUES);

/** The mip `hizTestRect` picked, over the flat bounds layout `projectBoxesFlat` writes. */
export function hizFootprintLevelFlat(
  bounds: Float64Array,
  base: number,
  width: number,
  height: number,
  levels: number,
): number | undefined {
  return hizTestRectFlat(bounds, base, width, height, levels, levelScratch)
    ? levelScratch[0]
    : undefined;
}

const rejectScratch = new Int32Array(HIZ_TEST_VALUES);

export function hizRejects(pyramid: HizPyramid, bounds: HizBounds, bias = 0) {
  if (
    !hizTestRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      bounds.clipsNear,
      pyramid.width,
      pyramid.height,
      pyramid.levels.length,
      rejectScratch,
    )
  )
    return false;
  const far = hizFootprintFar(
    pyramid.levels,
    rejectScratch[1],
    rejectScratch[2],
    rejectScratch[3] + 1,
    rejectScratch[4] + 1,
    rejectScratch[0],
  );
  return hizOccluded(bounds.nearestDepth, far, bias);
}

export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  pyramid: HizPyramid,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  bias = 0,
) {
  return pages.filter(
    (page) =>
      !hizRejects(
        pyramid,
        projectBoxToScreen(page.min, page.max, page.matrix, camera, viewport),
        bias,
      ),
  );
}

/**
 * `filterUnoccluded` that also says what the test did: `counts` gains the clusters it was handed, the
 * clusters it eliminated and the clusters too wide for the level-0 kernel, each with the triangles
 * those clusters carry. This is the oracle the GPU counters are read against on a fixed image.
 */
export function countUnoccluded<T extends HizPage & { array?: ArrayLike<number> }>(
  pages: T[],
  pyramid: HizPyramid,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  counts: HizCounts,
  bias = 0,
) {
  const kept: T[] = [];
  for (const page of pages) {
    const bounds = projectBoxToScreen(page.min, page.max, page.matrix, camera, viewport);
    const triangles = page.array ? Math.floor(page.array.length / 3) : 0;
    counts.tested++;
    counts.testedTriangles += triangles;
    if (hizOversized(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.clipsNear)) {
      counts.oversized++;
      counts.oversizedTriangles += triangles;
    }
    if (hizRejects(pyramid, bounds, bias)) {
      counts.rejected++;
      counts.rejectedTriangles += triangles;
      continue;
    }
    kept.push(page);
  }
  return kept;
}

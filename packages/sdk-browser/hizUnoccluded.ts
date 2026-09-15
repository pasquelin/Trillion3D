import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hizCorners.ts';
import { hizRejectsFlat } from './hizOcclusion.ts';
import { boundsFor, projectBoxesFlat } from './hizProjection.ts';
import { createHizCounts, hizOversizedFlat, resetHizCounts, type HizCounts } from './hizCounts.ts';
import type { HizPage, HizPyramid } from './hizTypes.ts';

/** Counts nobody reads: what `filterUnoccluded` hands `countUnoccluded` when only the cut matters. */
const discardedCounts = createHizCounts();

export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  pyramid: HizPyramid,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  bias = 0,
) {
  resetHizCounts(discardedCounts);
  return countUnoccluded(pages, pyramid, camera, viewport, discardedCounts, bias);
}

/**
 * The pages the test keeps, and what it did: `counts` gains the clusters it was handed, the clusters
 * it eliminated and the clusters too wide for the level-0 kernel, each with the triangles those
 * clusters carry. This is the oracle the GPU counters are read against on a fixed image.
 */
export function countUnoccluded<T extends HizPage & { array?: ArrayLike<number> }>(
  pages: T[],
  pyramid: HizPyramid,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  counts: HizCounts,
  bias = 0,
) {
  const kept: T[] = [],
    bounds = boundsFor(pages.length);
  projectBoxesFlat(pages, pages.length, camera, viewport, bounds);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i],
      base = i * HIZ_BOUNDS_VALUES;
    const triangles = page.array ? Math.floor(page.array.length / 3) : 0;
    counts.tested++;
    counts.testedTriangles += triangles;
    if (hizOversizedFlat(bounds, base)) {
      counts.oversized++;
      counts.oversizedTriangles += triangles;
    }
    if (hizRejectsFlat(pyramid, bounds, base, bias)) {
      counts.rejected++;
      counts.rejectedTriangles += triangles;
      continue;
    }
    kept.push(page);
  }
  return kept;
}

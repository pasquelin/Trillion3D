import { HIZ_BOUNDS_VALUES } from './corners.ts';
import { hizRejectsFlat } from './occlusion.ts';
import { boundsFor, projectBoxesFlat } from './projection.ts';
import { createHizCounts, hizOversizedFlat, resetHizCounts, type HizCounts } from './counts.ts';
import type { HizPage, HizPyramid } from './types.ts';
import { neverCulled } from '../visibility/shader/spriteWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { PageLocations } from '../page/selection/placements.ts';

/** Counts nobody reads: what `filterUnoccluded` hands `countUnoccluded` when only the cut matters. */
const discardedCounts = createHizCounts();

export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  locations: PageLocations,
  pyramid: HizPyramid,
  cam: EngineCamera,
  viewport: [number, number],
  keptIndices?: number[],
  bias = 0,
) {
  resetHizCounts(discardedCounts);
  return countUnoccluded(
    pages,
    locations,
    pyramid,
    cam,
    viewport,
    discardedCounts,
    keptIndices,
    bias,
  );
}

/**
 * The pages the test keeps, and what it did: `counts` gains the clusters it was handed, the clusters
 * it eliminated and the clusters too wide for the level-0 kernel, each with the triangles those
 * clusters carry. This is the oracle the GPU counters are read against on a fixed image.
 * `keptIndices`, when given, receives the rank in `pages` of every kept page: one record may stand
 * for several placements (#1235), so a caller tells the instances apart by rank, never by record.
 */
export function countUnoccluded<T extends HizPage & { array?: ArrayLike<number> }>(
  pages: T[],
  locations: PageLocations,
  pyramid: HizPyramid,
  cam: EngineCamera,
  viewport: [number, number],
  counts: HizCounts,
  keptIndices?: number[],
  bias = 0,
) {
  const kept: T[] = [],
    bounds = boundsFor(pages.length);
  if (keptIndices) keptIndices.length = 0;
  projectBoxesFlat(pages, locations, pages.length, cam, viewport, bounds);
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
    // A page never culled has no world bound its quad keeps to: no pyramid rejects it.
    if (!neverCulled(page.material) && hizRejectsFlat(pyramid, bounds, base, bias)) {
      counts.rejected++;
      counts.rejectedTriangles += triangles;
      continue;
    }
    kept.push(page);
    keptIndices?.push(i);
  }
  return kept;
}

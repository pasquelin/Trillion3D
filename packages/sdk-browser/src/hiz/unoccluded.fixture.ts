// The CPU occlusion test of a whole cut: the oracle the GPU counters and the occlusion tests read
// the kept pages of, on a fixed image.
import { HIZ_BOUNDS_VALUES } from './corners.ts'
import { HIZ_KERNEL_TEXELS } from './counts.ts'
import { boundsFor, projectBoxesFlat } from './projection.fixture.ts'
import type { HizPage, HizPyramid } from './types.ts'
import { hizRejectsFlat } from '../../../../bench/oracles/browser/hizOcclusion.ts'
import { neverCulled } from '../visibility/shader/spriteWgsl.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { PageLocations } from '../page/selection/placements.ts'

/**
 * What one image's occlusion test did, counted in clusters and in the triangles those clusters carry.
 * `tested` is what the test was handed, `rejected` what it eliminated, `oversized` those whose level-0
 * screen footprint is wider than the test kernel and which therefore answer from a coarser mip. Every
 * field is a count of one image; nothing is deduced from another field.
 */
export type HizCounts = {
  tested: number
  rejected: number
  oversized: number
  testedTriangles: number
  rejectedTriangles: number
  oversizedTriangles: number
}

export function createHizCounts(): HizCounts {
  return {
    tested: 0,
    rejected: 0,
    oversized: 0,
    testedTriangles: 0,
    rejectedTriangles: 0,
    oversizedTriangles: 0,
  }
}

/** A screen rectangle of the flat bounds layout the level-0 kernel cannot cover. A near-plane
 *  crossing carries no rectangle. */
function hizOversizedFlat(bounds: Float64Array, base: number) {
  return (
    bounds[base + HIZ_BOUNDS_VALUES - 1] === 0 &&
    (bounds[base + 2] - bounds[base] >= HIZ_KERNEL_TEXELS ||
      bounds[base + 3] - bounds[base + 1] >= HIZ_KERNEL_TEXELS)
  )
}

/**
 * The pages the test keeps, and what it did: `counts` gains the clusters it was handed, the clusters
 * it eliminated and the clusters too wide for the level-0 kernel, each with the triangles those
 * clusters carry. `keptIndices`, when given, receives the rank in `pages` of every kept page: one
 * record may stand for several placements, so a caller tells the instances apart by rank, never by
 * record.
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
  const kept: T[] = []
  const bounds = boundsFor(pages.length)
  if (keptIndices) keptIndices.length = 0
  projectBoxesFlat(pages, locations, pages.length, cam, viewport, bounds)
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i],
      base = i * HIZ_BOUNDS_VALUES
    const triangles = page.array ? Math.floor(page.array.length / 3) : 0
    counts.tested++
    counts.testedTriangles += triangles
    if (hizOversizedFlat(bounds, base)) {
      counts.oversized++
      counts.oversizedTriangles += triangles
    }
    // A page never culled has no world bound its quad keeps to: no pyramid rejects it.
    if (!neverCulled(page.material) && hizRejectsFlat(pyramid, bounds, base, bias)) {
      counts.rejected++
      counts.rejectedTriangles += triangles
      continue
    }
    kept.push(page)
    keptIndices?.push(i)
  }
  return kept
}

/** `countUnoccluded` when only the cut matters: counts nobody reads, a fresh set each call. */
export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  locations: PageLocations,
  pyramid: HizPyramid,
  cam: EngineCamera,
  viewport: [number, number],
  bias = 0,
) {
  return countUnoccluded(
    pages,
    locations,
    pyramid,
    cam,
    viewport,
    createHizCounts(),
    undefined,
    bias,
  )
}

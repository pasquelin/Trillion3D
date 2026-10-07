import { HIZ_BOUNDS_VALUES } from './corners.ts'
import { rankByDepth } from './depthRank.fixture.ts'
import { boundsFor, projectBoxesFlat } from './projection.fixture.ts'
import type { HizPage } from './types.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { PageLocations } from '../page/selection/placements.ts'

/**
 * The same split, returned as pages rather than flags: `occluders` receives the nearest half in
 * sort order, `rest` the rest of the sort then the near-plane clips in candidate order. No page
 * is projected twice and nothing is allocated per frame.
 */
export function splitOccludersInto<T extends HizPage>(
  pages: T[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  occluders: T[],
  rest: T[],
  occludersPacked: number[] = [],
  restPacked: number[] = [],
) {
  occluders.length = rest.length = occludersPacked.length = restPacked.length = 0
  const count = pages.length,
    packed = locations.packed,
    bounds = boundsFor(count)
  projectBoxesFlat(pages, locations, count, cam, viewport, bounds)
  const { inFront, order } = rankByDepth(count, bounds)
  if (!inFront) {
    for (let i = 0; i < count; i++) {
      rest.push(pages[i])
      restPacked.push(packed[i])
    }
    return 0
  }
  const mid = Math.max(1, Math.floor(inFront / 2))
  for (let i = 0; i < mid; i++) {
    occluders.push(pages[order[i]])
    occludersPacked.push(packed[order[i]])
  }
  for (let i = mid; i < inFront; i++) {
    rest.push(pages[order[i]])
    restPacked.push(packed[order[i]])
  }
  for (let i = 0; i < count; i++)
    if (bounds[i * HIZ_BOUNDS_VALUES + 5] !== 0) {
      rest.push(pages[i])
      restPacked.push(packed[i])
    }
  return mid
}

// `countUnoccluded` when only the cut matters: the oracle the occlusion tests read the kept pages of.
import { createHizCounts } from './counts.ts'
import { countUnoccluded } from './unoccluded.ts'
import type { HizPage, HizPyramid } from './types.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { PageLocations } from '../page/selection/placements.ts'

export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  locations: PageLocations,
  pyramid: HizPyramid,
  cam: EngineCamera,
  viewport: [number, number],
  keptIndices?: number[],
  bias = 0,
) {
  // Counts nobody reads: a fresh set each call.
  return countUnoccluded(
    pages,
    locations,
    pyramid,
    cam,
    viewport,
    createHizCounts(),
    keptIndices,
    bias,
  )
}

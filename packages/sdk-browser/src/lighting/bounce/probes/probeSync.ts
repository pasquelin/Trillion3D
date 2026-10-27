import {
  NO_PLACEMENT_BOXES,
  type PlacementBoxes,
} from '../../../geometry/dag/placement/placementBoxes.ts'

/** What a sync of the probes with the placements touches. */
type ProbeSyncParts = {
  boxes(): PlacementBoxes
  /** The bounce series starts over: the light the probes hold is not the scene's now. */
  restart(): void
}

/**
 * Motion restarts the series: the probes hold the light of a scene that was. Nothing moved, nothing
 * is touched. Whether anything did.
 */
function syncBounceProbes(parts: ProbeSyncParts) {
  const { moved } = parts.boxes()
  if (!moved.count) return false
  parts.restart()
  return true
}

/**
 * The follow of the probes after the placements (`syncBounceProbes`), remembering the boxes it read
 * last: `boxes` is what the placements held at that sync — their boxes and their extent.
 */
export function createPlacementFollow(parts: ProbeSyncParts) {
  let seen = NO_PLACEMENT_BOXES
  const read = { ...parts, boxes: () => (seen = parts.boxes()) }
  return {
    sync: () => syncBounceProbes(read),
    get boxes() {
      return seen
    },
  }
}

import { viewDepth } from '../selection/projection.ts'
import { errorFloorAt } from '../selection/projection.fixture.ts'
import type { PageRecord, SelectionState } from './state.fixture.ts'
import { OWN_FLOOR, OWN_SPHERE } from './bounds.ts'

/**
 * True when the subtree whose bounds (`cullingBounds`, `./bounds.ts`) sit at `at` gives the cut
 * nothing: the floor of its own error, seen at the farthest depth its sphere allows, is above the
 * threshold, so no cluster under it is fine enough — the GPU cut's floor rejection
 * (`../../gpu/dag/packNodes.ts`). Nothing is accepted here: a subtree not rejected is descended,
 * cluster by cluster, as the GPU cut does.
 *
 * The reject the manifest already allows — no replacement still too coarse in the subtree —
 * remains set by the caller, with the manifest bounds. A deformed root's rest-space bounds settle
 * nothing: it descends through the same walk.
 */
export function subtreeRejected<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
) {
  if (s.flatReach > 0) return false
  return (
    errorFloorAt(
      values[at + OWN_FLOOR],
      viewDepth(values, at + OWN_SPHERE, s.flatElements),
      values[at + OWN_SPHERE + 3],
      s.flatStretch,
      s.flatFocal,
      s.cam.perspective,
    ) > s.pixelError
  )
}

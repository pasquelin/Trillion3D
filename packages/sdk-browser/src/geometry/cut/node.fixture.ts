import { viewDepth } from '../selection/projection.fixture.ts'
import { errorFloorAt } from '../selection/projection.fixture.ts'
import { CULL_FLOOR, CULL_SPHERE } from '../dag/types.ts'
import type { PageRecord, SelectionState } from './state.fixture.ts'

/**
 * True when the leaf at `base` of the manifest's `nodes` gives the cut nothing: its least own error
 * (`CULL_FLOOR`), seen at the farthest depth its LOD ball allows, is above the threshold, so no
 * cluster of its part is fine enough — the GPU cut's floor rejection (`../dag/shader/floorWgsl.ts`).
 * Nothing is accepted here: a leaf not rejected gives its pages, cluster by cluster, as the GPU cut
 * does. The caller tests leaves alone, and the reject the ceiling allows itself; a deformed root is
 * cut at its rest pose's balls and errors, as the GPU cut is.
 */
export function subtreeRejected<T extends PageRecord>(
  s: SelectionState<T>,
  nodes: Float64Array,
  base: number,
) {
  return (
    errorFloorAt(
      nodes[base + CULL_FLOOR],
      viewDepth(nodes, base + CULL_SPHERE, s.flatElements),
      nodes[base + CULL_SPHERE + 3],
      s.flatStretch,
      s.flatFocal,
      s.cam.perspective,
    ) > s.pixelError
  )
}

import { matrixWindingCw } from '../../../../math/src/matrix/orientation.ts'
import type { ClusterRoot } from '../../geometry/selection/types.ts'
import { rootOf } from '../../geometry/selection/placements.ts'
import { worldVersion } from '../../geometry/selection/rootWorld.ts'

/**
 * Winding of a placement: true when its root's world matrix reverses orientation, which swaps the
 * culled face of every cluster it places. It is a 3×3 determinant, and it changes only when the
 * matrix changes — never between two images of a still scene — so it is held on the root, once
 * for all its pages, at the root's world version (`worldMoved`, `rootWorld.ts`): the one version
 * every memo of what derives from a root's world is keyed by. A world moved since recomputes it.
 */
export function windingCw(
  roots: readonly Pick<ClusterRoot<unknown>, 'world' | 'worldAt' | 'windingCw' | 'windingEpoch'>[],
  rank: number,
) {
  const root = rootOf(roots, rank)
  const at = worldVersion(root)
  if (root.windingEpoch === at && root.windingCw !== undefined) return root.windingCw
  const cw = matrixWindingCw(root.world.elements)
  root.windingEpoch = at
  root.windingCw = cw
  return cw
}

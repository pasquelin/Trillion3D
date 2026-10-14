import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { appendRootsUnder } from '../pages/render/movedNode.ts'
import type { RayFilter } from '../../world/query/types.ts'

/** The placement ranks under `nodes`, each once, increasing: the roots whose source node lies in a
 *  subtree of them (`appendRootsUnder`, by the node each draws: `rootSource`), read in the scene's
 *  own tree, O(subtree). */
function ranksUnder(roots: readonly ClusterRoot<PageRec>[], nodes: readonly Object3D[]) {
  const out: number[] = []
  let at = 0
  for (const node of nodes) at = appendRootsUnder(roots, node, out, at)
  out.length = at
  out.sort((a, b) => a - b)
  let kept = 0
  for (let k = 0; k < out.length; k++) if (k === 0 || out[k] !== out[k - 1]) out[kept++] = out[k]
  out.length = kept
  return out
}

/**
 * What a ray's filter lists for the kernel (`rqAdmits`, `rayPlacementWgsl.ts`): the placements under
 * `objects` but not under `skip`, met alone (`include`), or, with no `objects`, those under `skip`,
 * passed by. Sorted ranks, each once: the kernel finds a placement among them by halves.
 */
export function rayFilterRanks(roots: readonly ClusterRoot<PageRec>[], filter: RayFilter = {}) {
  const skipped = ranksUnder(roots, filter.skip ?? [])
  if (!filter.objects) return { ranks: skipped, include: false }
  const passed = new Set(skipped)
  return { ranks: ranksUnder(roots, filter.objects).filter((w) => !passed.has(w)), include: true }
}

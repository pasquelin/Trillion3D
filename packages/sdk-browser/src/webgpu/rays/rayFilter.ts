import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { appendRootsUnder, type RootsOwner } from '../pages/render/movedNode.ts'
import type { RayFilter } from '../../world/query/types.ts'

/** The placement ranks under `nodes`, each once, increasing: the roots of `layout` whose node lies in a
 *  subtree of them (`appendRootsUnder`, by the node each draws: `rootSource`), read in the scene's
 *  own tree, O(subtree). */
function ranksUnder(layout: RootsOwner, nodes: readonly Object3D[]) {
  const out: number[] = []
  let at = 0
  for (const node of nodes) at = appendRootsUnder(layout, node, out, at)
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
 * passed by, among the roots of `layout`. Sorted ranks, each once: the kernel finds a placement
 * among them by halves.
 */
export function rayFilterRanks(layout: RootsOwner, filter: RayFilter = {}) {
  const skipped = ranksUnder(layout, filter.skip ?? [])
  if (!filter.objects) return { ranks: skipped, include: false }
  const passed = new Set(skipped)
  return { ranks: ranksUnder(layout, filter.objects).filter((w) => !passed.has(w)), include: true }
}

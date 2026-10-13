import { matrixWindingCw } from '../../../../../sdk-core/src/index.ts'
import type { ClusterRoot } from '../../../page/selection/types.ts'
import { rootOf } from '../../../page/selection/placements.ts'

/**
 * Winding of a placement: true when its root's world matrix reverses orientation, which swaps the
 * culled face of every cluster it places. It is a 3×3 determinant, and it changes only when the
 * matrix changes — never between two images of a still scene — so it is held on the root, once
 * for all its pages.
 *
 * The epoch is the row table's, which the engine already increments as soon as a world matrix may
 * have moved: `renderWebgpuPages` posts it at the head of the image, and a root whose epoch
 * matches yields the already-computed value. One extra epoch only recomputes.
 */
let epoque = 0

/** Posts the image's epoch. Beyond it, every memoised winding is taken back to zero. */
export function setWindingEpoch(valeur: number) {
  epoque = valeur
}

/** The winding of the root of rank `rank` in `roots`. */
export function windingCw(
  roots: readonly Pick<
    ClusterRoot<unknown>,
    'world' | 'windingCw' | 'windingEpoch' | 'windingStamp'
  >[],
  rank: number,
) {
  const root = rootOf(roots, rank)
  // A root a parent composes carries the composition's stamp: the memo holds while it does.
  const stamp = (root.world as { stamp?: number }).stamp
  if (root.windingEpoch === epoque && root.windingCw !== undefined && root.windingStamp === stamp)
    return root.windingCw
  const cw = matrixWindingCw(root.world.elements)
  root.windingEpoch = epoque
  root.windingStamp = stamp
  root.windingCw = cw
  return cw
}

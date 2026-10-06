import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { rootOf, type PageRec, type ClusterRoot } from '../page/selection/selection.ts'
import type { PlacementIndex } from '../page/selection/placements.ts'

/** What reads a record's instances: its packed ranks, and the root each rank belongs to. */
type InstanceRanks = {
  forEachRank(rec: PageRec, visit: (packed: number) => void): void
  readonly placement: PlacementIndex
}

/** Addresses already counted, reused across calls: nothing is allocated to count a frame. */
const counted = new Set<string>()

type Roots = readonly ClusterRoot<PageRec>[]

/** True when the root of rank `rank`, in `roots`, reads its world from a row. */
export const rowPlacedAt = (roots: Roots, rank: number) => !!roots[rank]?.placement

/** True when the record of instance `rank` is drawn instanced with the other rows of its page
 *  (`webglPageBatches.ts`). A transparent record placed by a row is drawn on its own, like a
 *  blended copy: the host orders blended by depth, never the instances of one draw. A deformed
 *  placement (its root's `deformRecord`) is drawn on its own too. */
export const drawnInstancedAt = (
  roots: Roots,
  rank: number,
  rec: PageRec,
  transparent = rec.transparent,
) => rowPlacedAt(roots, rank) && !transparent && !roots[rank]?.deformRecord

/** The host meshes `recs` hang on the WebGL2 path's display graph, which its page ceiling bounds:
 *  one per record drawn on its own, one per PAGE for records drawn instanced — ten thousand opaque
 *  placements of a page are one mesh. `instanced(rec)` says which records are drawn instanced. */
export function attachedPages(recs: readonly PageRec[], instanced: (rec: PageRec) => boolean) {
  counted.clear()
  let own = 0
  for (const rec of recs)
    if (instanced(rec)) counted.add(rec.url)
    else own++
  return own + counted.size
}

/** The largest world scale that places the records: the compiler's tile follows it, read over
 *  every placement of the primitive (`mesh_scales`), not only those a change moves. */
export function largestScale(
  records: readonly PageRec[],
  roots: readonly ClusterRoot<PageRec>[],
  draws: InstanceRanks,
  scratch = new Matrix4(),
) {
  // Over every instance: one record serves every placement of its primitive (#1235).
  let scale = 0
  for (const rec of new Set(records))
    draws.forEachRank(rec, (packed) => {
      const { elements } = rootOf(roots, draws.placement.rootOfPacked[packed]).world
      scale = Math.max(scale, scratch.fromArray(elements).getMaxScaleOnAxis())
    })
  return scale
}

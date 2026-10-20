/**
 * GROWING AN INSTANCE BUFFER IN PLACE — the one contract every engine follows.
 *
 * A session holds each resource's instance buffer at a capacity. When its owner needs more rows,
 * it does not open the session again: once the engine said it takes the growth
 * (`EngineSceneUpdates.growsInPlace`), it replaces the buffer `from` by a larger one `to` whose
 * first rows are `from`'s, the rows past them parked, and hands both to the engine
 * (`EngineSceneUpdates.growPlacements`). The engine then
 *   1. rebinds every root, page, copy and item that read a row of `from` onto the same row of `to`
 *      (`Rebound` names each matrix view it replaced, for the tables keyed by one);
 *   2. appends one root per new row, cloned from a root of the same buffer — a blended surface's
 *      copy comes with it —: its pages name the same clusters, geometry and surface, only the
 *      world and the per-placement marks are its own;
 *   3. grows its own tables where the new roots overflow them — geometrically, like the owner's
 *      buffer, so a scene that grows by one placement at a time grows each table a logarithmic
 *      number of times.
 * The rows then follow through `updatePlacements`, as any row does. Nothing is prepared again.
 */
import { BOX_VALUES } from '../../../math/src/geometry/box.ts'
import type { PageRec, ClusterRoot } from '../page/selection/types.ts'
import { forgetRowRoots } from './update.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import { placementWorld, type PlacementOf, type PlacementRows } from './rows.ts'

/** The view on its new row each matrix a growth rebound now is, by the view it replaced: a root
 *  and the copy of its placement stand on one, so the tables keyed by a view find them both. */
export type Rebound = Map<MatrixElements, MatrixElements>

/** Each value `held` keeps by a view `rebound` replaced moved to the new view, then `moved` told;
 *  a key absent (`undefined`) is skipped, so a value of 0 moves. */
export function rekeyRebound<K extends object, V, R extends K>(
  held: Map<K, V>,
  rebound: ReadonlyMap<R, R>,
  moved?: (value: V, view: R) => void,
) {
  for (const [old, view] of rebound) {
    const value = held.get(old)
    if (value === undefined) continue
    held.delete(old)
    held.set(view, value)
    moved?.(value, view)
  }
}

/** The view on `placement`'s row that replaces `held`: the same one for every holder of `held`. */
function viewOn(rebound: Rebound | undefined, held: MatrixElements, placement: PlacementOf) {
  const known = rebound?.get(held)
  if (known) return known
  const view = placementWorld(placement.rows, placement.index)
  rebound?.set(held, view)
  return view
}

/** A root posed by `placement`, whose world is a view on its row: its pages read both from it. */
function pose(root: ClusterRoot<PageRec>, placement: PlacementOf, rebound?: Rebound) {
  root.world = viewOn(rebound, root.world, placement)
  root.placement = placement
}

/** A blended copy or the item of one, posed by `placement`: its matrix is a view on the row. */
function poseMatrix(
  item: { matrix: MatrixElements; placement?: PlacementOf },
  placement: PlacementOf,
  rebound?: Rebound,
) {
  item.matrix = viewOn(rebound, item.matrix, placement)
  item.placement = placement
}

/** A parked root for row `index` of `rows`, cloned from `template`: shared clusters and tables,
 *  its own world and box; its local box is the template's. Its box is set when its row is taken. */
function rowRoot(template: ClusterRoot<PageRec>, rows: PlacementRows, index: number) {
  const root: ClusterRoot<PageRec> = {
    ...template,
    // The primitive's pages are shared by every placement of it: the new row reads the
    // same records as the root it was cloned from, never a copy.
    pages: template.pages,
    worldBox: template.worldBox && new Float64Array(BOX_VALUES),
    boxAt: undefined,
    stretch: undefined,
    parked: true,
  }
  root.world = placementWorld(rows, index)
  root.placement = { rows, index }
  return root
}

/** Steps 1 and 2 of the contract on a root list: the roots of `from` read `to`, and one parked
 *  root per new row, cloned from the first of them, is returned for the engine to append to its
 *  tables. */
export function growRowRoots(
  roots: ClusterRoot<PageRec>[],
  from: PlacementRows,
  to: PlacementRows,
  rebound?: Rebound,
) {
  let template: ClusterRoot<PageRec> | undefined
  for (const root of roots)
    if (root.placement?.rows === from) {
      pose(root, { rows: to, index: root.placement.index }, rebound)
      template ??= root
    }
  const added: ClusterRoot<PageRec>[] = []
  if (template)
    for (let index = from.capacity; index < to.capacity; index++)
      added.push(rowRoot(template, to, index))
  forgetRowRoots(roots)
  return added
}

/** Step 1 on the blended copies and the items the blend pass holds — one per placement, its
 *  matrix a view on the row —: each of `from` reads `to`. None is cloned: a new row's copy comes
 *  with the root of its row (`pagedBlendCopiesOf`), and its item with that copy. */
export function growRowItems(
  items: readonly { matrix: MatrixElements; placement?: PlacementOf }[],
  from: PlacementRows,
  to: PlacementRows,
  rebound: Rebound,
) {
  for (const item of items)
    if (item.placement?.rows === from)
      poseMatrix(item, { rows: to, index: item.placement.index }, rebound)
}

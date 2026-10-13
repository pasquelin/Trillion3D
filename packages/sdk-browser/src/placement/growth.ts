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
 *   2. appends one root per new row, cloned from a root of the same buffer — a copy per new row,
 *      cloned from a copy of the same buffer, for a blended surface —: its pages name the
 *      same clusters, geometry and surface, only the world and the per-placement marks are its own;
 *   3. grows its own tables where the new roots overflow them — geometrically, like the owner's
 *      buffer, so a scene that grows by one placement at a time grows each table a logarithmic
 *      number of times.
 * The rows then follow through `updatePlacements`, as any row does. Nothing is prepared again.
 */
import { BOX_VALUES } from '../../../sdk-core/src/index.ts'
import type { PageRec, ClusterRoot } from '../page/selection/types.ts'
import { forgetRowRoots } from './update.ts'
import { createBlendCopyRecord } from '../cluster/blendCopyRecord.ts'
import type { BlendCopy } from '../cluster/blendCopyContract.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import { placementWorld, type PlacementOf, type PlacementRows } from './rows.ts'

/** The view on its new row each matrix a growth rebound now is, by the view it replaced: a root
 *  and the copy of its placement stand on one, so the tables keyed by a view find them both. */
export type Rebound = Map<MatrixElements, MatrixElements>

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
    stretch: undefined,
    stretchKey: undefined,
    parked: true,
  }
  root.world = placementWorld(rows, index)
  root.placement = { rows, index }
  return root
}

/**
 * Steps 1 and 2 of the contract on any list posed by rows: each item of `from` is `rebind`-ed to
 * the same row of `to`, and one item per new row is `clone`-d from the first of them, returned
 * with it. `items` itself is not extended.
 */
function growPlaced<T extends { readonly placement?: PlacementOf }>(
  items: readonly T[],
  from: PlacementRows,
  to: PlacementRows,
  rebind: (item: T, placement: PlacementOf) => void,
  clone: (template: T, placement: PlacementOf) => T | undefined,
) {
  let template: T | undefined
  for (const item of items)
    if (item.placement?.rows === from) {
      rebind(item, { rows: to, index: item.placement.index })
      template ??= item
    }
  const added: { item: T; template: T }[] = []
  if (template)
    for (let index = from.capacity; index < to.capacity; index++) {
      const item = clone(template, { rows: to, index })
      if (item) added.push({ item, template })
    }
  return added
}

/** `growPlaced` on a root list: the roots of `from` read `to`, and one parked root per new row is
 *  returned — with the root whose pages its own pages copy rank for rank — for the engine to
 *  append to its tables. */
export function growRowRoots(
  roots: ClusterRoot<PageRec>[],
  from: PlacementRows,
  to: PlacementRows,
  rebound?: Rebound,
) {
  const added = growPlaced(
    roots,
    from,
    to,
    (root, placement) => pose(root, placement, rebound),
    (template, { rows, index }) => rowRoot(template, rows, index),
  )
  forgetRowRoots(roots)
  return added
}

/** `growPlaced` on the items the blend pass holds — one per placement, its matrix a view on the
 *  row —: each of `from` reads `to`. They are cloned by their copies, never by themselves. */
export function growRowItems(
  items: readonly { matrix: MatrixElements; placement?: PlacementOf }[],
  from: PlacementRows,
  to: PlacementRows,
  rebound: Rebound,
) {
  growPlaced(
    items,
    from,
    to,
    (item, placement) => poseMatrix(item, placement, rebound),
    () => undefined,
  )
}

/** `growPlaced` on the blended copies: the copies of `from` read `to`, and one parked copy per new
 *  row is returned — a paged one comes with the root of its row, never from here. */
export function growRowCopies(
  copies: readonly BlendCopy[],
  from: PlacementRows,
  to: PlacementRows,
  rebound: Rebound,
) {
  return growPlaced(
    copies,
    from,
    to,
    (copy, placement) => poseMatrix(copy, placement, rebound),
    (template, placement) => {
      if (template.userData.pagedBlend || !template.userData.drawSource) return undefined
      const copy = createBlendCopyRecord(
        template.userData.drawSource,
        template.renderOrder,
        placementWorld(placement.rows, placement.index),
        template.surface,
        placement,
      )
      copy.deformation = template.deformation
      return copy
    },
  ).map(({ item }) => item)
}

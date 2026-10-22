import type { ClusterRoot } from '../geometry/selection/types.ts'
import { worldMoved } from '../geometry/selection/rootWorld.ts'
import { rowCasting, rowDrawDistance, type PlacementRows } from './rows/rows.ts'
import { settleRoot } from './hidden.ts'
import { markCasting } from '../visibility/shader/castingMark.ts'
import type { NodeIndex } from '../frame/render/movedNode.ts'

/** What a pose did to a placement: nothing, a move of one already moving, a first move. */
export const MOVE_NONE = 0,
  MOVE_MOVING = 1,
  MOVE_PROMOTED = 2

/** A root that reads a row, its rank among the roots the cut walks, and the owner its row had at
 *  the last follow (`PlacementRows.sources`). */
type RowRoot<T> = { root: ClusterRoot<T>; rank: number; owner?: object | null }

/** The roots of each instance buffer, by row: built once per root list, which a session keeps. */
const indexes = new WeakMap<readonly object[], Map<PlacementRows, RowRoot<unknown>[]>>()
const NO_ROOTS: readonly RowRoot<unknown>[] = []

function rowRoots<T>(roots: readonly ClusterRoot<T>[], rows: PlacementRows) {
  let index = indexes.get(roots)
  if (!index) {
    index = new Map()
    for (let rank = 0; rank < roots.length; rank++) {
      const placement = roots[rank].placement
      if (!placement) continue
      let list = index.get(placement.rows)
      if (!list) index.set(placement.rows, (list = []))
      list[placement.index] = { root: roots[rank], rank }
    }
    indexes.set(roots, index)
  }
  // Rows no root reads are those of a blended surface: its copies read them (`PlacementRows.blended`).
  return (index.get(rows) ?? NO_ROOTS) as RowRoot<T>[]
}

/** `root` drawn at the distances its row names now (`PlacementRows.drawDistance`): true when that
 *  changed them. */
function followDrawDistance(root: ClusterRoot<unknown>) {
  const { rows, index } = root.placement!,
    held = root.drawDistance
  if (
    (rows.drawDistance?.[2 * index] ?? 0) === (held?.min ?? 0) &&
    (rows.drawDistance?.[2 * index + 1] ?? 0) === (held?.max ?? 0)
  )
    return false
  root.drawDistance = rowDrawDistance(root.placement!)
  return true
}

/** The rank of the root that reads row `index` of `rows`, or -1 when none does. */
export const rootRankOfRow = <T>(
  roots: readonly ClusterRoot<T>[],
  rows: PlacementRows,
  index: number,
) => rowRoots(roots, rows)[index]?.rank ?? -1

/** A root list's rows were rebound or extended (`growth/growth.ts`): its index is built again
 *  at the next follow. */
export const forgetRowRoots = (roots: readonly object[]) => {
  indexes.delete(roots)
}

/**
 * Brings the roots of rows `from` to `to` level with what the owner wrote in them: each root's
 * world is already the row (a view), so only what the engine DERIVES from it follows — its world
 * box, taken when read (`worldMoved`), its parked flag, its shadowless and far-shadow bits
 * (`ClusterRoot.mark`) and the distances it is drawn at (`ClusterRoot.drawDistance`), which `flip`
 * hands to a GPU cut when the engine has one. `posed` hears the rank of every root the
 * rows pose, with the pose it now has — never forced: a row taken or parked where it stands is
 * shown or hidden, not moved —, and says whether it moved (`MOVE_*`). A root that began or stopped
 * casting is not made a moving caster for it. `follow` names each root that reads a written row:
 * the rows pass derives its rows again, and they stale the shadow pages they left and entered
 * (`rows/rowCastWgsl.ts`). A row of the range left where it stands — a pose written again unchanged, a
 * row between two written ones — moves nothing. A row re-seated on another mesh raises the
 * revision of `owner`'s index of the roots by node (`../frame/render/movedNode.ts`). Returns whether a drawn root moved, was shown or
 * hidden, turned to cast or not, or changed the distances it is drawn at: a still scene pays
 * nothing downstream.
 */
export function followPlacementRows<T>(
  roots: readonly ClusterRoot<T>[],
  rows: PlacementRows,
  from: number,
  to: number,
  flip?: (rank: number, root: ClusterRoot<T>) => void,
  posed?: (rank: number, world: ArrayLike<number>) => number,
  follow?: (rank: number) => void,
  owner?: { rootIndex: NodeIndex },
) {
  const list = rowRoots(roots, rows)
  let any = false
  const last = Math.min(to, rows.capacity - 1)
  for (let index = Math.max(0, from); index <= last; index++) {
    const entry = list[index]
    if (!entry) continue
    const { root, rank } = entry
    // A row re-seated on another mesh renames its root (`rootSource`): the roots' index by node,
    // their owner's, is built again at its next read.
    const seated = rows.sources?.[index] ?? null
    if (entry.owner !== seated) {
      entry.owner = seated
      if (owner) owner.rootIndex.revision++
    }
    const cast = markCasting(root, rowCasting(root.placement!))
    // Its distances too: written before the flip that hands them to the cut.
    const distant = followDrawDistance(root)
    // Its pose alone says whether it moved: a row taken or parked where it stands is shown or
    // hidden, not moved — the primitive is removed or added and its pages invalidated once,
    // without caching it as dynamic (only a transform update does).
    const move = posed ? posed(rank, root.world.elements) : MOVE_PROMOTED,
      wasParked = !!root.parked,
      flipped = settleRoot(root, rank, flip, cast || distant),
      parked = !!root.parked
    follow?.(rank)
    worldMoved(root)
    // Its rows and box follow the row all the same; a root without a box, or parked before and
    // after, draws nothing that moved.
    if (move === MOVE_NONE && !cast && !distant && !flipped) continue
    if (root.worldBox && !(wasParked && parked)) any = true
  }
  return any
}

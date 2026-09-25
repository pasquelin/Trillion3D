import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../sdk-core/src/index.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PlacementRows } from './rows.ts';

/** What a pose did to a placement: nothing, a move of one already moving, a first move. */
export const MOVE_NONE = 0,
  MOVE_MOVING = 1,
  MOVE_PROMOTED = 2;

/** A root that reads a row, and its rank among the roots the cut walks. */
type RowRoot<T> = { root: ClusterRoot<T>; rank: number };

/** The roots of each instance buffer, by row: built once per root list, which a session keeps. */
const indexes = new WeakMap<readonly object[], Map<PlacementRows, RowRoot<unknown>[]>>();
const NO_ROOTS: readonly RowRoot<unknown>[] = [];

function rowRoots<T>(roots: readonly ClusterRoot<T>[], rows: PlacementRows) {
  let index = indexes.get(roots);
  if (!index) {
    index = new Map();
    for (let rank = 0; rank < roots.length; rank++) {
      const placement = roots[rank].placement;
      if (!placement) continue;
      let list = index.get(placement.rows);
      if (!list) index.set(placement.rows, (list = []));
      list[placement.index] = { root: roots[rank], rank };
    }
    indexes.set(roots, index);
  }
  // Rows no root reads are those of a blended surface: its copies read them (`placedBy`).
  return (index.get(rows) ?? NO_ROOTS) as RowRoot<T>[];
}

/** A root list's rows were rebound or extended (`growth.ts`): its index is built again
 *  at the next follow. */
export const forgetRowRoots = (roots: readonly object[]) => {
  indexes.delete(roots);
};

/** What one root's move changed: the box it left and entered, as one union, and its two corners. */
const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6);

/**
 * Brings the roots of rows `from` to `to` level with what the owner wrote in them: each root's
 * world is already the row (a view), so only what the engine DERIVES from it follows — its world
 * box, reprojected from its local box, and its parked flag, which `park` hands to a GPU cut when
 * the engine has one; `posed` hears the rank of every root the rows pose, with the pose it now
 * has and whether its row was taken or parked — a move whatever its pose —, and says whether it
 * moved (`MOVE_*`); `follow` names each root that reads a written row. `touched` hears, root by
 * root, the box each moved or flipped root left and entered, and whether it was moving already: a
 * row of the range left where it stands — a pose written again unchanged, a row between two
 * written ones — touches nothing, and two roots far apart are two boxes, never the room between
 * them (as far as the plan's box list holds them apart, `changes.ts`). Returns whether a drawn root moved: a still scene pays nothing downstream.
 */
export function followPlacementRows<T>(
  roots: readonly ClusterRoot<T>[],
  rows: PlacementRows,
  from: number,
  to: number,
  park?: (rank: number, parked: boolean) => void,
  posed?: (rank: number, world: ArrayLike<number>, forced: boolean) => number,
  follow?: (rank: number) => void,
  touched?: (min: ArrayLike<number>, max: ArrayLike<number>, movingOnly: boolean) => void,
) {
  const list = rowRoots(roots, rows);
  let any = false;
  const last = Math.min(to, rows.capacity - 1);
  for (let index = Math.max(0, from); index <= last; index++) {
    const entry = list[index];
    if (!entry) continue;
    const { root, rank } = entry;
    const parked = rows.live[index] === 0 || !!root.hidden,
      flipped = parked !== !!root.parked;
    // A row taken or parked moved, whatever its pose; otherwise its pose says whether it moved.
    const move = posed ? posed(rank, root.world.elements, flipped) : MOVE_PROMOTED;
    boxEmpty(moved, 0);
    if (root.worldBox && !root.parked) boxUnionBatch(moved, root.worldBox, 1);
    if (flipped) {
      root.parked = parked;
      park?.(rank, parked);
    }
    follow?.(rank);
    if (root.worldBox && root.localBox)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    if (root.worldBox && !parked) boxUnionBatch(moved, root.worldBox, 1);
    // Its rows and box follow the row all the same; only a move stales shadow pages.
    if (move === MOVE_NONE || boxIsEmpty(moved, 0)) continue;
    any = true;
    touched?.(movedMin, movedMax, move === MOVE_MOVING);
  }
  return any;
}

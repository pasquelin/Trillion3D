import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../sdk-core/src/index.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PlacementRows } from './rows.ts';

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

/** What rows the owner wrote changed: the box they left and entered, as one union. */
const moved = new Float64Array(BOX_VALUES),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0];

/**
 * Brings the roots of rows `from` to `to` level with what the owner wrote in them: each root's
 * world is already the row (a view), so only what the engine DERIVES from it follows — its world
 * box, reprojected from its local box, and its parked flag, which `park` hands to a GPU cut when
 * the engine has one; `posed` hears the rank of every root the rows pose. Returns the box the
 * change touched, where it was and where it now is, or `null` when no drawn root moved: a still
 * scene pays nothing downstream.
 */
export function followPlacementRows<T>(
  roots: readonly ClusterRoot<T>[],
  rows: PlacementRows,
  from: number,
  to: number,
  park?: (rank: number, parked: boolean) => void,
  posed?: (rank: number) => void,
) {
  const list = rowRoots(roots, rows);
  boxEmpty(moved, 0);
  const last = Math.min(to, rows.capacity - 1);
  for (let index = Math.max(0, from); index <= last; index++) {
    const entry = list[index];
    if (!entry) continue;
    const { root, rank } = entry;
    posed?.(rank);
    if (root.worldBox && !root.parked) boxUnionBatch(moved, root.worldBox, 1);
    const parked = rows.live[index] === 0;
    if (parked !== !!root.parked) {
      root.parked = parked;
      park?.(rank, parked);
    }
    if (root.worldBox && root.localBox)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    if (root.worldBox && !parked) boxUnionBatch(moved, root.worldBox, 1);
  }
  if (boxIsEmpty(moved, 0)) return null;
  for (let axis = 0; axis < 3; axis++) {
    movedMin[axis] = moved[axis];
    movedMax[axis] = moved[axis + 3];
  }
  return { min: movedMin, max: movedMax };
}

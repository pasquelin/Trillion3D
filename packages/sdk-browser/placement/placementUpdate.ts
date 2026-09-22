import { BOX_VALUES, boxEmpty, boxIsEmpty, boxTransform, boxUnion } from '../../sdk-core/index.ts';
import type { ClusterRoot } from '../pageSelectionTypes.ts';
import type { PlacementRows } from './placementRows.ts';

/** A root that reads a row, and its rank among the roots the cut walks. */
type RowRoot<T> = { root: ClusterRoot<T>; rank: number };

/** The roots of each instance buffer, by row: built once per root list, which a session keeps. */
const indexes = new WeakMap<readonly object[], Map<PlacementRows, RowRoot<unknown>[]>>();

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
  const list = index.get(rows) as RowRoot<T>[] | undefined;
  if (!list) throw new Error('PLACEMENT_ROWS_UNKNOWN');
  return list;
}

/** What rows the owner wrote changed: the box they left and entered, as one union. */
const moved = new Float64Array(BOX_VALUES),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0];

function unionInto(box: Float64Array) {
  boxUnion(moved, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
}

/**
 * Brings the roots of rows `from` to `to` level with what the owner wrote in them: each root's
 * world is already the row (a view), so only what the engine DERIVES from it follows — its world
 * box, reprojected from its local box, and its parked flag, which `park` hands to a GPU cut when
 * the engine has one. Returns the box the change touched, where it was and where it now is, or
 * `null` when no drawn root moved: a still scene pays nothing downstream.
 */
export function followPlacementRows<T>(
  roots: readonly ClusterRoot<T>[],
  rows: PlacementRows,
  from: number,
  to: number,
  park?: (rank: number, parked: boolean) => void,
) {
  const list = rowRoots(roots, rows);
  boxEmpty(moved, 0);
  const last = Math.min(to, rows.capacity - 1);
  for (let index = Math.max(0, from); index <= last; index++) {
    const entry = list[index];
    if (!entry) continue;
    const { root, rank } = entry;
    if (root.worldBox && !root.parked) unionInto(root.worldBox);
    const parked = rows.live[index] === 0;
    if (parked !== !!root.parked) {
      root.parked = parked;
      park?.(rank, parked);
    }
    if (root.worldBox && root.localBox)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    if (root.worldBox && !parked) unionInto(root.worldBox);
  }
  if (boxIsEmpty(moved, 0)) return null;
  for (let axis = 0; axis < 3; axis++) {
    movedMin[axis] = moved[axis];
    movedMax[axis] = moved[axis + 3];
  }
  return { min: movedMin, max: movedMax };
}

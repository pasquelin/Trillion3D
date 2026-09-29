/**
 * Where the cells of a partitioned scene are now (#404). A cell carries the box around its nodes
 * in the frame of each core parent it hangs them under (`TableCell.parents`); a page may move that
 * parent (`getObjectByName`), and the rows follow it (`cells.ts`). The plan reads each cell's boxes
 * in the scene root's frame, one per parent, rewritten once a parent moved relative to the root,
 * so a cell is read where its objects stand, not where the file declared them. How far each
 * parent stretches its cells' frame (`stretch`) is what the rows are sized by (`sizing.ts`).
 */
import {
  boxTransform,
  determinantMatrix4,
  invertMatrix4,
  MATRIX_VALUES,
  maxStretch,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import type { Stretch } from './sizing.ts';

const rootWorld = new Float64Array(MATRIX_VALUES),
  rootInverse = new Float64Array(MATRIX_VALUES),
  parentWorld = new Float64Array(MATRIX_VALUES),
  relative = new Float64Array(MATRIX_VALUES),
  inverse = new Float64Array(MATRIX_VALUES);

/** The least and the most `matrix` stretches a distance — its smallest and largest singular
 *  values —; a flattened frame, or one so nearly flat its inverse overflows, stretches it by 0. */
export function stretchOf(matrix: ArrayLike<number>): Stretch {
  const most = maxStretch(matrix);
  if (determinantMatrix4(matrix) === 0) return [0, most];
  const back = invertMatrix4(inverse, matrix).every(Number.isFinite)
    ? maxStretch(inverse)
    : Infinity;
  return [1 / back, most];
}

/** What carries boxes — a cell, or a page of the cell index (`cellIndex.ts`) —: its `[core rank, box]`
 *  per parent, its boxes in the root's frame when last written, and at which `refresh`. */
export type Boxed = { parents: Parts; bounds: Float64Array; written: number };
/** `[core rank, box]` per parent: the box in that parent's frame (`TableCell.parents`). */
export type Parts = readonly (readonly [number | null, ArrayLike<number>])[];
/** A `Boxed` over `parents`, never written. */
export const boxed = (parents: Parts): Boxed => ({
  parents,
  bounds: new Float64Array(6 * parents.length),
  written: -1,
});

/**
 * The frames of the core parents of ranks `ranks` relative to `root`, the node their scene hangs
 * on; `parents[rank]` is the host node of each core rank. `refresh` reads them again, and its
 * `stretch` holds how far each parent's frame stretches the root's then. `bounds` gives the boxes
 * of a `Boxed` in the root's frame, six values per parent, in the order of its `parents`: written
 * again only when one of those parents moved since, so a frame pays for the boxes it reads, never
 * for every cell a moved parent carries (#575).
 */
export function createCellBoxes(
  ranks: Iterable<number>,
  root: Object3D,
  parents: readonly Object3D[],
) {
  /** Each parent's matrix relative to the root when last read, and the `refresh` it moved at. */
  const frames = new Map<number, { matrix: Float64Array; moved: number }>();
  const stretch = new Map<number, Stretch>();
  for (const rank of ranks)
    frames.set(rank, { matrix: new Float64Array(MATRIX_VALUES).fill(NaN), moved: 0 });
  let now = 0;
  const refresh = () => {
    now++;
    if (frames.size) invertMatrix4(rootInverse, hostWorldChainInto(rootWorld, root));
    for (const [rank, frame] of frames) {
      multiplyMatrix4(relative, rootInverse, hostWorldChainInto(parentWorld, parents[rank]));
      if (relative.every((value, at) => Object.is(value, frame.matrix[at]))) continue;
      frame.matrix.set(relative);
      frame.moved = now;
      stretch.set(rank, stretchOf(relative));
    }
  };
  const moved = ([rank]: Parts[number], since: number) =>
    rank !== null && frames.get(rank)!.moved > since;
  const bounds = (item: Boxed) => {
    if (item.written >= 0 && !item.parents.some((part) => moved(part, item.written)))
      return item.bounds;
    item.parents.forEach(([rank, box], part) => {
      if (rank === null) item.bounds.set(box, 6 * part);
      else boxTransform(item.bounds, 6 * part, box, 0, frames.get(rank)!.matrix);
    });
    item.written = now;
    return item.bounds;
  };
  return { refresh, bounds, stretch: stretch as ReadonlyMap<number, Stretch> };
}

/** The core ranks `cells` hang nodes under. */
export const ranksOf = (cells: readonly Pick<TableCell, 'parents'>[]) =>
  new Set(cells.flatMap((cell) => cell.parents.flatMap(([rank]) => (rank === null ? [] : [rank]))));

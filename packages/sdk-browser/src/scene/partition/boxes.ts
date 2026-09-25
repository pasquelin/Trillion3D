/**
 * Where the cells of a partitioned scene are now (#404). A cell carries the box around its nodes
 * in the frame of each core parent it hangs them under (`TableCell.parents`); a page may move that
 * parent (`getObjectByName`), and the rows follow it (`cells.ts`). The plan reads each cell's boxes
 * in the scene root's frame, one per parent, rewritten whenever a parent moved relative to the
 * root, so a cell is read where its objects stand, not where the file declared them. How far each
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

/** The least and the most `matrix` stretches a distance; a flattened frame stretches it by 0. */
function stretchOf(matrix: ArrayLike<number>): Stretch {
  if (determinantMatrix4(matrix) === 0) return [0, maxStretch(matrix)];
  return [1 / maxStretch(invertMatrix4(inverse, matrix)), maxStretch(matrix)];
}

/**
 * The boxes of `cells` in the frame of `root`, the node their scene hangs on — six values per
 * parent, in the order of `TableCell.parents`; `parents[rank]` is the host node of each core rank.
 * `refresh` rewrites the boxes of the cells whose parents moved relative to the root since the
 * last call, and returns every cell with its boxes now; its `stretch` holds, per core rank, how
 * far that parent's frame stretches the root's at the last call.
 */
export function createCellBoxes(
  cells: readonly TableCell[],
  root: Object3D,
  parents: readonly Object3D[],
) {
  const boxed = cells.map((cell) => ({
    meshes: cell.meshes,
    bounds: new Float64Array(6 * cell.parents.length),
  }));
  /** Each core parent's matrix relative to the root when its boxes were last written. */
  const frames = new Map<number, Float64Array>();
  const stretch = new Map<number, Stretch>();
  for (const cell of cells)
    for (const [rank] of cell.parents)
      if (rank !== null) frames.set(rank, new Float64Array(MATRIX_VALUES).fill(NaN));
  let first = true;
  const write = (at: number) => {
    const out = boxed[at].bounds;
    cells[at].parents.forEach(([rank, box], part) => {
      if (rank === null) out.set(box, 6 * part);
      else boxTransform(out, 6 * part, box, 0, frames.get(rank)!);
    });
  };
  const refresh = () => {
    const changed = new Set<number>();
    if (frames.size) invertMatrix4(rootInverse, hostWorldChainInto(rootWorld, root));
    for (const [rank, frame] of frames) {
      multiplyMatrix4(relative, rootInverse, hostWorldChainInto(parentWorld, parents[rank]));
      if (relative.every((value, at) => Object.is(value, frame[at]))) continue;
      frame.set(relative);
      stretch.set(rank, stretchOf(relative));
      changed.add(rank);
    }
    if (!first && !changed.size) return boxed;
    for (let at = 0; at < cells.length; at++)
      if (first || cells[at].parents.some(([rank]) => rank !== null && changed.has(rank)))
        write(at);
    first = false;
    return boxed;
  };
  return Object.assign(refresh, { stretch: stretch as ReadonlyMap<number, Stretch> });
}

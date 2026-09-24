/**
 * Where the cells of a partitioned scene are now (#404). A cell carries the box around its nodes
 * in the frame of each core parent it hangs them under (`TableCell.parents`); a page may move that
 * parent (`getObjectByName`), and the rows follow it (`cells.ts`). The plan reads each cell's box
 * in the scene root's frame, rewritten from those boxes whenever a parent moved relative to the
 * root, so a cell is read where its objects stand, not where the file declared them.
 */
import {
  boxEmpty,
  boxTransform,
  boxUnion,
  invertMatrix4,
  MATRIX_VALUES,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { GraphNode } from '../../host/graph/node.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';

const rootWorld = new Float64Array(MATRIX_VALUES),
  rootInverse = new Float64Array(MATRIX_VALUES),
  parentWorld = new Float64Array(MATRIX_VALUES),
  relative = new Float64Array(MATRIX_VALUES),
  moved = new Float64Array(6);

/**
 * The boxes of `cells` in the frame of `root`, the node their scene hangs on; `parents[rank]` is
 * the host node of each core rank. `refresh` rewrites the boxes of the cells whose parents moved
 * relative to the root since the last call, and returns every cell with its box now.
 */
export function createCellBoxes(
  cells: readonly TableCell[],
  root: GraphNode,
  parents: readonly GraphNode[],
) {
  const boxed = cells.map((cell) => ({ meshes: cell.meshes, bounds: new Float64Array(6) }));
  /** Each core parent's matrix relative to the root when its boxes were last written. */
  const frames = new Map<number, Float64Array>();
  for (const cell of cells)
    for (const [rank] of cell.parents)
      if (rank !== null) frames.set(rank, new Float64Array(MATRIX_VALUES).fill(NaN));
  let first = true;
  const write = (at: number) => {
    const out = boxed[at].bounds;
    boxEmpty(out, 0);
    for (const [rank, box] of cells[at].parents) {
      if (rank === null) boxUnion(out, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
      else {
        boxTransform(moved, 0, box, 0, frames.get(rank)!);
        boxUnion(out, 0, moved[0], moved[1], moved[2], moved[3], moved[4], moved[5]);
      }
    }
  };
  return function refresh() {
    const changed = new Set<number>();
    if (frames.size) invertMatrix4(rootInverse, hostWorldChainInto(rootWorld, root));
    for (const [rank, frame] of frames) {
      multiplyMatrix4(relative, rootInverse, hostWorldChainInto(parentWorld, parents[rank]));
      if (relative.every((value, at) => Object.is(value, frame[at]))) continue;
      frame.set(relative);
      changed.add(rank);
    }
    if (!first && !changed.size) return boxed;
    for (let at = 0; at < cells.length; at++)
      if (first || cells[at].parents.some(([rank]) => rank !== null && changed.has(rank)))
        write(at);
    first = false;
    return boxed;
  };
}

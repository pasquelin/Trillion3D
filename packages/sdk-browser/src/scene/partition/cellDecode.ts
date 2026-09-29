/**
 * A PARTITION'S CELL FILE, READ OFF THE MAIN THREAD (#575). The decode pool's `cells` task
 * (`../../page/decode/task.ts`) parses the file, refuses one of another version and composes the
 * local matrix of each node as the engine composes a host node's; the main thread only copies
 * those matrices onto rows (`cells.ts`). Without a worker, the same function runs on the main
 * thread (`../../page/decode/host.ts`).
 */
import { MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { PageDecodeDone } from '../../../../sdk-core/src/index.ts';
import { assertCellNodes, type CellNode } from '../../../../sdk-core/src/scene/core/tableCell.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostLocalInto } from '../../host/world/matrices.ts';

const scratch = new Object3D();

/** The local matrix the engine composes for a cell node's declared pose, as for a host node. */
function rowLocal(node: CellNode, out: Float64Array) {
  scratch.position.set(0, 0, 0);
  scratch.quaternion.set(0, 0, 0, 1);
  scratch.scale.set(1, 1, 1);
  pose(scratch, node);
  return hostLocalInto(out, scratch);
}

/** A cell file as the pool answers it (`PageDecodeDone.cells`). */
type CellPayload = NonNullable<PageDecodeDone['cells']>;

/** The nodes of the cell file `source`, read from `url`, each its parent's and mesh's ranks and its
 *  local matrix, or the named refusal of a file of another version. */
export function decodeCellFile(source: ArrayBuffer, url = 'a scene cell'): CellPayload {
  const nodes = assertCellNodes(JSON.parse(new TextDecoder().decode(source)), url);
  const ranks = new Int32Array(2 * nodes.length),
    locals = new Float64Array(MATRIX_VALUES * nodes.length);
  nodes.forEach((node, at) => {
    ranks[2 * at] = node.parent ?? -1;
    ranks[2 * at + 1] = node.mesh;
    rowLocal(node, locals.subarray(MATRIX_VALUES * at, MATRIX_VALUES * (at + 1)));
  });
  return { nodes: nodes.length, ranks: ranks.buffer, locals: locals.buffer };
}

/** A decoded cell as its rows are written from it. */
export type CellRows = {
  /** How many nodes the cell holds. */
  nodes: number;
  /** Per node, its parent's rank (`-1`: the scene root), then its mesh's. */
  ranks: Int32Array;
  /** Per node, its local matrix. */
  locals: Float64Array;
};

/** The rows of a decoded cell. */
export const cellRows = ({ nodes, ranks, locals }: CellPayload): CellRows => ({
  nodes,
  ranks: new Int32Array(ranks),
  locals: new Float64Array(locals),
});

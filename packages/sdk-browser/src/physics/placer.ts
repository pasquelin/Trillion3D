import { NODE_TRS_DIRTY } from '../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { composeMatrix4At } from '../../../sdk-core/src/math/matrix/matrix4Compose.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { PlacedRow } from '../../../sdk-core/src/world/object/sceneLink.ts';
import type { Bodied } from './bodies.ts';

type Batch = PlacedRow['batch'];

/** True when `node` sits at the origin, unturned and unscaled: its children's world is their local. */
const atRest = (node: Object3D) => {
  const p = node.position.elements,
    q = node.quaternion.elements,
    s = node.scale.elements;
  return (
    !node.parent &&
    p[0] === 0 && p[1] === 0 && p[2] === 0 &&
    q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1 &&
    s[0] === 1 && s[1] === 1 && s[2] === 1
  );
};

/**
 * Writes the physics' drawn poses where they are read, with no per-body object on the way. Each
 * body's position and quaternion land in its node and its transform tree, so a page reading them
 * sees the drawn pose; its world matrix is composed straight into the row the renderer draws it
 * from (`SceneLink.seat`), and the world hears the written span of each instance buffer once per
 * batch of writes. A body the world holds no row for, one with children, or any body while the
 * scene itself is moved, is handed to `SceneLink.posed`, which recomposes it like any moved node.
 */
export function createPosePlacer(maxBodies: number, root: Object3D) {
  /** Where each slot's mesh keeps its pose, bound when a record first names it. */
  const owner: (Bodied | null)[] = [];
  const position: Float64Array[] = [],
    quaternion: Float64Array[] = [],
    scale: Float64Array[] = [],
    trees: ReturnType<typeof Object3D._treeOf>[] = [],
    node = new Int32Array(maxBodies);
  /** Each slot's row, `undefined` until asked, `null` when it has none (or must not use it). */
  let seats: (PlacedRow | null | undefined)[] = [];
  /** Each slot's row and batch, as a rank in `batches`, whose written span is `from`..`to`. */
  const rowOf = new Int32Array(maxBodies),
    batchOf = new Int32Array(maxBodies);
  const batches: Batch[] = [],
    matrices: Float64Array[] = [],
    from: number[] = [],
    to: number[] = [];
  let epoch = NaN,
    direct = false,
    placed: Bodied[] = [];
  const seatOf = (index: number, mesh: Bodied) => {
    const seat = direct && !mesh.children.length ? (mesh._link?.seat?.(mesh) ?? null) : null;
    seats[index] = seat;
    if (!seat) return seat;
    let rank = batches.indexOf(seat.batch);
    if (rank < 0) {
      rank = batches.push(seat.batch) - 1;
      matrices[rank] = seat.batch.rows!.matrices;
      from[rank] = Infinity;
      to[rank] = -1;
    }
    batchOf[index] = rank;
    rowOf[index] = seat.row;
    return seat;
  };
  return {
    owner,
    position,
    quaternion,
    bind(index: number, mesh: Bodied) {
      owner[index] = mesh;
      position[index] = mesh.position.elements;
      quaternion[index] = mesh.quaternion.elements;
      scale[index] = mesh.scale.elements;
      node[index] = mesh.index;
      trees[index] = Object3D._treeOf(mesh);
      seats[index] = undefined;
    },
    /** Opens a batch of writes: the rows asked before are dropped when the world moved them. */
    begin() {
      const link = root._link;
      const now = link?.seatEpoch?.() ?? NaN,
        rest = !!link?.seat && atRest(root);
      if (now !== epoch || rest !== direct) {
        seats = [];
        batches.length = matrices.length = 0;
      }
      epoch = now;
      direct = rest;
      for (let b = 0; b < batches.length; b++) (from[b] = Infinity), (to[b] = -1);
    },
    /** Writes slot `index` at `pose` (7 numbers from `at`): node, tree, and row. */
    place(index: number, pose: ArrayLike<number>, at: number) {
      const mesh = owner[index]!;
      const tree = trees[index];
      const p = position[index],
        q = quaternion[index],
        n = node[index];
      const tp = tree.position,
        tq = tree.quaternion;
      tp[n * 3] = p[0] = pose[at];
      tp[n * 3 + 1] = p[1] = pose[at + 1];
      tp[n * 3 + 2] = p[2] = pose[at + 2];
      tq[n * 4] = q[0] = pose[at + 3];
      tq[n * 4 + 1] = q[1] = pose[at + 4];
      tq[n * 4 + 2] = q[2] = pose[at + 5];
      tq[n * 4 + 3] = q[3] = pose[at + 6];
      tree.flags[n] |= NODE_TRS_DIRTY;
      if (!mesh._link) return;
      if (!(seats[index] === undefined ? seatOf(index, mesh) : seats[index]))
        return void placed.push(mesh);
      const b = batchOf[index],
        row = rowOf[index];
      composeMatrix4At(matrices[b], row * 16, p, 0, q, 0, scale[index], 0);
      if (row < from[b]) from[b] = row;
      if (row > to[b]) to[b] = row;
    },
    /** Closes the batch: the world hears the written rows and the nodes it recomposes itself. */
    end() {
      const link = root._link;
      for (let b = 0; b < batches.length; b++)
        if (to[b] >= 0) link?.placed?.(batches[b], from[b], to[b]);
      // The list is read before the next frame, which gets a fresh one.
      if (placed.length) link?.posed(placed);
      placed = [];
    },
  };
}

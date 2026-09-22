import type * as THREE from 'three';
import {
  NODE_AUTO_UPDATE,
  markNodeWorldNeedsUpdate,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  type TransformTree,
} from '../sdk-core/index.ts';

/**
 * ENTRY of a host local pose into the engine's transform tree.
 *
 * The scene belongs to the host and the host writes its local poses; the engine mirrors them in
 * its own tree and computes the world matrices there. What makes a pass cheap is what is NOT
 * written: a pose setter marks the node dirty, so writing ten numbers that have not changed
 * would make the whole subtree recompute for nothing. Each number is therefore compared to the
 * one the tree already holds, and only a number that moved is written.
 *
 * The comparison is bit for bit and reads the tree's flat arrays directly — the same storage the
 * setters write, so what is compared is exactly what the next composition would use. It is
 * `Object.is`, not `!==`: `-0` and `0` compose translations that differ by the sign of a zero,
 * which the bit-exactness proofs read, and a pose left at `NaN` compares equal to itself instead
 * of being rewritten on every pass for nothing.
 */

/** True when the sixteen numbers of a set matrix are those the tree already holds, sign of zero
 *  and `NaN` included — `sameElements` answers on `!==`, which merges `-0` with `0`. */
function sameMatrixBits(held: Float64Array, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (!Object.is(held[i], now[i])) return false;
  return true;
}

/**
 * Local pose of the host `node` into the tree node of rank `rank`. Returns true when something
 * was written, hence when the subtree under that node will be recomputed by the next pass.
 */
export function pushHostPose(tree: TransformTree, rank: number, node: THREE.Object3D) {
  const auto = node.matrixAutoUpdate;
  let moved = false;
  if (auto !== ((tree.flags[rank] & NODE_AUTO_UPDATE) !== 0)) {
    setNodeAutoUpdate(tree, rank, auto);
    moved = true;
  }
  // Recomposition cut: the matrix the host set IS the pose, and nothing recomposes it. It carries
  // no reach flag either, so the mark the reference calls `matrixWorldNeedsUpdate` is what tells
  // an update rule starting above not to walk past this node.
  if (!auto) {
    if (!sameMatrixBits(tree.localViews[rank], node.matrix.elements)) {
      setNodeLocalMatrix(tree, rank, node.matrix.elements);
      moved = true;
    }
    if (moved) markNodeWorldNeedsUpdate(tree, rank);
    return moved;
  }
  const { position: p, quaternion: q, scale: s } = node;
  const at = rank * 3,
    turn = rank * 4;
  const position = tree.position,
    quaternion = tree.quaternion,
    scale = tree.scale;
  if (
    !Object.is(position[at], p.x) ||
    !Object.is(position[at + 1], p.y) ||
    !Object.is(position[at + 2], p.z)
  ) {
    setNodePosition(tree, rank, p.x, p.y, p.z);
    moved = true;
  }
  if (
    !Object.is(quaternion[turn], q.x) ||
    !Object.is(quaternion[turn + 1], q.y) ||
    !Object.is(quaternion[turn + 2], q.z) ||
    !Object.is(quaternion[turn + 3], q.w)
  ) {
    setNodeQuaternion(tree, rank, q.x, q.y, q.z, q.w);
    moved = true;
  }
  if (
    !Object.is(scale[at], s.x) ||
    !Object.is(scale[at + 1], s.y) ||
    !Object.is(scale[at + 2], s.z)
  ) {
    setNodeScale(tree, rank, s.x, s.y, s.z);
    moved = true;
  }
  return moved;
}

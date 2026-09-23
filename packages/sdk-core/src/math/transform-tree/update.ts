import { copyMatrix4, multiplyMatrix4 } from '../matrix/matrix4.ts';
import { composeMatrix4 } from '../matrix/matrix4Trs.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  NODE_WORLD_NEEDS_UPDATE,
  type TransformTree,
} from './transformTree.ts';
import { ensureOrder, nextStamp, visitSubtree } from './structure.ts';

/**
 * World-matrix update, batched and without allocation, with the semantics of the reference
 * `updateMatrixWorld(force)` and `updateWorldMatrix(updateParents, updateChildren)`.
 *
 * The reference recomposes and remultiplies every node its rule reaches. Here, a reached node is
 * recalculated only if an input has changed since its last calculation: written position, rotation or
 * scale, set local matrix, changed parent, or parent world matrix recalculated since (the parent's
 * `version` counter against the node's `seen`). Recalculating unchanged inputs would yield the same
 * bits: the matrices are the reference's, at every instant it computes them. A node its
 * rule does not reach keeps, as with it, a late world matrix.
 */

/**
 * `matrixWorldNeedsUpdate`. A node whose recomposition is cut carries a local matrix nobody
 * recomposes, and setting that matrix marks no reach flag: a rule that starts above would walk
 * past it. This is the mark the reference sets in that case, and the only way to set it here.
 */
export function markNodeWorldNeedsUpdate(tree: TransformTree, node: number) {
  tree.flags[node] |= NODE_WORLD_NEEDS_UPDATE;
}

const composePosition = new Float64Array(3),
  composeQuaternion = new Float64Array(4),
  composeScale = new Float64Array(3);

/** `updateMatrix`: the local matrix from the node's position, rotation and scale. */
function composeLocal(tree: TransformTree, node: number) {
  const { position, quaternion, scale } = tree;
  const p = node * 3,
    q = node * 4;
  composePosition[0] = position[p];
  composePosition[1] = position[p + 1];
  composePosition[2] = position[p + 2];
  composeQuaternion[0] = quaternion[q];
  composeQuaternion[1] = quaternion[q + 1];
  composeQuaternion[2] = quaternion[q + 2];
  composeQuaternion[3] = quaternion[q + 3];
  composeScale[0] = scale[p];
  composeScale[1] = scale[p + 1];
  composeScale[2] = scale[p + 2];
  composeMatrix4(tree.localViews[node], composePosition, composeQuaternion, composeScale);
}

/**
 * A reached node: local matrix recomposed if update is automatic and the pose written,
 * then world matrix = parent world × local (the local copied for a root) if an input has
 * changed. Flags are read once and written once, `worldNeedsUpdate` included: cleared by
 * `updateMatrixWorld`, set by `updateWorldMatrix` under automatic update.
 */
function refreshNode(tree: TransformTree, node: number, fromWorldMatrix: boolean) {
  const flags = tree.flags[node],
    auto = (flags & NODE_AUTO_UPDATE) !== 0,
    compose = auto && (flags & NODE_TRS_DIRTY) !== 0;
  if (compose) composeLocal(tree, node);
  let next = compose ? flags & ~NODE_TRS_DIRTY : flags;
  if (fromWorldMatrix) {
    if (auto) next |= NODE_WORLD_NEEDS_UPDATE;
  } else next &= ~NODE_WORLD_NEEDS_UPDATE;
  const parent = tree.parent[node],
    version = tree.version,
    changed = compose || (flags & NODE_LOCAL_CHANGED) !== 0;
  if (parent < 0) {
    if (changed) {
      const at = node * 16;
      copyMatrix4(tree.world, tree.local, at, at);
      tree.seen[node] = 0;
      version[node] = (version[node] + 1) >>> 0;
    }
  } else {
    const parentVersion = version[parent];
    if (changed || tree.seen[node] !== parentVersion) {
      multiplyMatrix4(tree.worldViews[node], tree.worldViews[parent], tree.localViews[node]);
      tree.seen[node] = parentVersion;
      version[node] = (version[node] + 1) >>> 0;
    }
  }
  tree.flags[node] = next & ~NODE_LOCAL_CHANGED;
}

const stepWorldMatrix = (tree: TransformTree, node: number) => refreshNode(tree, node, true);

/**
 * `node.updateMatrixWorld(force)`: the node and its whole subtree, parents first. A node is
 * reached if it updates automatically, if it is marked, or if `force` — that of the call for
 * `node`, otherwise "the parent was reached". Ancestors of `node` are not reread. The stamp of a
 * visited node is `2 · traversal + reached`: one read tells the child whether it is in the
 * subtree and what its parent passes it.
 */
export function updateNodeMatrixWorld(tree: TransformTree, node: number, force = false) {
  ensureOrder(tree);
  const { order, parent, stamp, flags } = tree;
  const visited = nextStamp(tree) * 2,
    reach = NODE_AUTO_UPDATE | NODE_WORLD_NEEDS_UPDATE;
  const reached = force || (flags[node] & reach) !== 0;
  if (reached) refreshNode(tree, node, false);
  stamp[node] = reached ? visited | 1 : visited;
  for (let k = tree.orderAt[node] + 1, end = tree.orderCount; k < end; k++) {
    const j = order[k],
      p = parent[j];
    if (p < 0) continue;
    const mark = stamp[p];
    if ((mark | 1) !== (visited | 1)) continue;
    if (mark !== visited || (flags[j] & reach) !== 0) {
      refreshNode(tree, j, false);
      stamp[j] = visited | 1;
    } else stamp[j] = visited;
  }
}

/**
 * `node.updateWorldMatrix(updateParents, updateChildren)`: ancestors from the root toward `node` if
 * requested, the node, then its whole subtree if requested.
 */
export function updateNodeWorldMatrix(
  tree: TransformTree,
  node: number,
  updateParents: boolean,
  updateChildren: boolean,
) {
  if (updateParents) {
    const { chain, parent } = tree;
    let links = 0;
    for (let walk = parent[node]; walk >= 0; walk = parent[walk]) chain[links++] = walk;
    while (links > 0) refreshNode(tree, chain[--links], true);
  }
  if (updateChildren) visitSubtree(tree, node, stepWorldMatrix);
  else refreshNode(tree, node, true);
}

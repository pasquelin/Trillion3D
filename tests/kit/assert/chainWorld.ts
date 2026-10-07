import { composeMatrix4 } from '../../../packages/math/src/matrix/matrix4Trs.ts'
import { multiplyMatrix4 } from '../../../packages/math/src/matrix/matrix4.ts'
import {
  NODE_AUTO_UPDATE,
  type TransformTree,
} from '../../../packages/sdk-core/src/world/transform-tree/transformTree.ts'
import { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'

/**
 * The world matrix of slot `node` of `tree` from the local poses of its chain alone: each pose
 * composed — the local matrix as set when the node does not recompose it —, times its parent's,
 * up to its root. It reads no world matrix and writes nothing: the oracle the tree's matrices are
 * held to, which a test calls without touching the state it checks.
 */
function treeWorld(tree: TransformTree, node: number): Float64Array {
  const local = new Float64Array(16)
  if (tree.flags[node] & NODE_AUTO_UPDATE) {
    const { position: p, quaternion: q, scale: s } = tree
    composeMatrix4(
      local,
      p.subarray(node * 3, node * 3 + 3),
      q.subarray(node * 4, node * 4 + 4),
      s.subarray(node * 3, node * 3 + 3),
    )
  } else local.set(tree.localViews[node])
  const parent = tree.parent[node]
  return parent < 0 ? local : multiplyMatrix4(local, treeWorld(tree, parent), local)
}

/** `treeWorld` of a scene node. */
export const chainWorld = (node: Object3D) => treeWorld(Object3D._treeOf(node), node.index)

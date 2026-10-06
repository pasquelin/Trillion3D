import { listen } from '../math/observed.ts'
import type { TransformTree } from '../../math/transform-tree/transformTree.ts'
import type { Object3D } from './object3d.ts'

/** The nodes whose pose values are views of their tree's slots, by slot: pointed at the new stores
 *  when the tree grows (`TransformTree.grew`). */
const viewers = new WeakMap<TransformTree, (WeakRef<Object3D> | undefined)[]>()

/** `node`'s position, quaternion and scale made views of its slot of `tree`, their numbers kept. */
function viewSlot(node: Object3D, tree: TransformTree) {
  const at = node.index * 3,
    q = node.index * 4
  node.position._share(tree.position.subarray(at, at + 3))
  node.quaternion._share(tree.quaternion.subarray(q, q + 4))
  node.scale._share(tree.scale.subarray(at, at + 3))
}

/** The tree grew: each live node's values that still viewed the replaced stores view the new. */
function regrow(
  tree: TransformTree,
  nodes: (WeakRef<Object3D> | undefined)[],
  position: Float64Array,
  quaternion: Float64Array,
  scale: Float64Array,
) {
  for (let slot = 0; slot < nodes.length; slot++) {
    const node = nodes[slot]?.deref()
    if (!node) continue
    const at = slot * 3,
      q = slot * 4
    if (node.position.elements.buffer === position.buffer)
      node.position._share(tree.position.subarray(at, at + 3))
    if (node.quaternion.elements.buffer === quaternion.buffer)
      node.quaternion._share(tree.quaternion.subarray(q, q + 4))
    if (node.scale.elements.buffer === scale.buffer)
      node.scale._share(tree.scale.subarray(at, at + 3))
  }
}

/**
 * Every write to `node`'s position, rotation, quaternion or scale lands in its slot of the
 * transform tree, which lists it for the frame pass, and reaches the world that draws it. The
 * position, quaternion and scale ARE that slot: their numbers are views of `tree`'s stores, one
 * copy a pose, re-pointed when the tree grows — until an owner writing poses by the thousand shares
 * them with its own arrays (`ObservedComponents._share`, the physics placer), or the node is
 * destroyed (`releasePose`). The listener copies the value's numbers into the slot either way: a
 * shared value is not the slot, and a destroyed node refuses the write (`SceneNode.setPosition`).
 */
export function bindPose(node: Object3D, tree: TransformTree) {
  const { position, quaternion, rotation, scale } = node
  listen(position, () => {
    const e = position.elements
    node.setPosition(e[0], e[1], e[2])
    node._link?.pose(node)
  })
  listen(scale, () => {
    const e = scale.elements
    node.setScale(e[0], e[1], e[2])
    node._link?.pose(node)
  })
  /** Written angles stay as written (`object3d.test.ts`); a quaternion write re-derives them. */
  const turned = (fromAngles: boolean) => {
    const q = fromAngles ? quaternion.setFromEuler(rotation, true) : quaternion,
      e = q.elements
    node.setQuaternion(e[0], e[1], e[2], e[3])
    if (fromAngles) rotation._follow(q)
    node._link?.pose(node)
  }
  rotation._follow(quaternion)
  listen(quaternion, () => turned(false))
  listen(rotation, () => turned(true))
  viewSlot(node, tree)
  let nodes = viewers.get(tree)
  if (!nodes) {
    const seen: (WeakRef<Object3D> | undefined)[] = (nodes = [])
    viewers.set(tree, nodes)
    tree.grew = (position, quaternion, scale) => regrow(tree, seen, position, quaternion, scale)
  }
  nodes[node.index] = new WeakRef(node)
}

/** `node`, destroyed, keeps in arrays of its own the numbers that viewed its slot, which will
 *  serve another node; numbers an owner shares stay its. */
export function releasePose(node: Object3D, tree: TransformTree) {
  const nodes = viewers.get(tree)
  if (nodes?.[node.index]?.deref() === node) nodes[node.index] = undefined
  const { position, quaternion, scale } = node
  if (position.elements.buffer === tree.position.buffer) position._share(new Float64Array(3))
  if (quaternion.elements.buffer === tree.quaternion.buffer) quaternion._share(new Float64Array(4))
  if (scale.elements.buffer === tree.scale.buffer) scale._share(new Float64Array(3))
}

/** The other way, after the tree was written first (`attach`, `lookAt`): `node`'s values take its slot's
 *  pose quietly, the angles following the quaternion when read, and the world hears it once. */
export function readPose(node: Object3D, tree: TransformTree) {
  const { position, quaternion, scale } = tree,
    at = node.index * 3,
    q = node.index * 4
  for (let i = 0; i < 3; i++) {
    node.position.elements[i] = position[at + i]
    node.scale.elements[i] = scale[at + i]
  }
  node.quaternion.set(quaternion[q], quaternion[q + 1], quaternion[q + 2], quaternion[q + 3], true)
  node._link?.pose(node)
}

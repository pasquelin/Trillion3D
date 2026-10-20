import { decomposeMatrix4 } from '../../../../math/src/matrix/matrix4Trs.ts'
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../../camera/world.ts'

const position = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  extent = new Vector3()

/** A node's world position, quaternion and scale, the one decomposition of its world matrix by the
 *  core (`decomposeMatrix4`) — the engine reads the node's sixteen floats, it does not compute with
 *  its matrix —, in scratch every caller shares: read them at once. */
export function worldPoseOf(node: Object3D) {
  const world = resolveCameraWorld(node).matrixWorld.elements
  decomposeMatrix4(world, position.elements, turn.elements, size.elements)
  return { position: position.elements, quaternion: turn.elements, scale: size }
}

/** The reach a moving body's tiles are loaded around, cached when its slot is claimed: the half
 *  diagonal of `node`'s own box at its world `scale`, its largest axis (0 with no box). */
export function reachOf(node: Object3D, scale: { x: number; y: number; z: number }) {
  const box = node.localBounds()
  if (!box || box.isEmpty()) return 0
  const most = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
  return (box.getSize(extent).length() / 2) * most
}

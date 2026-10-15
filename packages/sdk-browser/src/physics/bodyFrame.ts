import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts'
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../camera/world.ts'

const position = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3()

/** A node's world position, quaternion and scale, the one decomposition of its world matrix, in
 *  scratch every caller shares: read them at once. */
export function worldPoseOf(node: Object3D) {
  resolveCameraWorld(node).matrixWorld.decompose(position, turn, size)
  return { position: position.elements, quaternion: turn.elements, scale: size }
}

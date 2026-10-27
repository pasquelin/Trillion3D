import type { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { ControlCamera } from './types.ts'
import { screenWorldLength } from './math.ts'
import { loadXyz, loadXyzw } from '../../../../sdk-core/src/world/math/likes.ts'

/**
 * THE ONE PLACE A CONTROLLER TOUCHES A CAMERA. The controllers themselves only ever see the
 * flat numbers below, so `tests/integration/engine-structure.test.ts` has a single file to
 * declare: a controller writes a LOCAL pose, exactly where a host writing the same motion by
 * hand would write it, and never resolves a world pose — that remains `../world.ts`.
 *
 * The vectors handed back are the HOST's own: `object.position` is the camera's live position,
 * and `vector()` clones it to make a target of the same kind. Nothing here names a host
 * library, and nothing allocates per frame beyond those two clones.
 */
export interface ControlPose {
  /** The camera as the contract exposes it; its `position` is live. */
  object: { position: Vector3 }
  /** A fresh vector of the host's kind, zeroed. */
  vector(): Vector3
  /** The world length spanning `share` of the picture's height at view `depth`
   *  (`screenWorldLength`): perspective or orthographic, as the camera draws. */
  worldLength(depth: number, share: number): number
  readPosition(out: Float64Array): Float64Array
  readOrientation(out: Float64Array): Float64Array
  /** Writes position and orientation back, then makes the camera's matrices current. `target`, the
   *  point the controller keeps the camera on, becomes the camera's `viewTarget`; a controller that
   *  keeps none gives no `target`, and the camera frames none. */
  write(
    position: ArrayLike<number>,
    orientation: ArrayLike<number>,
    target?: ArrayLike<number>,
  ): void
}

export function controlPose(camera: ControlCamera): ControlPose {
  return {
    object: camera,
    vector: () => camera.position.clone().set(0, 0, 0),
    worldLength: (depth, share) => screenWorldLength(camera, depth, share),
    readPosition: (out) => loadXyz(out, camera.position),
    readOrientation: (out) => loadXyzw(out, camera.quaternion),
    write(position, orientation, target) {
      camera.position.set(position[0], position[1], position[2])
      camera.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3])
      camera.updateMatrixWorld()
      camera.setViewTarget(target ? [target[0], target[1], target[2]] : null)
    },
  }
}

/** Writes flat numbers back into a host vector. */
export function writeVector(v: Vector3, from: ArrayLike<number>) {
  v.set(from[0], from[1], from[2])
  return v
}

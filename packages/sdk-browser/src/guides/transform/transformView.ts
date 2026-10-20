import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { screenWorldLength } from '../../camera/controls/math.ts'

const eye = new Vector3(),
  ahead = new Vector3()

/**
 * The world length that spans `share` of the canvas height at `point`, as `camera` draws it
 * (`screenWorldLength`): what keeps handles one screen size wherever their object stands.
 */
export function handleScreenSize(camera: Camera, point: Vector3, share: number) {
  camera.getWorldPosition(eye)
  camera.getWorldDirection(ahead)
  const depth = Math.max(ahead.dot(point) - ahead.dot(eye), camera.near)
  return screenWorldLength(camera, depth, share)
}

import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'

/** View-projection of the image as the GPU reads it, flattened: sixteen floats rewritten each
 *  image, never reallocated. */
export const viewProj = new Float64Array(16)

/** The words every distance-field image tells of the camera and the frame's targets. */
interface CameraWords {
  view: readonly [number, number]
  extent: readonly [number, number]
  world: ArrayLike<number>
  projection: ArrayLike<number>
  near: number
  far: number
  perspective: boolean
}

/** Writes into `image` the camera and targets words the passes of a view share: the drawn size, the size of the buffers, the
 *  camera's matrices and range; the image keeps its own words beside them. */
export function describeImage(image: CameraWords, rt: WebgpuPagesRuntime, cam: EngineCamera) {
  image.view = rt.gpu.targetSize
  image.extent = rt.gpu.allocatedSize
  image.world = cam.world
  image.projection = cam.projection
  image.near = cam.near
  image.far = cam.far
  image.perspective = cam.perspective > 0.5
}

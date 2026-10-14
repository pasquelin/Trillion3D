import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { FRAME_HEAD, VIEW_AFFINE, VIEW_MIRRORED } from '../blend/frameHead.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuBlendState } from '../blend/state.ts'

/** The image's matrices in single precision, and the double inverse they are rounded from: a
 *  frame allocates nothing. */
const single = new Float32Array(16),
  singleWords = new Uint32Array(single.buffer),
  inverse = new Float64Array(16)

/**
 * What the water rectangle projects with (`rectWgsl.ts`), into the head of the frame data
 * (`../blend/frameHead.ts`): the image's jittered `projection` rounded to single precision, as the
 * surfaces draw with it, and its inverse — the double inverse of the double matrix, then rounded,
 * as the deferred uniform holds it —; the camera's view in doubles and its near plane; the target's
 * `size`; whether the view's last row is `0, 0, 0, 1` and whether the projection's last row is
 * minus the view's third (`projectCornersInto`, decided once here in doubles); the water items.
 */
export function writeWaterFrame(
  blendState: WebgpuBlendState,
  camera: EngineCamera,
  projection: ArrayLike<number>,
  size: readonly number[],
) {
  const words = blendState.frameWords,
    doubles = blendState.frameDoubles,
    v = camera.view
  single.set(projection)
  const affine = v[3] === 0 && v[7] === 0 && v[11] === 0 && v[15] === 1
  const mirrored =
    single[3] === -v[2] && single[7] === -v[6] && single[11] === -v[10] && single[15] === -v[14]
  words.set(singleWords, FRAME_HEAD.projection)
  invertMatrix4(inverse, projection)
  single.set(inverse)
  words.set(singleWords, FRAME_HEAD.inverse)
  doubles.set(v, FRAME_HEAD.view / 2)
  doubles[FRAME_HEAD.near / 2] = camera.near
  words[FRAME_HEAD.width] = size[0]
  words[FRAME_HEAD.height] = size[1]
  words[FRAME_HEAD.viewForm] = (affine ? VIEW_AFFINE : 0) | (mirrored ? VIEW_MIRRORED : 0)
  words[FRAME_HEAD.waters] = blendState.transmissive
}

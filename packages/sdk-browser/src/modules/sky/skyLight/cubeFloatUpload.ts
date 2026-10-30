import type { SkyLightCubemap } from '../../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { CUBE_FACES } from './layout.ts'

/** The channels uploaded in one image, at most, past the first face: a cube of a big side goes up face by face, not in one stall. */
export const CONVERT_BUDGET = 1 << 20

/** The upload of a cube's faces as full floats: how many are up, and the face's texels reused for every face while it is open. */
export interface FloatUpload {
  uploaded: number
  rgba: Float32Array<ArrayBuffer> | undefined
}

/**
 * The faces of `data` not yet up written into the first mip of `texture` (`rgba32float`, `CUBE_FACES` layers), four channels a texel
 * with an opaque alpha: as many as the budget of this image holds, and at least one. True once the six are up, the face buffer then let go of.
 */
export function uploadCubeFloats(
  device: GPUDevice,
  texture: GPUTexture,
  data: SkyLightCubemap,
  state: FloatUpload,
) {
  const { size, texels } = data
  const faceTexels = size * size
  const rgba = (state.rgba ??= new Float32Array(faceTexels * 4))
  let budget = CONVERT_BUDGET
  while (state.uploaded < CUBE_FACES && (budget > 0 || state.uploaded === 0)) {
    const face = state.uploaded
    for (let i = 0; i < faceTexels; i++) {
      rgba[i * 4] = texels[(face * faceTexels + i) * 3]
      rgba[i * 4 + 1] = texels[(face * faceTexels + i) * 3 + 1]
      rgba[i * 4 + 2] = texels[(face * faceTexels + i) * 3 + 2]
      rgba[i * 4 + 3] = 1
    }
    device.queue.writeTexture(
      { texture, origin: [0, 0, face] },
      rgba,
      { bytesPerRow: size * 16, rowsPerImage: size },
      { width: size, height: size },
    )
    state.uploaded++
    budget -= faceTexels * 3
  }
  if (state.uploaded < CUBE_FACES) return false
  state.rgba = undefined
  return true
}

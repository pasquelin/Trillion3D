import { toHalf } from '../../../../../math/src/float/half.ts'
import {
  skyLightCubemapScales,
  type SkyLightCubemapFit,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { SkyLightCubemap } from '../../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { CUBE_FACES } from './layout.ts'

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  COPY_DST = 2

/** The channels converted to half floats in one image, at most, past the first face: a cube of a big
 *  side is written face by face over several images, not in one stall (a 1024 side holds 18.9 million). */
const CONVERT_BUDGET = 1 << 20

const peaks = new WeakMap<object, number>()

/** The largest number of the cubemap's texels, found once for its texels. */
const cubemapPeak = (cube: SkyLightCubemap) => {
  const { texels } = cube
  let peak = peaks.get(texels)
  if (peak === undefined) {
    peak = 0
    for (let i = 0; i < texels.length; i++) if (texels[i] > peak) peak = texels[i]
    peaks.set(texels, peak)
  }
  return peak
}

/**
 * The cube texture of a cubemap held as data (`SkyLightCubemap`), the faces written so far
 * (`written` of six): six faces of `size` texels, the texels' radiance in four half floats a texel,
 * times `fit.cube`. Where the brightest texel of the cube and of the one it blends to passes what a
 * half float holds, `fit` rescales both alike (`skyLightCubemapScales`, one scale for the pair: the
 * mix of two cubes is then of two lights in the same unit) and the light is given the inverse
 * (`scale`, `SkyLightInputs.cubemapScale`), so that nothing is clamped and the light is the cube's, on
 * any device. Handed to the capture as `SkyLightInputs.cubemap` once whole.
 */
export interface SkyCubemapUpload {
  readonly texture: GPUTexture
  readonly scale: number
  readonly fit: SkyLightCubemapFit
  written: number
  /** One face's texels, reused for every face while the upload is open. */
  rgba?: Uint16Array<ArrayBuffer>
}

/** The texture of `cube`, none of its faces written yet. */
export function openSkyCubemap(
  device: GPUDevice,
  cube: SkyLightCubemap,
  fit: SkyLightCubemapFit,
  label = 'Trillion3D sky light cubemap',
): SkyCubemapUpload {
  const { size } = cube
  const texture = device.createTexture({
    label,
    size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES },
    format: 'rgba16float',
    usage: TEXTURE_BINDING | COPY_DST,
  })
  return { texture, scale: fit.light, fit, written: 0 }
}

/**
 * The next faces of `cube` written into `upload`'s texture: at least one, and as many as the budget
 * of this image holds (`CONVERT_BUDGET` channels). True when the six are written.
 */
export function writeSkyCubemapFaces(
  device: GPUDevice,
  upload: SkyCubemapUpload,
  cube: SkyLightCubemap,
) {
  const { size, texels } = cube
  const faceTexels = size * size
  upload.rgba ??= new Uint16Array(faceTexels * 4)
  const { rgba, fit, texture } = upload
  let budget = CONVERT_BUDGET
  while (upload.written < CUBE_FACES && (budget > 0 || upload.written === 0)) {
    const face = upload.written
    const at = face * faceTexels * 3
    for (let i = 0; i < faceTexels; i++) {
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = toHalf(texels[at + i * 3 + c] * fit.cube)
      rgba[i * 4 + 3] = toHalf(1)
    }
    device.queue.writeTexture(
      { texture, origin: [0, 0, face] },
      rgba,
      { bytesPerRow: size * 8, rowsPerImage: size },
      { width: size, height: size },
    )
    upload.written++
    budget -= faceTexels * 3
  }
  if (upload.written === CUBE_FACES) upload.rgba = undefined
  return upload.written === CUBE_FACES
}

/** The fit of a pair of cubes: one scale for both, from the brighter. */
export const cubemapPairFit = (...cubes: (SkyLightCubemap | undefined)[]) =>
  skyLightCubemapScales(Math.max(0, ...cubes.map((cube) => (cube ? cubemapPeak(cube) : 0))))

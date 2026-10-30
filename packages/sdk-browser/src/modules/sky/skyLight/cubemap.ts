import { rgbToHalfRgba } from '../../../gpu/core/halfTexels.ts'
import {
  skyLightCubemapScales,
  type SkyLightCubemapFit,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { SkyLightCubemap } from '../../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { abandonCubePeak, cubePeak, floatCubeOf } from './cubePeak.ts'
import { CONVERT_BUDGET } from './cubeFloatUpload.ts'
import { convertCubeHalf } from './cubeHalf.ts'
import { CUBE_FACES } from './layout.ts'

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  COPY_DST = 2

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

/** The texture of `cube` with `mipLevelCount` levels, none of its faces written yet. */
export function openSkyCubemap(
  device: GPUDevice,
  cube: SkyLightCubemap,
  fit: SkyLightCubemapFit,
  label = 'Trillion3D sky light cubemap',
  mipLevelCount = 1,
): SkyCubemapUpload {
  const { size } = cube
  const texture = device.createTexture({
    label,
    size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES },
    mipLevelCount,
    format: 'rgba16float',
    usage: TEXTURE_BINDING | STORAGE_BINDING | COPY_DST,
  })
  return { texture, scale: fit.light, fit, written: 0 }
}

/**
 * `upload`'s texture made from the float cube the peak was found over, still on the GPU (`floatCubeOf`), in one dispatch: the cube is not
 * written from the CPU a second time. False, nothing done, where that cube is gone (the ambient cubemap took it, the pair's scale changed
 * after it was let go of) or the kernel is still compiling: the faces are written by `writeSkyCubemapFaces` then.
 */
export function convertSkyCubemap(
  device: GPUDevice,
  upload: SkyCubemapUpload,
  cube: SkyLightCubemap,
) {
  const floats = floatCubeOf(device, cube)
  if (!floats || !convertCubeHalf(device, floats, upload.texture, cube, upload.fit.cube))
    return false
  upload.written = CUBE_FACES
  return true
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
    rgbToHalfRgba(rgba, texels, face * faceTexels * 3, faceTexels, fit.cube)
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

/**
 * The fit of a pair of cubes: one scale for both, from the brighter, none until the GPU has returned both peaks (`cubePeak`). Both
 * reductions are started in the same image, so the pair waits for the slower of the two, not for one after the other.
 */
export function cubemapPairFit(
  device: GPUDevice,
  owner: object,
  keep: (cube: SkyLightCubemap) => boolean,
  ...cubes: (SkyLightCubemap | undefined)[]
) {
  const peaks = cubes.map((cube) => (cube ? cubePeak(device, cube, owner, keep(cube)) : 0))
  const found = peaks.filter((peak) => peak !== undefined)
  return found.length === peaks.length ? skyLightCubemapScales(Math.max(0, ...found)) : undefined
}

/** The cubes whose peak is being measured on `device` for `owner`, kept in step with the ones it wants now: its hold on the measure of a cube it no longer wants is given up. */
export function followMeasured(
  device: GPUDevice,
  owner: object,
  measured: readonly SkyLightCubemap[] | undefined,
  wanted: readonly SkyLightCubemap[],
) {
  for (const old of measured ?? [])
    if (!wanted.some((cube) => cube.texels === old.texels)) abandonCubePeak(device, old, owner)
  return wanted
}

import { HALF_MAX } from '../../../../math/src/constants.ts'
import { toHalf } from '../../../../math/src/float/half.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import {
  cubemapMipCount,
  faceAverages,
  type ResolvedFogCubemap,
} from '../../../../sdk-core/src/scene/core/fogCubemap.ts'

/** Half float bits of 1: a texel's alpha. */
const HALF_ONE = toHalf(1)

/** The half floats of the `texels` RGB texels of `rgb`, a one in the alpha channel. */
function rgba16(rgb: ArrayLike<number>, from: number, texels: number) {
  const out = new Uint16Array(texels * 4)
  for (let i = 0; i < texels; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = toHalf(Math.min(rgb[from + i * 3 + c], HALF_MAX))
    out[i * 4 + 3] = HALF_ONE
  }
  return out
}

/**
 * THE FOG'S CUBEMAP AS A TEXTURE: a cube of half floats with its whole chain of levels, of which two
 * are filled — the picture, level 0, and the smallest, one texel a face holding the face's mean
 * colour (`faceAverages`) — the only two the fog reads, by the sampler trilinear and seamless
 * across the faces' edges: a ray's colour is continuous over the whole sphere, at level 0 and at
 * the smallest alike, where the smallest level's six texels meet. The levels between are never
 * read (the fog asks for level 0 and the last). Made when the scene sets a cubemap, kept while it
 * holds that picture, released with the scene's fog.
 */
export function createFogCubemap(device: GPUDevice, cube: ResolvedFogCubemap) {
  const { size } = cube
  const levels = cubemapMipCount(size)
  const texture = device.createTexture({
    label: 'Trillion3D fog cubemap',
    size: { width: size, height: size, depthOrArrayLayers: 6 },
    mipLevelCount: levels,
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const faceTexels = size * size
  const averages = faceAverages(cube)
  for (let face = 0; face < 6; face++) {
    device.queue.writeTexture(
      { texture, mipLevel: 0, origin: { x: 0, y: 0, z: face } },
      rgba16(cube.texels, face * faceTexels * 3, faceTexels),
      { bytesPerRow: size * 8, rowsPerImage: size },
      { width: size, height: size, depthOrArrayLayers: 1 },
    )
    device.queue.writeTexture(
      { texture, mipLevel: levels - 1, origin: { x: 0, y: 0, z: face } },
      rgba16(averages, face * 3, 1),
      { bytesPerRow: 8, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    )
  }
  return {
    texture,
    view: texture.createView({ dimension: 'cube' }),
    bytes: cubemapBytes(size),
    destroy: () => texture.destroy(),
  }
}

/** Bytes of the cubemap of a face of `size` texels, its whole chain of levels (four half floats a texel). */
function cubemapBytes(size: number) {
  let texels = 0
  for (let level = 0; level < cubemapMipCount(size); level++)
    texels += Math.max(1, size >> level) ** 2
  return texels * 6 * 8
}

/** The stand-in a program that reads a cubemap is bound to when the fog has none: one white texel a
 *  face, so that the tint alone colours the fog. */
export function createWhiteCubemap(device: GPUDevice) {
  const texture = device.createTexture({
    label: 'Trillion3D fog no cubemap',
    size: { width: 1, height: 1, depthOrArrayLayers: 6 },
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    new Uint16Array(24).fill(HALF_ONE),
    { bytesPerRow: 8, rowsPerImage: 1 },
    { width: 1, height: 1, depthOrArrayLayers: 6 },
  )
  return {
    texture,
    view: texture.createView({ dimension: 'cube' }),
    destroy: () => texture.destroy(),
  }
}

/** What a view holds of the fog's cubemap: the picture's texels and the texture made for them. */
interface HeldFogCubemap {
  cube?: { texels: ArrayLike<number>; made: ReturnType<typeof createFogCubemap> }
}

/** The cubemap's texture for the picture the fog holds: made once for it and kept while the fog
 *  holds it, retired when it does not. None where the fog has no cubemap. */
export function fogCubemapView(
  device: GPUDevice,
  held: HeldFogCubemap,
  cube: ResolvedFogCubemap | undefined,
) {
  if (held.cube && held.cube.texels !== cube?.texels) {
    retire(device, held.cube.made)
    held.cube = undefined
  }
  if (cube && !held.cube) held.cube = { texels: cube.texels, made: createFogCubemap(device, cube) }
  return held.cube?.made.view
}

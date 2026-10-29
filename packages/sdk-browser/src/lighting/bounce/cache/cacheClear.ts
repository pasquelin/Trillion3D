import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { texelBytesOf } from '../../../gpu/core/textureBytes.ts'
import type { CacheStorage } from './cacheStorage.ts'

/** Bytes a row of a copy is a multiple of. */
const ROW_ALIGN = 256

/** The bytes a row of `width` texels of `format` takes in a copy. */
const copyRowBytes = (width: number, format: GPUTextureFormat) =>
  ceilDiv(width * texelBytesOf(format), ROW_ALIGN) * ROW_ALIGN

/** A buffer of zeros that holds the widest level of a texture of `format` and `size`, made for the clear and given back with it. */
function zeroBuffer(device: GPUDevice, size: readonly [number, number], format: GPUTextureFormat) {
  const buffer = device.createBuffer({
    label: 'Trillion3D radiance cache clear v1',
    size: copyRowBytes(size[0], format) * size[1],
    usage: GPUBufferUsage.COPY_SRC,
  })
  retire(device, buffer)
  return buffer
}

/** Sets every level of `texture` to black in `encoder`, by copies of zeros. */
function clearTexture(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture) {
  const { width, height, format, mipLevelCount } = texture
  const zeros = zeroBuffer(device, [width, height], format)
  for (let level = 0; level < mipLevelCount; level++) {
    const w = Math.max(1, width >> level),
      h = Math.max(1, height >> level)
    encoder.copyBufferToTexture(
      { buffer: zeros, bytesPerRow: copyRowBytes(w, format) },
      { texture, mipLevel: level },
      [w, h],
    )
  }
}

/**
 * The final maps of the radiance cache and the sky's share set to black (`screenProbeRadianceCacheForceFullUpdate`), before the update
 * that traces every probe anew: no probe's map is read from what an image before left.
 */
export function clearCacheMaps(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  storage: CacheStorage,
) {
  clearTexture(device, encoder, storage.final)
  if (storage.shape.skyVisibility) clearTexture(device, encoder, storage.sky)
}

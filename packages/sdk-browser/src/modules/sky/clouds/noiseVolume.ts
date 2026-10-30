import { noiseVolumeBytes, NOISE_VOLUME_SIZE } from './cloudTextureFiles.ts'

/**
 * THE NOISE VOLUME, read from the file shipped beside the module (`cloudTextureFiles.ts`): a 3D
 * texture of 128 texels a side that tiles on every axis, level 0 alone. The file holds the 8-bit
 * values sRGB-encoded, as the reference stores them, so the texture is `rgba8unorm-srgb` and a read
 * returns the linear values.
 */
export async function createNoiseVolume(device: GPUDevice) {
  const bytes = await noiseVolumeBytes()
  const texture = device.createTexture({
    label: 'Trillion3D cloud noise volume',
    dimension: '3d',
    size: [NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE],
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    bytes,
    { bytesPerRow: NOISE_VOLUME_SIZE * 4, rowsPerImage: NOISE_VOLUME_SIZE },
    [NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE],
  )
  return texture
}

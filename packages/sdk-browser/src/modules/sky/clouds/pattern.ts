import { patternBytes, PATTERN_SIZE } from './cloudTextureFiles.ts'
import { runGenerator } from './generation.ts'
import { cloudMipKernels, mipLevelsOf, mipPasses } from './mips.ts'

/**
 * THE LAYOUT PATTERN, read from the file shipped beside the module (`cloudTextureFiles.ts`): a 2D
 * `rgba16float` texture of 1024 texels a side that tiles, its level 0 the file's half floats, with
 * the mip chain its import setting names, the first blur (`mipsWgsl.ts`).
 */
export async function createLayoutPattern(device: GPUDevice) {
  const label = 'Trillion3D cloud layout pattern'
  const [bytes, kernels] = await Promise.all([patternBytes(), cloudMipKernels(device)])
  const texture = device.createTexture({
    label,
    size: [PATTERN_SIZE, PATTERN_SIZE],
    format: 'rgba16float',
    mipLevelCount: mipLevelsOf(PATTERN_SIZE),
    usage:
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture({ texture }, bytes, { bytesPerRow: PATTERN_SIZE * 8 }, [
    PATTERN_SIZE,
    PATTERN_SIZE,
  ])
  runGenerator(device, label, mipPasses(device, kernels, texture, 'blur1'))
  return texture
}

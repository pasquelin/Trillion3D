import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../../gpu/core/computeBindings.ts'
import { compileKernels, runGenerator } from './generation.ts'
import {
  LIGHTNING_CODE,
  LIGHTNING_ENTRY_POINTS,
  LIGHTNING_GROUP,
  LIGHTNING_LEVELS,
  LIGHTNING_SIZE,
} from './lightningWgsl.ts'

/**
 * THE LIGHTNING VOLUME, generated once on the GPU (`lightningWgsl.ts` says what it holds): a 3D
 * `rgba16float` texture of 64 texels a side with all its mip levels, the blobs written to level 0
 * and each level after it averaged from the one above. The format is a colour one because a
 * single-channel float is not a storage texture format everywhere.
 */
export async function createLightningVolume(device: GPUDevice) {
  const label = 'Trillion3D cloud lightning volume'
  const { layout, pipelines } = await compileKernels(
    device,
    label,
    LIGHTNING_CODE,
    [
      computeStorageTextureEntry(0, 'rgba16float', 'write-only', '3d'),
      computeTextureEntry(1, 'unfilterable-float', '3d'),
    ],
    LIGHTNING_ENTRY_POINTS,
  )
  const texture = device.createTexture({
    label,
    dimension: '3d',
    size: [LIGHTNING_SIZE, LIGHTNING_SIZE, LIGHTNING_SIZE],
    mipLevelCount: LIGHTNING_LEVELS,
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const level = (mip: number) =>
    texture.createView({ dimension: '3d', baseMipLevel: mip, mipLevelCount: 1 })
  const passes = Array.from({ length: LIGHTNING_LEVELS }, (_, mip) => {
    const size = LIGHTNING_SIZE >> mip
    const side = ceilDiv(size, LIGHTNING_GROUP)
    return {
      pipeline: mip === 0 ? pipelines.blobsMain : pipelines.downsampleMain,
      // The blobs read no level; level 1 stands in for the binding, written by no pass at that time.
      group: device.createBindGroup({
        label,
        layout,
        entries: sequentialEntries([level(mip), level(mip === 0 ? 1 : mip - 1)]),
      }),
      workgroups: [side, side, side] as const,
    }
  })
  runGenerator(device, label, passes, [])
  return texture
}

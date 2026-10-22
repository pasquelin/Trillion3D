import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import type { GeneratorPass } from './generation.ts'
import { MIP_CODE, MIP_ENTRY_POINTS, MIP_GROUP, type MipFilter } from './mipsWgsl.ts'

/**
 * THE MIP CHAIN OF A GENERATED 2D TEXTURE (`mipsWgsl.ts` says the two filters): the passes that
 * make each level from the one above it, after the level 0 is written. A texture made with
 * `mipLevelCount` levels and `STORAGE_BINDING | TEXTURE_BINDING` is given its chain by running them
 * after the pass that writes its level 0, in the same submission.
 */

const kernelsByDevice = new WeakMap<GPUDevice, ReturnType<typeof mipKernels>>()

/** The one layout of both filters (the finer level read, the level written) and their pipelines. */
async function mipKernels(device: GPUDevice) {
  const label = 'Trillion3D cloud mips'
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      computeTextureEntry(0, 'unfilterable-float'),
      computeStorageTextureEntry(1, 'rgba16float'),
    ],
  })
  const module = device.createShaderModule({ label, code: MIP_CODE })
  return { layout, pipelines: await buildComputeStages(device, [layout], module, MIP_ENTRY_POINTS) }
}

/** The mip kernels of `device`, compiled once. */
export function cloudMipKernels(device: GPUDevice) {
  let kernels = kernelsByDevice.get(device)
  if (!kernels) kernelsByDevice.set(device, (kernels = mipKernels(device)))
  return kernels
}

/** The levels of a square texture `side` texels a side, power of two, down to one texel. */
export const mipLevelsOf = (side: number) => 1 + Math.log2(side)

/** The passes that make levels 1 to the last of `texture` with `filter`, one pass a level, in
 *  order, over `kernels` (`cloudMipKernels`). */
export function mipPasses(
  device: GPUDevice,
  kernels: Awaited<ReturnType<typeof cloudMipKernels>>,
  texture: GPUTexture,
  filter: MipFilter,
): GeneratorPass[] {
  const pipeline = kernels.pipelines[filter === 'blur1' ? 'blurMain' : 'averageMain']
  const level = (mip: number) =>
    texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1 })
  return Array.from({ length: texture.mipLevelCount - 1 }, (_, from) => {
    const side = Math.max(1, texture.width >> (from + 1))
    const groups = ceilDiv(side, MIP_GROUP)
    return {
      pipeline,
      group: device.createBindGroup({
        label: 'Trillion3D cloud mips',
        layout: kernels.layout,
        entries: sequentialEntries([level(from), level(from + 1)]),
      }),
      workgroups: [groups, groups, 1] as const,
    }
  })
}

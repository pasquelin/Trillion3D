// The texture mips tests' bench: a four-texel working texture on a mock device, and its chains.
import { generateMaterialMips } from './mipBatch.ts'
import { mipLevelCountFor } from './tiles.ts'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts'

/** The reduction's entry point. */
export const REDUCE = 'reduceLevel'

/** One chain alone: a 4×4 texture under `format`, its rule and its cutoff. */
export const oneChain = (
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  weighted: boolean,
  cutoff?: number,
) => generateMaterialMips(device, [{ texture, format, width: 4, height: 4, weighted, cutoff }])

/** A four-texel-wide working texture, as tiles of a host texture cut them. */
export function scratch() {
  installGpuGlobals()
  const gpu = mockGpu()
  const texture = gpu.device.createTexture({
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    // Read in sRGB too, as a colour chain's levels are (`materialMipTexture`).
    format: 'rgba8unorm',
    viewFormats: ['rgba8unorm-srgb'],
    mipLevelCount: mipLevelCountFor(4, 4),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  }) as unknown as GPUTexture
  return { ...gpu, texture }
}

/** A working texture like `texture`, `side` texels wide, its whole chain. */
export const wider = (device: GPUDevice, texture: GPUTexture, side: number) =>
  device.createTexture({
    ...texture,
    size: [side, side],
    mipLevelCount: mipLevelCountFor(side, side),
  })

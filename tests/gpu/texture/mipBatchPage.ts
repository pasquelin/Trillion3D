// Material chains on Dawn reduced together in one batch — level by level across the chains — and
// each alone, twice (the second reduction on the groups the first made): every level read back.
import { generateMaterialMips } from '../../../packages/sdk-browser/src/texture/mipBatch.ts'
import { materialMipTexture } from '../../../packages/sdk-browser/src/texture/mips.ts'
import { mipLevelCountFor } from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readLevels } from './pageMipsPage.ts'
import type { ChainCase } from './pageMipsReference.ts'

export { chainCases } from './pageMipsPage.ts'

/** Each case's levels reduced in one batch with all the others, then alone, then alone again. */
export async function run(cases: ChainCase[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const make = (chain: ChainCase) => {
    const { width, height, format } = chain
    const texture = device.createTexture({
      size: [width, height],
      ...materialMipTexture(format),
      mipLevelCount: mipLevelCountFor(width, height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    })
    device.queue.writeTexture({ texture }, chain.texels, { bytesPerRow: width * 4 }, [
      width,
      height,
    ])
    return { texture, ...chain }
  }
  const batched = cases.map(make),
    alone = cases.map(make)
  generateMaterialMips(device, batched)
  const once: Uint8Array[][] = []
  for (const chain of alone) generateMaterialMips(device, [chain])
  for (const { texture } of alone) once.push(await readLevels(device, texture))
  for (const chain of alone) generateMaterialMips(device, [chain])
  const results = []
  for (let n = 0; n < cases.length; n++)
    results.push({
      batched: await readLevels(device, batched[n].texture),
      alone: once[n],
      again: await readLevels(device, alone[n].texture),
    })
  for (const { texture } of [...batched, ...alone]) texture.destroy()
  const { court: adapter } = await gpu.fermer()
  return { adapter, results, errors }
}

// The page-texture chain on Dawn: the engine's compute chain (`generateMaterialMips`) beside
// `develop`'s render chain (`pageMipsReference.ts`) on the same level 0, each level of the engine's
// copied into a texture of the pool format — as tiles are — and both read back, every view the
// engine makes of its working texture checked against WebGPU's view rule (`checkView`).
import { generateMaterialMips } from '../../../packages/sdk-browser/src/texture/mipBatch.ts'
import { materialMipTexture } from '../../../packages/sdk-browser/src/texture/mips.ts'
import { levelSize, mipLevelCountFor } from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { readGpuImage } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { checkView } from '../../kit/gpu/bindRules.ts'
import { encodeReferenceChain, type ChainCase } from './pageMipsReference.ts'

/** Colour chains plain, weighted and cut; data chains; even, odd, wide and tall sizes. Alphas mix
 *  the foliage's two ends with random ones, so the median, the weights and the cut all act. */
export function chainCases(): ChainCase[] {
  const next = random(1469)
  const texels = (width: number, height: number) =>
    Uint8Array.from({ length: width * height * 4 }, (_, i) => {
      if (i % 4 < 3) return Math.floor(next() * 256)
      const pick = next()
      return pick < 0.35 ? 0 : pick < 0.7 ? 255 : Math.floor(next() * 256)
    })
  // prettier-ignore
  const shapes: Array<[ChainCase['format'], number, number, boolean, number]> = [
    ['rgba8unorm-srgb', 37, 23, false, 0], ['rgba8unorm-srgb', 64, 64, true, 0],
    ['rgba8unorm-srgb', 45, 30, true, 128], ['rgba8unorm-srgb', 1, 9, true, 77],
    ['rgba8unorm-srgb', 129, 2, true, 200], ['rgba8unorm', 33, 17, false, 0],
    ['rgba8unorm', 256, 3, false, 0],
  ]
  return shapes.map(([format, width, height, weighted, cutoff]) => ({
    name: `${format} ${width}×${height}${weighted ? ' weighted' : ''}${cutoff ? ` cut ${cutoff}` : ''}`,
    format,
    width,
    height,
    weighted,
    cutoff,
    texels: texels(width, height),
  }))
}

/** Every level of `texture` read back as RGBA8 rows, packed, the top first. */
export async function readLevels(device: GPUDevice, texture: GPUTexture) {
  const levels: Uint8Array[] = []
  for (let mipLevel = 0; mipLevel < texture.mipLevelCount; mipLevel++) {
    const [w, h] = levelSize(texture.width, texture.height, mipLevel)
    levels.push(await readGpuImage(device, texture, w, h, undefined, { mipLevel, topDown: true }))
  }
  return levels
}

/** Each case's levels, the engine's (through the pool format) then the reference's. */
export async function run(cases: ChainCase[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const results: Array<{ engine: Uint8Array[]; reference: Uint8Array[] }> = []
  for (const chain of cases) {
    const { width, height, format } = chain
    const mipLevelCount = mipLevelCountFor(width, height)
    const usage =
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
    const make = (descriptor: Partial<GPUTextureDescriptor> & { usage: number }) => {
      const texture = device.createTexture({
        size: [width, height],
        format,
        mipLevelCount,
        ...descriptor,
      })
      device.queue.writeTexture({ texture }, chain.texels, { bytesPerRow: width * 4 }, [
        width,
        height,
      ])
      return texture
    }
    const engine = make({
      ...materialMipTexture(format),
      usage: usage | GPUTextureUsage.STORAGE_BINDING,
    })
    // Every view of it held to WebGPU's view rule, whatever Dawn build checks it: an sRGB read
    // whose usage kept storage binding loses the device in Chrome.
    const view = engine.createView.bind(engine)
    engine.createView = (descriptor) => (checkView(engine, descriptor), view(descriptor))
    const reference = make({ usage: usage | GPUTextureUsage.RENDER_ATTACHMENT })
    const pool = device.createTexture({ size: [width, height], format, mipLevelCount, usage })
    generateMaterialMips(device, [{ texture: engine, ...chain }])
    const encoder = device.createCommandEncoder()
    const held = encodeReferenceChain(device, encoder, reference, chain)
    // As a tile is copied: from the `rgba8unorm` level into the pool's format.
    for (let level = 0; level < mipLevelCount; level++)
      encoder.copyTextureToTexture(
        { texture: engine, mipLevel: level },
        { texture: pool, mipLevel: level },
        [...levelSize(width, height, level), 1],
      )
    device.queue.submit([encoder.finish()])
    results.push({
      engine: await readLevels(device, pool),
      reference: await readLevels(device, reference),
    })
    for (const object of [engine, reference, pool, ...held]) object.destroy()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, results, errors }
}

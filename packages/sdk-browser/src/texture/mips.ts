import { MATERIAL_MIP_WGSL } from './mipsWgsl.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts'
import { preparedComputeStage } from '../gpu/core/computeStages.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import type { PoolEncoding } from './blockFormats.ts'
import { prepareCoveragePipelines } from './coverageMips.ts'
import { computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import type { Texture } from '../../../sdk-core/src/texture/contract.ts'

/** What decides a reduction's pipeline: the level's pool format, sRGB or not, and the colour
 *  rule — plain, or weighted by alpha. */
type MipKey = { format: GPUTextureFormat; weighted: boolean }

/** The format a material chain's levels are stored in: an sRGB format has no storage binding, so a
 *  colour chain is `rgba8unorm` viewed as `rgba8unorm-srgb` for its reads and its copies. */
export const MATERIAL_MIP_FORMAT = 'rgba8unorm'

/** The format a material chain of pool format `format` is created in, and the views it needs. */
export function materialMipTexture(format: GPUTextureFormat) {
  if (format !== MATERIAL_MIP_FORMAT && format !== `${MATERIAL_MIP_FORMAT}-srgb`)
    throw new Error('TEXTURE_MIPS_FORMAT')
  return {
    format: MATERIAL_MIP_FORMAT,
    viewFormats: format === MATERIAL_MIP_FORMAT ? [] : [format],
  } as const
}

/** The view of `texture`'s mip `level`, in `format` when given. A view in another format than the
 *  texture's — a colour chain's sRGB reads — is sampled and nothing else: left to default, its usage
 *  would be the texture's, storage binding included, which WebGPU refuses on an sRGB format. */
export const levelView = (texture: GPUTexture, level: number, format?: GPUTextureFormat) =>
  texture.createView({
    baseMipLevel: level,
    mipLevelCount: 1,
    ...(format && format !== texture.format && { format, usage: GPUTextureUsage.TEXTURE_BINDING }),
  })

/**
 * Layouts and reduction programs, built ONCE per device; a pipeline once per key, compiled off the
 * thread before any texture reduces with it (`prepareMipPipelines`).
 *
 * The mip chain is generated at every working texture: recompiling the same program and the same
 * layout at each made one pay a pipeline compilation per texture, on the very path that must
 * serve its tiles as fast as possible. The cache is held per device, so a lost device takes its
 * pipelines with it; it is built on the device itself (`sharedGpuDevice`), never on a session's
 * handle: it serves every session, and names none.
 *
 * A material level is a compute dispatch, the whole chain one compute pass (`mipBatch.ts`).
 */
const materialProgram = oncePerDevice((device: GPUDevice) => {
  const visibility = GPUShaderStage.COMPUTE
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'float', '2d', visibility),
      computeBufferEntry(1, 'uniform', visibility),
      computeBufferEntry(2, 'read-only-storage', visibility),
      {
        binding: 3,
        visibility,
        storageTexture: { access: 'write-only', format: MATERIAL_MIP_FORMAT },
      },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module = device.createShaderModule({ code: MATERIAL_MIP_WGSL })
  const pipelines = preparedPipelines(
    ({ srgb, weighted }: { srgb: boolean; weighted: boolean }) =>
      preparedComputeStage(device, pipelineLayout, module, 'reduceLevel', {
        weighted: Number(weighted),
        srgb: Number(srgb),
      }),
    ({ srgb, weighted }) => `${Number(srgb)}/${Number(weighted)}`,
  )
  const turns = preparedPipelines(
    (flags: number) =>
      preparedComputeStage(device, pipelineLayout, module, 'turnLevel', {
        FLIP: flags & TEXEL_FLIP ? 1 : 0,
        PREMULTIPLY: flags & TEXEL_PREMULTIPLY ? 1 : 0,
      }),
    (flags) => `${flags}`,
  )
  return { layout, pipelines, turns }
})

/** The turns a host texture asks of raw texels, as bits (`turnFlags`). */
const TEXEL_FLIP = 1,
  TEXEL_PREMULTIPLY = 2
/** The turns host texture `map` asks of raw texels: none, the texels go up as they are. */
export const turnFlags = (map: Texture) =>
  (map.flipY ? TEXEL_FLIP : 0) | (map.premultiplyAlpha ? TEXEL_PREMULTIPLY : 0)

/** The pipeline storing level 0 of raw texels turned by `flags` (`turnLevel`), on the material
 *  layout, from `device`'s shared cache. */
export const levelTurnPipeline = (device: GPUDevice, flags: number) =>
  materialProgram(sharedGpuDevice(device)).turns.of(flags).get()

/** A material chain's pipeline on `device`'s shared cache — its pool format, checked when its
 *  working texture was made (`materialMipTexture`), says whether it encodes sRGB —, and its
 *  program's layout. */
const materialOf = (device: GPUDevice, format: GPUTextureFormat, weighted: boolean) => {
  const { layout, pipelines } = materialProgram(sharedGpuDevice(device)),
    srgb = format !== MATERIAL_MIP_FORMAT
  return { layout, pipeline: pipelines.of({ srgb, weighted }) }
}

/** Compiles off the thread, before any texture reduces with them, the pipelines of `keys` on
 *  `device`'s shared cache; resolves once all have. */
const prepareMipPipelines = (device: GPUDevice, keys: readonly MipKey[]) =>
  Promise.all(
    keys.map(({ format, weighted }) => materialOf(device, format, weighted).pipeline.prepare()),
  ).then(() => {})

/** The atlases a host texture's working texture reduces into (`../webgpu/tile/scratch.ts`). */
type HostKind = 'color' | 'data'

/** The reductions of a host texture's working texture in the atlases `kinds`: in the atlas's pool
 *  format, the lossless lane's — the only one a host image fills —, plain, or for a colour texture
 *  whose readers cut its coverage, weighted. */
const hostMipKeys = (encoding: PoolEncoding, kinds: readonly HostKind[]) =>
  kinds.flatMap((kind): MipKey[] => {
    const format = encoding.formatOf(kind, 'lossless')
    const plain: MipKey = { format, weighted: false }
    return kind === 'color' ? [plain, { ...plain, weighted: true }] : [plain]
  })

/** Compiles off the thread what a host texture's mips take in the atlases `kinds` — their
 *  reductions, the turns of raw texels, and for a colour one the coverage counts its readers'
 *  cutoff asks —, before any
 *  such texture reduces; resolves once all have, a refused one asked again where it is used. */
export const prepareHostReductions = (
  device: GPUDevice,
  encoding: PoolEncoding,
  kinds: readonly HostKind[],
) =>
  Promise.all([
    prepareMipPipelines(device, hostMipKeys(encoding, kinds)),
    kinds.includes('color') && prepareCoveragePipelines(device),
    // Level 0 of raw texels a host texture asks to flip, premultiply or both (`turnLevel`).
    ...[TEXEL_FLIP, TEXEL_PREMULTIPLY, TEXEL_FLIP | TEXEL_PREMULTIPLY].map((flags) =>
      materialProgram(sharedGpuDevice(device)).turns.of(flags).prepare(),
    ),
  ]).then(
    () => {},
    () => {},
  )

/** The bind group layout and the compiled pipeline of a material chain of pool format `format`
 *  and colour rule `weighted`. */
export function materialMipPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  weighted: boolean,
) {
  const { layout, pipeline } = materialOf(device, format, weighted)
  return { layout, pipeline: pipeline.get() }
}

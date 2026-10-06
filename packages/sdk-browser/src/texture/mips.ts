import { MIP_SHADER } from './mipsWgsl.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts'
import {
  preparedPipeline,
  preparedPipelines,
  type PreparedPipelines,
} from '../lighting/deferred/fullscreen.ts'
import type { PoolEncoding } from './blockFormats.ts'
import { prepareCoveragePipelines } from './coverageMips.ts'

/** How a level reduces: a material's colour, or a radiance. */
type MipRule = 'material' | 'radiance'

/** What decides a reduction's pipeline: the level's format, the colour rule — plain, or weighted by
 *  alpha —, and how the level reduces. */
export type MipKey = { format: GPUTextureFormat; weighted: boolean; rule: MipRule }

/**
 * Layout and reduction program, built ONCE per device; its pipeline once per format and per
 * colour rule, compiled off the thread before any texture reduces with it (`prepareMipPipelines`).
 *
 * The mip chain is generated at every working texture: recompiling the same program and the same
 * layout at each made one pay a pipeline compilation per texture, on the very path that must
 * serve its tiles as fast as possible. The cache is held per device, so a lost device takes its
 * pipelines with it; it is built on the device itself (`sharedGpuDevice`), never on a session's
 * handle: it serves every session, and names none.
 */
type MipProgram = {
  layout: GPUBindGroupLayout
  /** The pipeline of each key, one per `format/weighted/rule`. */
  pipelines: PreparedPipelines<MipKey, GPURenderPipeline>
}

const idOf = ({ format, weighted, rule }: MipKey) => `${format}/${Number(weighted)}/${rule}`

const mipProgram = oncePerDevice((device): MipProgram => {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module = device.createShaderModule({ code: MIP_SHADER })
  return {
    layout,
    pipelines: preparedPipelines(
      ({ format, weighted, rule }: MipKey) =>
        preparedPipeline(device, {
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vs' },
          fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format }],
            constants: { weighted: Number(weighted), radiance: Number(rule === 'radiance') },
          },
          primitive: { topology: 'triangle-list' },
        }),
      idOf,
    ),
  }
})

/** The program on `device`'s shared cache, and `key`'s pipeline in it. */
const pipelineOf = (device: GPUDevice, key: MipKey) => {
  const program = mipProgram(sharedGpuDevice(device))
  return { layout: program.layout, pipeline: program.pipelines.of(key) }
}

/** Compiles off the thread, before any texture reduces with them, the pipelines of `keys` on
 *  `device`'s shared cache; resolves once all have. */
export const prepareMipPipelines = (device: GPUDevice, keys: readonly MipKey[]) =>
  Promise.all(keys.map((key) => pipelineOf(device, key).pipeline.prepare())).then(() => {})

/** The reduction of a reflection's radiance levels (`../reflections/conePyramid.ts`): the format of
 *  the source it reduces, the lit image's. */
export const REFLECTION_MIP_KEYS: readonly MipKey[] = [
  { format: 'rgba16float', weighted: false, rule: 'radiance' },
]

/** The atlases a host texture's working texture reduces into (`../webgpu/tile/scratch.ts`). */
type HostKind = 'color' | 'data'

/** The reductions of a host texture's working texture in the atlases `kinds`: in the atlas's pool
 *  format, the lossless lane's — the only one a host image fills —, plain, or for a colour texture
 *  whose readers cut its coverage, weighted. */
const hostMipKeys = (encoding: PoolEncoding, kinds: readonly HostKind[]) =>
  kinds.flatMap((kind): MipKey[] => {
    const format = encoding.formatOf(kind, 'lossless')
    const plain: MipKey = { format, weighted: false, rule: 'material' }
    return kind === 'color' ? [plain, { ...plain, weighted: true }] : [plain]
  })

/** Compiles off the thread what a host texture's mips take in the atlases `kinds` — their
 *  reductions, and for a colour one the coverage counts its readers' cutoff asks —, before any
 *  such texture reduces; resolves once all have, a refused one asked again where it is used. */
export const prepareHostReductions = (
  device: GPUDevice,
  encoding: PoolEncoding,
  kinds: readonly HostKind[],
) =>
  Promise.all([
    prepareMipPipelines(device, hostMipKeys(encoding, kinds)),
    kinds.includes('color') && prepareCoveragePipelines(device),
  ]).then(
    () => {},
    () => {},
  )

/** The bind group layout and the pipeline of one format and one colour rule, compiled. */
export function mipPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  weighted: boolean,
  rule: MipRule = 'material',
) {
  const { layout, pipeline } = pipelineOf(device, { format, weighted, rule })
  return { layout, pipeline: pipeline.get() }
}

/**
 * The buffers of the reductions — their uniforms, a coverage chain's bins —, kept per device and
 * label and grown as needed. Creating then destroying one at every texture forced waiting for the
 * end of the device's work before releasing it — a full round trip of the GPU queue per texture;
 * one that lives as long as the device rewrites itself in queue order, waiting for nothing. An
 * outgrown one is not destroyed: already-submitted passes may still read it, the collector frees it.
 */
const heldBuffers = new WeakMap<GPUDevice, Map<string, GPUBuffer>>()

export function heldBuffer(device: GPUDevice, label: string, size: number, usage: number) {
  const kept = heldBuffers.get(device) ?? new Map<string, GPUBuffer>()
  heldBuffers.set(device, kept)
  const held = kept.get(label)
  if (held && held.size >= size) return held
  const buffer = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST })
  kept.set(label, buffer)
  return buffer
}

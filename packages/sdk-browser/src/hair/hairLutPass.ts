import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { HAIR_LUT_FORMAT, HAIR_LUT_GROUP, HAIR_LUT_WGSL } from './hairLutWgsl.ts'
import { hairLutAbsorptions } from './hairLutSize.ts'

/** The settings of the table (`hairLut*`). */
export interface HairLutSettings {
  readonly angles: number
  readonly roughnesses: number
  /** Slices along the absorption, taken down to the square below it. */
  readonly absorptions: number
  readonly sampleScale: number
}

const kernel = autoKernel(`${HAIR_STRANDS_PASS_PREFIX}scattering table`, HAIR_LUT_WGSL, 'hairLut')

/** A table the device holds: its texture, its view and the settings it was made for. */
export interface HairLut {
  readonly view: GPUTextureView
  readonly key: string
  readonly bytes: number
  dispose(): void
}

/** The table's key for `settings`: another key, another table. */
export const hairLutKey = (s: HairLutSettings) =>
  `${s.angles} ${s.roughnesses} ${hairLutAbsorptions(s.absorptions)} ${s.sampleScale}`

/**
 * Makes the table of the fibre's average scattering for `settings` and encodes its integration on `encoder`: a
 * 3D texture whose texel holds the front and back scattering of a fibre seen at an angle, a roughness and an
 * absorption. None while its program compiles. The caller keeps the table while its key (`hairLutKey`) stands
 * and gives it back (`dispose`) when it changes: made once, it is read by every light of every image.
 */
export function createHairLut(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  settings: HairLutSettings,
): HairLut | undefined {
  const pipeline = kernel(device).get()
  if (!pipeline) return undefined
  const size: [number, number, number] = [
    settings.angles,
    settings.roughnesses,
    hairLutAbsorptions(settings.absorptions),
  ]
  const texture = device.createTexture({
    label: `${HAIR_STRANDS_PASS_PREFIX}scattering table`,
    dimension: '3d',
    size,
    format: HAIR_LUT_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const params = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    params,
    0,
    new Uint32Array([...size, Math.max(1, Math.round(settings.sampleScale))]),
  )
  const view = texture.createView()
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: sequentialEntries([{ buffer: params }, view]),
  })
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}scattering table` })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(
    ceilDiv(size[0], HAIR_LUT_GROUP),
    ceilDiv(size[1], HAIR_LUT_GROUP),
    ceilDiv(size[2], HAIR_LUT_GROUP),
  )
  pass.end()
  return {
    view,
    key: `scattering ${hairLutKey(settings)}`,
    bytes: size[0] * size[1] * size[2] * 8,
    dispose: () =>
      retire(device, {
        destroy() {
          texture.destroy()
          params.destroy()
        },
      }),
  }
}

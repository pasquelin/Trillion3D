import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import type { HairNodes } from './compactionPass.ts'
import type { HairVoxelSettings } from './inputs.ts'
import { boundGroups } from './ribbonBinds.ts'
import { voxelSetResources, type HairVoxelSet } from './voxelPass.ts'
import { voxelTransmittanceWgsl } from './voxelTransmittanceWgsl.ts'

const kernels = preparedPipelines(
  ({ mipmap, supersampled }: { mipmap: boolean; supersampled: boolean }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}voxel transmittance${mipmap ? ' mip' : ''}${supersampled ? ' supersampled' : ''}`,
      voxelTransmittanceWgsl(mipmap, supersampled),
      'hairVoxelTransmittance',
    ),
  ({ mipmap, supersampled }) => `${mipmap} ${supersampled}`,
)

/** The pipeline of the voxel transmittance for the settings, none while it compiles. */
export const voxelTransmittancePipeline = (device: GPUDevice, settings: HairVoxelSettings) =>
  kernels.of({ mipmap: settings.mipTraversal, supersampled: settings.superSampling })(device).get()

/** What a light's transmittance pass reads and writes, kept by the caller across images: the mask it
 *  writes (a word a compacted sample), the light's block (`TransmittanceLight`), the view block
 *  (`HAIR_VIEW_WGSL`) and the blue noise (`noiseViewOn`). */
export interface VoxelTransmittanceTarget {
  readonly mask: GPUBuffer
  /** The window of `mask` the light writes, in bytes (the lights' masks lie one after the other). */
  readonly maskOffset: number
  readonly maskSize: number
  readonly light: GPUBuffer
  readonly viewBuffer: GPUBuffer
  readonly noise: GPUTextureView
}

/** The bind group of a light's transmittance, kept while the resources it names stay. */
export const voxelTransmittanceBinds = () =>
  boundGroups<HairVoxelSet, HairNodes, VoxelTransmittanceTarget>(
    2,
    (device, pipeline, set, nodes, target) => {
      const resources = voxelSetResources(set, nodes)
      resources.push(
        { buffer: target.mask, offset: target.maskOffset, size: target.maskSize },
        { buffer: target.viewBuffer },
        { buffer: target.light },
        target.noise,
      )
      return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: sequentialEntries(resources),
      })
    },
  )

/** A light for the transmittance: where it is (`position` with `directional` false) or the way it shines
 *  (`directional`), in the camera's translated world, the channel of its shadow mask and its lighting
 *  channels. */
export interface TransmittanceLight {
  readonly vector: readonly [number, number, number]
  readonly directional: boolean
  readonly lightChannels: number
}

/** Writes the light's block `words` (`TransmittanceLight`): the light, the jitter mode and the frame, and
 *  the densities, bias and stepping the settings give a transmittance. */
export function writeTransmittanceLight(
  words: { readonly u: Uint32Array; readonly f: Float32Array },
  settings: HairVoxelSettings,
  light: TransmittanceLight,
  frameIndex: number,
) {
  const { u, f } = words
  f[0] = light.vector[0]
  f[1] = light.vector[1]
  f[2] = light.vector[2]
  f[3] = light.directional ? 0 : 1
  u[4] = light.lightChannels
  u[5] = settings.jitterMode
  u[6] = frameIndex & 7
  u[7] = 0
  f[8] = settings.densityScaleTransmittance
  f[9] = settings.depthBiasScaleTransmittance
  f[10] = settings.steppingScaleTransmittance
  f[11] = 0
}

/** Encodes the transmittance toward one light over the stored samples of `nodes` in `pass`. */
export function encodeVoxelTransmittance(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  binds: ReturnType<typeof voxelTransmittanceBinds>,
  set: HairVoxelSet,
  nodes: HairNodes,
  target: VoxelTransmittanceTarget,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, binds(device, pipeline, set, nodes, target))
  pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
}

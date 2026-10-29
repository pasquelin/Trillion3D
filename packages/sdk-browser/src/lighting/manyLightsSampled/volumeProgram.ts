/**
 * THE SAMPLED LIGHTING'S VOLUME, its programs and its pass (`volumeWgsl.ts`): the sampling of the voxels and the hash of the lights each tile drew. The sampling comes in the variants of what it binds: the
 * global distance field (its rays; without, nothing blocks a light) and the depth pyramid (the fog's voxels hidden behind the surfaces are skipped; without, none is). Its pipelines are asked at the first
 * image that wants them, off the frame; until they are compiled the pass is not recorded, and the readers keep their walk of the lights.
 */
import { askedComputeProgram } from '../../gpu/core/computeStages.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import {
  createProgramGroups,
  heldProgramGroup,
  keptProgramGroup,
} from '../../gpu/bind/programGroups.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { globalReadLayoutEntries, type GlobalFieldRead } from '../distanceField/view.ts'
import {
  cloudShadowBindEntries,
  cloudShadowLayoutEntries,
  type CloudShadowSet,
} from '../atmosphere/cloudShadowRead.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import type { SampledVolumeBinding } from './volume.ts'
import { ML_BINDING as B, ML_CLOUD_SHADOW } from './volumeBindings.ts'
import { volumeHashText, volumeSampleText, type VolumeVariant } from './volumeText.ts'
import { VOLUME_HASH_ENTRY, VOLUME_SAMPLE_ENTRY } from './volumeWgsl.ts'

const variantKey = ({ field, pyramid }: VolumeVariant) =>
  `${field ? 'field' : 'nofield'}|${pyramid ? 'pyramid' : 'nopyramid'}`

const sampleEntries = ({ field, pyramid }: VolumeVariant): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.lights, 'read-only-storage'),
  computeBufferEntry(B.tiles, 'read-only-storage'),
  lightFunctionLayoutEntry(B.lightFunction),
  ...cloudShadowLayoutEntries(ML_CLOUD_SHADOW, GPUShaderStage.COMPUTE),
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.samplesOut, 'r32uint', 'write-only', '3d'),
  computeBufferEntry(B.hashHistory, 'read-only-storage'),
  computeBufferEntry(B.ratios, 'read-only-storage'),
  ...(pyramid ? hizDepthEntries(B.hiz, GPUShaderStage.COMPUTE) : []),
  ...(field ? globalReadLayoutEntries(B.field) : []),
]
const hashEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.samplesIn, 'r32uint', 'read-only', '3d'),
  computeBufferEntry(B.hashOut, 'storage'),
]

/** The programs of a device's volumes, the variants made at their first ask. */
export function createVolumePrograms(device: GPUDevice, failed: (error: unknown) => void) {
  const samples = new Map<string, ReturnType<typeof askedComputeProgram>>()
  let hash: ReturnType<typeof askedComputeProgram> | undefined
  return {
    sample(variant: VolumeVariant) {
      const key = variantKey(variant)
      let made = samples.get(key)
      if (!made)
        samples.set(
          key,
          (made = askedComputeProgram(
            device,
            failed,
            `Trillion3D sampled volume sampling ${key}`,
            sampleEntries(variant),
            volumeSampleText(variant),
            VOLUME_SAMPLE_ENTRY,
          )),
        )
      return made
    },
    hash() {
      return (hash ??= askedComputeProgram(
        device,
        failed,
        'Trillion3D sampled volume hash',
        hashEntries(),
        volumeHashText(),
        VOLUME_HASH_ENTRY,
      ))
    },
  }
}
export type VolumePrograms = ReturnType<typeof createVolumePrograms>

/** What a volume's pass reads of the frame. */
export interface VolumePassInputs {
  lights: GPUBuffer
  tiles: GPUBuffer
  lightFunction: GPUTextureView
  /** The clouds' shade, or the stand-ins that answer none. */
  cloudShadow: CloudShadowSet
  /** The depth pyramid the fog's hidden voxels are found by, none: no voxel is skipped. */
  hiz?: HizDepth
  /** The distance field the lights are traced through, none: nothing blocks. */
  field?: GlobalFieldRead
}

/** The bind groups of a volume's passes, kept while what they name holds. */
export function createVolumeGroups() {
  return {
    sample: new Map<string, ReturnType<typeof createProgramGroups>>(),
    hash: createProgramGroups(),
  }
}
export type VolumeGroups = ReturnType<typeof createVolumeGroups>

/** Whether the pipelines of the pass the inputs ask for are compiled (and asks for them). */
export function volumePassReady(programs: VolumePrograms, inputs: VolumePassInputs) {
  return (
    programs.sample({ field: !!inputs.field, pyramid: !!inputs.hiz }).pipeline.ready &&
    programs.hash().pipeline.ready
  )
}

/** The voxels of the volume sampled and traced (the downsampled grid, one thread each). */
function encodeVolumeSamples(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  inputs: VolumePassInputs,
  volume: SampledVolumeBinding,
) {
  const variant = { field: !!inputs.field, pyramid: !!inputs.hiz }
  const key = variantKey(variant)
  const sample = programs.sample(variant)
  let sampleGroups = groups.sample.get(key)
  if (!sampleGroups) groups.sample.set(key, (sampleGroups = createProgramGroups()))
  const { next } = sampleGroups.identity
  next[0] = inputs.lights
  next[1] = inputs.tiles
  next[2] = inputs.lightFunction
  next[3] = volume.params
  next[4] = volume.samplesWrite
  next[5] = volume.hashHistory
  next[6] = volume.ratios
  next[7] = inputs.hiz
  next[8] = inputs.field?.readGeneration
  next[9] = inputs.cloudShadow.block
  next[10] = inputs.cloudShadow.maps[0]
  next[11] = inputs.cloudShadow.maps[1]
  next[12] = inputs.cloudShadow.sampler
  pass.setPipeline(sample.pipeline.get()!)
  pass.setBindGroup(
    0,
    heldProgramGroup(sampleGroups) ??
      keptProgramGroup(
        device,
        sample.layout,
        sampleGroups,
        [
          { binding: B.lights, resource: { buffer: inputs.lights } },
          { binding: B.tiles, resource: { buffer: inputs.tiles } },
          { binding: B.lightFunction, resource: inputs.lightFunction },
          { binding: B.params, resource: { buffer: volume.params } },
          { binding: B.samplesOut, resource: volume.samplesWrite },
          { binding: B.hashHistory, resource: { buffer: volume.hashHistory } },
          { binding: B.ratios, resource: { buffer: volume.ratios } },
          ...(inputs.hiz ? hizDepthBindEntries(B.hiz, inputs.hiz) : []),
          ...(inputs.field?.readEntries(B.field) ?? []),
          ...cloudShadowBindEntries(ML_CLOUD_SHADOW, inputs.cloudShadow),
        ],
        'Trillion3D sampled volume sampling',
      ),
  )
  const [dx, dy, dz] = volume.downSize
  pass.dispatchWorkgroups(ceilDiv(dx, 4), ceilDiv(dy, 4), ceilDiv(dz, 4))
}

/** The tiles' sets of the voxels' samples (one thread each). */
function encodeVolumeSets(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  volume: SampledVolumeBinding,
) {
  const hash = programs.hash()
  groups.hash.identity.next[0] = volume.params
  groups.hash.identity.next[1] = volume.samplesRead
  groups.hash.identity.next[2] = volume.hashCurrent
  pass.setPipeline(hash.pipeline.get()!)
  pass.setBindGroup(
    0,
    heldProgramGroup(groups.hash) ??
      keptProgramGroup(
        device,
        hash.layout,
        groups.hash,
        [
          { binding: B.params, resource: { buffer: volume.params } },
          { binding: B.samplesIn, resource: volume.samplesRead },
          { binding: B.hashOut, resource: { buffer: volume.hashCurrent } },
        ],
        'Trillion3D sampled volume hash',
      ),
  )
  const [tx, ty, tz] = volume.hashTiles
  pass.dispatchWorkgroups(ceilDiv(tx, 4), ceilDiv(ty, 4), ceilDiv(tz, 4))
}

/** The voxels of the volume sampled and traced, then the tiles' sets, into `pass`. */
export function encodeVolumePass(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  inputs: VolumePassInputs,
  volume: SampledVolumeBinding,
) {
  encodeVolumeSamples(device, pass, programs, groups, inputs, volume)
  encodeVolumeSets(device, pass, programs, groups, volume)
  volume.drawn = volume.image
}

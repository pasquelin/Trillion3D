/**
 * THE SAMPLED LIGHTING'S VOLUME, its programs and its pass (`volumeWgsl.ts`, `volumeTraceWgsl.ts`): the sampling of the voxels, the compaction of the samples whose ray is to be traced, their trace through the
 * global distance field (without one, nothing blocks a light and neither is made), and the hash of the lights each tile drew. The sampling comes in the variants of what it binds: the depth pyramid (the
 * fog's voxels hidden behind the surfaces are skipped; without, none is). Its pipelines are asked at the first image that wants them, off the frame; until they are compiled the pass is not recorded, and
 * the readers keep their walk of the lights.
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
import { dispatchCubes } from '../../gpu/dispatch/grid.ts'
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
import {
  volumeCompactArgsText,
  volumeCompactResetText,
  volumeCompactText,
  VOLUME_COMPACT_ARGS_ENTRY,
  VOLUME_COMPACT_ENTRY,
  VOLUME_COMPACT_RESET_ENTRY,
  VOLUME_TRACE_ENTRY,
} from './volumeTraceWgsl.ts'
import { volumeHashText, volumeSampleText, volumeTraceText } from './volumeText.ts'
import { VOLUME_HASH_ENTRY, VOLUME_SAMPLE_ENTRY } from './volumeWgsl.ts'

const sampleEntries = (pyramid: boolean): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.lights, 'read-only-storage'),
  computeBufferEntry(B.tiles, 'read-only-storage'),
  lightFunctionLayoutEntry(B.lightFunction),
  ...cloudShadowLayoutEntries(ML_CLOUD_SHADOW, GPUShaderStage.COMPUTE),
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.samplesOut, 'r32uint', 'write-only', '3d'),
  computeStorageTextureEntry(B.raysOut, 'r32uint', 'write-only', '3d'),
  computeBufferEntry(B.hashHistory, 'read-only-storage'),
  computeBufferEntry(B.ratios, 'read-only-storage'),
  ...(pyramid ? hizDepthEntries(B.hiz, GPUShaderStage.COMPUTE) : []),
]
const traceEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.lights, 'read-only-storage'),
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.samplesOut, 'r32uint', 'read-write', '3d'),
  computeBufferEntry(B.compactData, 'read-only-storage'),
  computeBufferEntry(B.compactCount, 'read-only-storage'),
  ...globalReadLayoutEntries(B.field),
]
const compactResetEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.compactCount, 'storage'),
]
const compactEntries = (): GPUBindGroupLayoutEntry[] => [
  computeStorageTextureEntry(B.raysIn, 'r32uint', 'read-only', '3d'),
  computeBufferEntry(B.compactData, 'storage'),
  computeBufferEntry(B.compactCount, 'storage'),
]
const compactArgsEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.compactCount, 'read-only-storage'),
  computeBufferEntry(B.compactArgs, 'storage'),
]
const hashEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.samplesIn, 'r32uint', 'read-only', '3d'),
  computeBufferEntry(B.hashOut, 'storage'),
]

/** The programs of a device's volumes, the variants made at their first ask. */
export function createVolumePrograms(device: GPUDevice, failed: (error: unknown) => void) {
  const samples = new Map<boolean, ReturnType<typeof askedComputeProgram>>()
  const asked = (label: string, entries: GPUBindGroupLayoutEntry[], text: string, entry: string) =>
    askedComputeProgram(device, failed, `Trillion3D sampled volume ${label}`, entries, text, entry)
  let hash: ReturnType<typeof askedComputeProgram> | undefined
  let trace: ReturnType<typeof askedComputeProgram> | undefined
  let compactReset: ReturnType<typeof askedComputeProgram> | undefined
  let compact: ReturnType<typeof askedComputeProgram> | undefined
  let compactArgs: ReturnType<typeof askedComputeProgram> | undefined
  return {
    sample(pyramid: boolean) {
      let made = samples.get(pyramid)
      if (!made)
        samples.set(
          pyramid,
          (made = asked(
            `sampling ${pyramid ? 'pyramid' : 'nopyramid'}`,
            sampleEntries(pyramid),
            volumeSampleText(pyramid),
            VOLUME_SAMPLE_ENTRY,
          )),
        )
      return made
    },
    trace() {
      return (trace ??= asked('trace', traceEntries(), volumeTraceText(), VOLUME_TRACE_ENTRY))
    },
    compactReset() {
      return (compactReset ??= asked(
        'compaction reset',
        compactResetEntries(),
        volumeCompactResetText(),
        VOLUME_COMPACT_RESET_ENTRY,
      ))
    },
    compact() {
      return (compact ??= asked(
        'compaction',
        compactEntries(),
        volumeCompactText(),
        VOLUME_COMPACT_ENTRY,
      ))
    },
    compactArgs() {
      return (compactArgs ??= asked(
        'compaction arguments',
        compactArgsEntries(),
        volumeCompactArgsText(),
        VOLUME_COMPACT_ARGS_ENTRY,
      ))
    },
    hash() {
      return (hash ??= asked('hash', hashEntries(), volumeHashText(), VOLUME_HASH_ENTRY))
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
    sample: new Map<boolean, ReturnType<typeof createProgramGroups>>(),
    hash: createProgramGroups(),
    trace: createProgramGroups(),
    compactReset: createProgramGroups(),
    compact: createProgramGroups(),
    compactArgs: createProgramGroups(),
  }
}
export type VolumeGroups = ReturnType<typeof createVolumeGroups>

/** Whether the pipelines of the pass the inputs ask for are compiled (and asks for them). */
export function volumePassReady(programs: VolumePrograms, inputs: VolumePassInputs) {
  return (
    programs.sample(!!inputs.hiz).pipeline.ready &&
    programs.hash().pipeline.ready &&
    (!inputs.field ||
      (programs.trace().pipeline.ready &&
        programs.compactReset().pipeline.ready &&
        programs.compact().pipeline.ready &&
        programs.compactArgs().pipeline.ready))
  )
}

/** The voxels of the volume sampled (the downsampled grid, one thread each). */
function encodeVolumeSamples(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  inputs: VolumePassInputs,
  volume: SampledVolumeBinding,
) {
  const key = !!inputs.hiz
  const sample = programs.sample(key)
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
  next[8] = volume.rays
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
          { binding: B.raysOut, resource: volume.rays },
          { binding: B.hashHistory, resource: { buffer: volume.hashHistory } },
          { binding: B.ratios, resource: { buffer: volume.ratios } },
          ...(inputs.hiz ? hizDepthBindEntries(B.hiz, inputs.hiz) : []),
          ...cloudShadowBindEntries(ML_CLOUD_SHADOW, inputs.cloudShadow),
        ],
        'Trillion3D sampled volume sampling',
      ),
  )
  const [dx, dy, dz] = volume.downSize
  dispatchCubes(pass, dx, dy, dz)
}

/** The bind group of a pass whose bindings change with the identity of `identity`, kept while they do not. */
function passGroup(
  device: GPUDevice,
  program: ReturnType<typeof askedComputeProgram>,
  groups: ReturnType<typeof createProgramGroups>,
  identity: readonly unknown[],
  entries: GPUBindGroupEntry[],
  label: string,
) {
  identity.forEach((resource, i) => (groups.identity.next[i] = resource))
  return (
    heldProgramGroup(groups) ?? keptProgramGroup(device, program.layout, groups, entries, label)
  )
}

/** The samples marked to be traced listed, then traced through the distance field: the list's length cleared, the marks compacted, the dispatch built from the length, the dispatch over the list. */
function encodeVolumeTraces(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  inputs: VolumePassInputs & { field: GlobalFieldRead },
  volume: SampledVolumeBinding,
) {
  const count = { binding: B.compactCount, resource: { buffer: volume.compactCount } }
  const reset = programs.compactReset()
  pass.setPipeline(reset.pipeline.get()!)
  pass.setBindGroup(
    0,
    passGroup(
      device,
      reset,
      groups.compactReset,
      [volume.compactCount],
      [count],
      'Trillion3D sampled volume compaction reset',
    ),
  )
  pass.dispatchWorkgroups(1)
  const compact = programs.compact()
  pass.setPipeline(compact.pipeline.get()!)
  pass.setBindGroup(
    0,
    passGroup(
      device,
      compact,
      groups.compact,
      [volume.rays, volume.compactData, volume.compactCount],
      [
        { binding: B.raysIn, resource: volume.rays },
        { binding: B.compactData, resource: { buffer: volume.compactData } },
        count,
      ],
      'Trillion3D sampled volume compaction',
    ),
  )
  const [sx, sy, sz] = volume.sampleSize
  dispatchCubes(pass, sx, sy, sz)
  const args = programs.compactArgs()
  pass.setPipeline(args.pipeline.get()!)
  pass.setBindGroup(
    0,
    passGroup(
      device,
      args,
      groups.compactArgs,
      [volume.compactCount, volume.compactArgs],
      [count, { binding: B.compactArgs, resource: { buffer: volume.compactArgs } }],
      'Trillion3D sampled volume compaction arguments',
    ),
  )
  pass.dispatchWorkgroups(1)
  const trace = programs.trace()
  pass.setPipeline(trace.pipeline.get()!)
  pass.setBindGroup(
    0,
    passGroup(
      device,
      trace,
      groups.trace,
      [
        inputs.lights,
        volume.params,
        volume.samplesWrite,
        volume.compactData,
        volume.compactCount,
        inputs.field.readGeneration,
      ],
      [
        { binding: B.lights, resource: { buffer: inputs.lights } },
        { binding: B.params, resource: { buffer: volume.params } },
        { binding: B.samplesOut, resource: volume.samplesWrite },
        { binding: B.compactData, resource: { buffer: volume.compactData } },
        count,
        ...inputs.field.readEntries(B.field),
      ],
      'Trillion3D sampled volume trace',
    ),
  )
  pass.dispatchWorkgroupsIndirect(volume.compactArgs, 0)
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
  dispatchCubes(pass, tx, ty, tz)
}

/** The voxels of the volume sampled, their rays traced, then the tiles' sets, into `pass`. */
export function encodeVolumePass(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  programs: VolumePrograms,
  groups: VolumeGroups,
  inputs: VolumePassInputs,
  volume: SampledVolumeBinding,
) {
  encodeVolumeSamples(device, pass, programs, groups, inputs, volume)
  if (inputs.field)
    encodeVolumeTraces(device, pass, programs, groups, { ...inputs, field: inputs.field }, volume)
  encodeVolumeSets(device, pass, programs, groups, volume)
  volume.drawn = volume.image
}

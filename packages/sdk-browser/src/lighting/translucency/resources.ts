import {
  cloudShadowLayoutEntries,
  type CloudShadowBindings,
} from '../atmosphere/cloudShadowRead.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { allocatedTextures, createHeldTextures, listedBytes } from '../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../gpu/core/resourceAllocator.ts'
import { clearVolumeView } from '../../gpu/core/standIns.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { createProgramGroups } from '../../gpu/bind/programGroups.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import { FILTER_BINDING, FILTER_PROGRAM } from './filterWgsl.ts'
import { INJECT_BINDING, INJECT_PROGRAM } from './injectWgsl.ts'
import { TRANSLUCENCY_FRAME_BYTES, VOLUME_FORMAT, volumeExtent } from './layout.ts'

/** Where the injection binds the clouds' shade (`INJECT_BINDING`). */
export const INJECT_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: INJECT_BINDING.cloudShadow,
  map0: INJECT_BINDING.cloudShadowMap0,
  map1: INJECT_BINDING.cloudShadowMap1,
  sampler: INJECT_BINDING.cloudShadowSampler,
}

const READ = 'read-only-storage' as const

/** The injection's layout: what `INJECT_BINDING` names, each as its program declares it. */
const injectEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(INJECT_BINDING.lights, READ),
  computeUniformEntry(INJECT_BINDING.frame),
  computeBufferEntry(INJECT_BINDING.ranks, READ),
  computeStorageTextureEntry(INJECT_BINDING.injected, VOLUME_FORMAT, 'write-only', '3d'),
  computeBufferEntry(INJECT_BINDING.pageTable, READ),
  computeBufferEntry(INJECT_BINDING.projectionData, READ),
  computeUniformEntry(INJECT_BINDING.shadowUniforms),
  computeBufferEntry(INJECT_BINDING.pool, READ),
  computeUniformEntry(INJECT_BINDING.shadowView),
  lightFunctionLayoutEntry(INJECT_BINDING.lightFunction),
  ...cloudShadowLayoutEntries(INJECT_CLOUD_SHADOW, GPUShaderStage.COMPUTE),
]

/** The filters' layout: what `FILTER_BINDING` names. */
const filterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FILTER_BINDING.frame),
  computeTextureEntry(FILTER_BINDING.injected, 'float', '3d'),
  computeTextureEntry(FILTER_BINDING.volume, 'float', '3d'),
  computeStorageTextureEntry(FILTER_BINDING.written, VOLUME_FORMAT, 'write-only', '3d'),
]

/** A program of the volume: its layout and its module, which one or more entry points make pipelines of. */
const programOf = (
  device: GPUDevice,
  label: string,
  entries: GPUBindGroupLayoutEntry[],
  code: string,
) => ({
  label,
  layout: device.createBindGroupLayout({ entries }),
  module: device.createShaderModule({ label, code }),
})

/** The pipeline of `entryPoint` of `program`, asked now, off the frame (`failed` hears a refusal), with the layout it was made for. */
function pipelineOf(
  device: GPUDevice,
  failed: (error: unknown) => void,
  { label, layout, module }: ReturnType<typeof programOf>,
  entryPoint: string,
) {
  const pipeline = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    entryPoint,
    undefined,
    `${label} ${entryPoint}`,
  ).ask()
  pipeline.prepare().catch(failed)
  return { layout, pipeline }
}

/** Whether the blur writes a volume of its own: it does, unless the temporal filter's volume — the history too — is the one
 *  read, the blur off. */
export const madeByBlur = (temporal: boolean, blur: boolean) => !temporal || blur

/** The textures of a volume of `dim` cells a side, asked of `allocator`, all of the one layout (`volumeExtent`): the one the injection
 *  writes, the volumes the temporal filter writes — two, taking turns, the one before being the history — and the
 *  volume the blur writes (`madeByBlur`), which the surfaces sample. */
function volumeTextures(
  allocator: ResourceAllocator,
  dim: number,
  temporal: boolean,
  blur: boolean,
) {
  const size = volumeExtent(dim)
  const volume = (label: string) =>
    allocator.texture(label, size, VOLUME_FORMAT, { dimension: '3d' })
  return {
    dim,
    injected: volume('injected'),
    history: temporal ? [volume('temporal 0'), volume('temporal 1')] : [],
    blurred: madeByBlur(temporal, blur) ? volume('blurred') : undefined,
  }
}

/** The bind groups of the three passes, kept while what they name holds: two identities each, the images taking turns
 *  (the temporal filter's volumes' ping and pong). */
export function createTranslucencyGroups() {
  return {
    inject: createProgramGroups(),
    temporal: createProgramGroups(),
    blur: createProgramGroups(),
  }
}
/** The groups of the volume's passes. */
export type TranslucencyGroups = ReturnType<typeof createTranslucencyGroups>

/**
 * WHAT THE VOLUME'S PASSES ARE MADE OF, made once (`createTranslucencyVolumeGpu`): the frame's uniform, the programs asked at once off the
 * frame (the frames wait for them), the list of ranks the lights of the cascades are named in, the textures of the cells' count
 * the settings ask — made again, the old ones retired, when it changes, the device's budget to refuse them —, and the stand-in
 * volume a filter reads where it has none to read.
 */
export function createTranslucencyResources(device: GPUDevice, failed: (error: unknown) => void) {
  const frame = uniformBlock(
    device,
    'Trillion3D translucency volume frame',
    TRANSLUCENCY_FRAME_BYTES,
  )
  const { inject, temporal, blur } = volumePipelines(device, failed)
  const held = createHeldTextures<ReturnType<typeof volumeTextures>>(device)
  let ranks: GPUBuffer | undefined
  return {
    frame,
    inject,
    temporal,
    blur,
    get generation() {
      return held.generation
    },
    get bytes() {
      return held.bytes
    },
    /** The texture a filter reads as a volume where it has none: one cell. */
    get volumeStandIn() {
      return clearVolumeView(device)
    },
    /** The buffer of ranks, at least `words` long: grown (the old one retired) where it is not. */
    ranksOf(words: number) {
      return (ranks = sizedBuffer(
        device,
        ranks,
        Math.max(words, 64) * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'Trillion3D translucency volume lights',
      ))
    },
    release: held.release,
    /** The textures of `dim` cells a side, with the temporal filter's where `temporal` and the blur's where it makes the volume
     *  (`madeByBlur`): the held ones where they are those, else new ones — none where the device's budget refuses them. */
    texturesOf(dim: number, temporal: boolean, blur: boolean) {
      return held.texturesOf(
        (textures) =>
          textures.dim === dim &&
          (textures.history.length === 2) === temporal &&
          !!textures.blurred === madeByBlur(temporal, blur),
        () => textureRequest(device, dim, temporal, blur),
      )
    },
    dispose() {
      held.release()
      frame.buffer.destroy()
      if (ranks) retire(device, ranks)
    },
  }
}

/** The three passes' pipelines, asked at once off the frame. */
function volumePipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const inject = pipelineOf(
    device,
    failed,
    programOf(device, 'Trillion3D translucency volume inject', injectEntries(), INJECT_PROGRAM),
    'injectMain',
  )
  const filters = programOf(
    device,
    'Trillion3D translucency volume filter',
    filterEntries(),
    FILTER_PROGRAM,
  )
  return {
    inject,
    temporal: pipelineOf(device, failed, filters, 'temporalMain'),
    blur: pipelineOf(device, failed, filters, 'spatialMain'),
  }
}

/** What the held textures ask to make the volume's textures: their bytes, their name, and how. */
function textureRequest(device: GPUDevice, dim: number, temporal: boolean, blur: boolean) {
  const list = (allocator: ResourceAllocator) => volumeTextures(allocator, dim, temporal, blur)
  return {
    asked: listedBytes(list),
    what: 'the translucency lighting volume',
    make: () => allocatedTextures(device, 'Trillion3D translucency volume', list),
  }
}

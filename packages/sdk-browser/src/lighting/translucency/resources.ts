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
import { clearVolumeView, standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { createProgramGroups } from '../../gpu/bind/programGroups.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import { FILTER_BINDING, FILTER_PROGRAM } from './filterWgsl.ts'
import { INJECT_BINDING, INJECT_PROGRAM, injectProgram } from './injectWgsl.ts'
import { FOG_BINDING } from '../fog/bindings.ts'
import {
  ARGS_BINDING,
  ARGS_PROGRAM,
  CLEAR_BINDING,
  CLEAR_PROGRAM,
  DILATE_BINDING,
  DILATE_PROGRAM,
  GATHER_BINDING,
  GATHER_PROGRAM,
} from './markWgsl.ts'
import {
  MARK_FORMAT,
  TRANSLUCENCY_FRAME_BYTES,
  VOLUME_FORMAT,
  markExtent,
  markedCells,
  volumeExtent,
} from './layout.ts'

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
const injectEntries = (sampled = false): GPUBindGroupLayoutEntry[] => [
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
  computeBufferEntry(INJECT_BINDING.marked, READ),
  computeBufferEntry(INJECT_BINDING.markedCount, READ),
  // The sampled lighting's volume: its uniform and its samples.
  ...(sampled
    ? [
        computeUniformEntry(FOG_BINDING.mlParams),
        computeStorageTextureEntry(FOG_BINDING.mlSamplesIn, 'r32uint', 'read-only', '3d'),
      ]
    : []),
]

/** The filters' layout: what `FILTER_BINDING` names. */
const filterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FILTER_BINDING.frame),
  computeTextureEntry(FILTER_BINDING.injected, 'float', '3d'),
  computeTextureEntry(FILTER_BINDING.volume, 'float', '3d'),
  computeStorageTextureEntry(FILTER_BINDING.written, VOLUME_FORMAT, 'write-only', '3d'),
  computeTextureEntry(FILTER_BINDING.marks, 'uint', '3d'),
  computeTextureEntry(FILTER_BINDING.historyMarks, 'uint', '3d'),
]

/** The marks' passes' layouts (`markWgsl.ts`): what each program names. */
const WRITE = 'write-only' as const
const RW = 'storage' as const
const clearEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(CLEAR_BINDING.frame),
  computeStorageTextureEntry(CLEAR_BINDING.marks, MARK_FORMAT, WRITE, '3d'),
  computeStorageTextureEntry(CLEAR_BINDING.dilated, MARK_FORMAT, WRITE, '3d'),
  computeStorageTextureEntry(CLEAR_BINDING.injected, VOLUME_FORMAT, WRITE, '3d'),
  computeBufferEntry(CLEAR_BINDING.count, RW),
]
const dilateEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(DILATE_BINDING.frame),
  computeTextureEntry(DILATE_BINDING.marks, 'uint', '3d'),
  computeStorageTextureEntry(DILATE_BINDING.dilated, MARK_FORMAT, WRITE, '3d'),
]
const gatherEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(GATHER_BINDING.frame),
  computeTextureEntry(GATHER_BINDING.dilated, 'uint', '3d'),
  computeBufferEntry(GATHER_BINDING.count, RW),
  computeBufferEntry(GATHER_BINDING.list, RW),
]
const argsEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(ARGS_BINDING.count, READ),
  computeBufferEntry(ARGS_BINDING.args, RW),
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
  marking: boolean,
) {
  const size = volumeExtent(dim)
  const volume = (label: string) =>
    allocator.texture(label, size, VOLUME_FORMAT, { dimension: '3d' })
  return {
    dim,
    injected: volume('injected'),
    history: temporal ? [volume('temporal 0'), volume('temporal 1')] : [],
    blurred: madeByBlur(temporal, blur) ? volume('blurred') : undefined,
    marks: marking ? marksOf(allocator, dim) : undefined,
  }
}

/** The marks of a volume of `dim` cells a side (`translucencyVolumeMarkVoxels`): the cells the surfaces marked, the dilated marks — two, taking
 *  turns, the one before being the history — and the list of the dilated cells, how many it holds and the dispatch over it. */
function marksOf(allocator: ResourceAllocator, dim: number) {
  const size = markExtent(dim)
  const marks = (label: string) => allocator.texture(label, size, MARK_FORMAT, { dimension: '3d' })
  return {
    marked: marks('marked'),
    dilated: [marks('dilated 0'), marks('dilated 1')] as const,
    list: allocator.buffer('marked cells', markedCells(dim), 'storage'),
    count: allocator.buffer('marked count', 1, 'storage'),
    args: allocator.buffer('marked args', 3, 'args'),
  }
}

/** The bind groups of the passes (the marks' four after the three of the volume), kept while what they name holds: two identities each, the images taking turns
 *  (the temporal filter's volumes' ping and pong). */
export function createTranslucencyGroups() {
  return {
    inject: createProgramGroups(),
    injectSampled: createProgramGroups(),
    temporal: createProgramGroups(),
    blur: createProgramGroups(),
    clear: createProgramGroups(),
    dilate: createProgramGroups(),
    gather: createProgramGroups(),
    args: createProgramGroups(),
  }
}
/** The groups of the volume's passes. */
export type TranslucencyGroups = ReturnType<typeof createTranslucencyGroups>

/** What the passes bind where the cells are not marked: marks of one empty cell, and lists of no cells. */
function createMarkStandIns(device: GPUDevice) {
  const markStandIn = standInTexture(
    device,
    'Trillion3D translucency volume no marks',
    MARK_FORMAT,
    { dimension: '3d' },
  )
  const listStandIn = standInBuffer(
    device,
    'Trillion3D translucency volume no marked cells',
    16,
    GPUBufferUsage.STORAGE,
  )
  return { markStandIn, markView: markStandIn.createView({ dimension: '3d' }), listStandIn }
}

/** Whether the held textures are those the settings ask: the cells' count, the temporal filter's history, the blur's and the marks. */
function texturesMatch(
  textures: ReturnType<typeof volumeTextures>,
  dim: number,
  temporal: boolean,
  blur: boolean,
  marking: boolean,
) {
  return (
    textures.dim === dim &&
    (textures.history.length === 2) === temporal &&
    !!textures.blurred === madeByBlur(temporal, blur) &&
    !!textures.marks === marking
  )
}

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
  const { inject, temporal, blur, markedPipelines, sampledInject } = volumePipelines(device, failed)
  const held = createHeldTextures<ReturnType<typeof volumeTextures>>(device)
  const { markStandIn, markView, listStandIn } = createMarkStandIns(device)
  let ranks: GPUBuffer | undefined
  return {
    frame,
    inject,
    temporal,
    blur,
    /** The pipelines of the marked cells, asked at the first call (they compile off the frame). */
    markedPipelines,
    sampledInject,
    markStandIn: markView,
    listStandIn,
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
    texturesOf(dim: number, temporal: boolean, blur: boolean, marking: boolean) {
      return held.texturesOf(
        (textures) => texturesMatch(textures, dim, temporal, blur, marking),
        () => textureRequest(device, dim, temporal, blur, marking),
      )
    },
    dispose() {
      held.release()
      markStandIn.destroy()
      listStandIn.destroy()
      frame.buffer.destroy()
      if (ranks) retire(device, ranks)
    },
  }
}

/** `make` run at the first call, its result kept. */
function oncePerCall<T>(make: () => T) {
  let made: T | undefined
  return () => (made ??= make())
}

/** The three passes' pipelines, asked at once off the frame. */
function volumePipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const injection = programOf(
    device,
    'Trillion3D translucency volume inject',
    injectEntries(),
    INJECT_PROGRAM,
  )
  const filters = programOf(
    device,
    'Trillion3D translucency volume filter',
    filterEntries(),
    FILTER_PROGRAM,
  )
  return {
    inject: pipelineOf(device, failed, injection, 'injectMain'),
    temporal: pipelineOf(device, failed, filters, 'temporalMain'),
    blur: pipelineOf(device, failed, filters, 'spatialMain'),
    /** The pipelines of the marked cells (`translucencyVolumeMarkVoxels`), asked once the setting is on: the injection over the list and the
     *  marks' four passes. */
    /** The injection that lights its local lights from the samples the fog's volume drew (`injectProgram(true)`), asked at the first call: the plain one serves until it is `ready`. */
    sampledInject: oncePerCall(() => {
      const sampled = programOf(
        device,
        'Trillion3D translucency volume sampled inject',
        injectEntries(true),
        injectProgram(true),
      )
      return {
        inject: pipelineOf(device, failed, sampled, 'injectMain'),
        injectMarked: pipelineOf(device, failed, sampled, 'injectMarkedMain'),
      }
    }),
    markedPipelines: oncePerCall(() => ({
      injectMarked: pipelineOf(device, failed, injection, 'injectMarkedMain'),
      ...markPipelines(device, failed),
    })),
  }
}

/** The marks' four passes' pipelines (`markWgsl.ts`), asked once the setting is on. */
function markPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const pass = (label: string, entries: GPUBindGroupLayoutEntry[], code: string, entry: string) =>
    pipelineOf(
      device,
      failed,
      programOf(device, `Trillion3D translucency volume ${label}`, entries, code),
      entry,
    )
  return {
    clear: pass('mark clear', clearEntries(), CLEAR_PROGRAM, 'clearMain'),
    dilate: pass('mark dilate', dilateEntries(), DILATE_PROGRAM, 'dilateMain'),
    gather: pass('mark gather', gatherEntries(), GATHER_PROGRAM, 'gatherMain'),
    args: pass('mark args', argsEntries(), ARGS_PROGRAM, 'argsMain'),
  }
}

/** What the held textures ask to make the volume's textures: their bytes, their name, and how. */
function textureRequest(
  device: GPUDevice,
  dim: number,
  temporal: boolean,
  blur: boolean,
  marking: boolean,
) {
  const list = (allocator: ResourceAllocator) =>
    volumeTextures(allocator, dim, temporal, blur, marking)
  return {
    asked: listedBytes(list),
    what: 'the translucency lighting volume',
    make: () => allocatedTextures(device, 'Trillion3D translucency volume', list),
  }
}

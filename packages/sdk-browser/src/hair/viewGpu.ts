import { alignUp } from '../../../math/src/scalar/integers.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { storageBufferCap } from '../session/memory/pools.ts'
import { uniformBlock, type UniformBlock } from '../gpu/core/uniformBlock.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { createHairBounds, type HairBoundsGpu } from './boundsPass.ts'
import {
  allocateHairNodes,
  compactionBinds,
  hairNodes,
  type HairCompactionFrame,
  type HairNodes,
} from './compactionPass.ts'
import { gbufferBinds, gbufferDepthPass } from './gbufferPass.ts'
import { HAIR_IMAGE_WORDS } from './imageBlock.ts'
import type { HairFrameInputsWritable } from './inputs.ts'
import { materialBinds } from './materialPass.ts'
import { msaaResolveBinds } from './msaaPass.ts'
import type { HairLut } from './hairLutPass.ts'
import {
  createHairDeepShadowState,
  type HairDeepShadows,
  type HairDeepShadowState,
} from './deepShadowPass.ts'
import { createHairVoxelState, type HairVoxelState } from './voxelPass.ts'
import { rasterBinds, type HairBandBuffers, type HairRasterFrame } from './rasterPass.ts'
import { HAIR_LARGE_ARGS_WORDS, HAIR_LARGE_WORDS } from './rasterWgsl.ts'
import { bufferEntries } from '../gpu/core/computeBindings.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { HAIR_INSTANCE_WORDS, HAIR_VIEW_WORDS } from './ribbonWgsl.ts'
import type { HairInstance, HairScene, HairViewLists } from './scene.ts'
import type { HairEnvironment } from './environment.ts'
import type { HairSkyAo } from './skyAoPass.ts'
import type { HairSurfaceShadow } from './surfaceShadowPass.ts'
import type { HairLighting } from './lighting.ts'
import type { HairPrograms } from './visibility.ts'
import { allocateHairTiles, hairTiles, type HairTiles } from './tilesPass.ts'
import {
  allocateHairImageTargets,
  extendHairImageTargets,
  type HairImageTargets,
} from './transmittancePass.ts'
import {
  HAIR_BAND_WORDS,
  HAIR_NODE_DATA_BYTES,
  HAIR_SAMPLE_BYTES,
  hairBandBytes,
  hairBandCount,
  hairBandRows,
  HAIR_TILE_SIZE,
  hairTileGrid,
  writeHairBand,
  type HairSampleCount,
} from './visibilityMath.ts'

/** The room for compacted samples is made by whole multiples of this step, so that a view that grows
 *  a little does not make it anew every image. */
const NODE_STEP = 1 << 16

/**
 * THE STRANDS OF AN IMAGE, as the passes after the visibility read them (the shadow maps' marking and
 * projection, the lighting of the strands). It is what `encodeHairStrands` returns for an image that
 * has strands to show: an image whose strands cover no pixel, or that draws none, has none.
 */
export interface HairVisibilityView {
  /** The share of light the strands let through each pixel. */
  readonly transmittance: GPUTexture
  /** A pixel's descriptor of its compacted samples, and the share of the pixel the strands cover
   *  (the texture whose existence makes the view's strands valid): written in the tiles with strands
   *  alone, which every reader goes through. */
  readonly nodeIndex: GPUTexture
  readonly coverage: GPUTexture
  /** The depth of the nearest strand of a pixel, 0 for none. */
  readonly hairOnlyDepth: GPUTexture
  /** What the shadow maps' passes read of the strands (`HairShadowSource`). */
  readonly shadow: HairShadowSource
}

/** THE STRANDS AS THE SHADOW MAPS READ THEM, one record for the page marking and the projection, as the
 *  reference binds one block of the strands' view to both: the depth of the nearest strand of each pixel
 *  (0 for none) and the tiles with strands — the counts of the lists (also a uniform), the list of all
 *  of them, and the dispatch arguments over the lists (`HAIR_ALL_TILES_DISPATCH` that over it). */
export interface HairShadowSource {
  readonly hairDepth: GPUTextureView
  readonly counts: GPUBuffer
  readonly tiles: GPUBuffer
  readonly dispatchArgs: GPUBuffer
}

/** The record of an image's resources, kept while the sets it names stay (`ensureHairResources`): the
 *  sets, the strands the image shows, what the compaction of a band reads of them, and, refilled for
 *  each image, its samples a pixel and the most compacted samples it places. */
export interface HairViewRecord {
  readonly targets: HairImageTargets & HeldSet
  readonly buffers: HairImageBuffers & HeldSet
  readonly nodes: HairNodes & HeldSet
  readonly view: HairVisibilityView
  readonly compaction: HairCompactionFrame
  samples: HairSampleCount
  needed: number
}

/** A band of the samples: its buffer and window (`HAIR_BAND_WGSL`), and the bind groups made over them. */
interface HairBandGpu extends HairBandBuffers {
  readonly raster: ReturnType<typeof rasterBinds>
  readonly resolve: ReturnType<typeof msaaResolveBinds>
  readonly compact: ReturnType<typeof compactionBinds>
}

/** The sample bands, the lists of tiles and the room they were made for: the image they hold is any of
 *  at most that width and height, grown by whole images and never made smaller. */
interface HairImageBuffersExtra {
  readonly width: number
  readonly height: number
  readonly sampleCount: HairSampleCount
  /** Whether the hardware raster draws the samples (no list of large ribbons). */
  readonly hardware: boolean
  readonly rows: number
  readonly tiles: HairTiles
  readonly bands: readonly HairBandGpu[]
  readonly raster: HairRasterFrame
  /** The words of each band's window, written for each image. */
  readonly windowWords: Uint32Array<ArrayBuffer>
}
type HairSampleBuffers = ReturnType<typeof allocateSamples>
type HairImageBuffers = HairSampleBuffers & HairImageBuffersExtra

/** What an instance keeps on the GPU between images: its block, and the bind groups. */
interface HairInstanceGpu {
  readonly block: UniformBlock
  readonly drawn: DrawnInstance
}

/**
 * THE STRANDS OF A VIEW: everything the strands hold for the camera of one view, as the fog's volume
 * and the light shafts' histories are, so that a view drawn aside has its own and never another's
 * (`VIEW_GPU_KEYS`). Their bytes are the view's (`viewPassBytes`). The groups, instances and
 * tangents are the scene's, on the runtime.
 */
export interface HairViewGpu {
  /** The scene it was made for: another scene, and it is made again. */
  readonly scene: HairScene
  readonly bounds: HairBoundsGpu
  readonly lists: HairViewLists
  /** What the frame hook fills each image (`inputs.ts`), in place. */
  readonly inputs: HairFrameInputsWritable
  /** The view block of the passes over the ribbons, and the image block of the others. */
  readonly viewBlock: UniformBlock
  readonly imageBlock: UniformBlock
  readonly instances: Map<HairInstance, HairInstanceGpu>
  /** The usage the buffers and the textures a proof reads back carry (`COPY_SRC`), none in a frame. */
  readonly readback: {
    readonly buffers: GPUBufferUsageFlags
    readonly textures: GPUTextureUsageFlags
  }
  /** The bind groups of the passes after the visibility, over the view's blocks. */
  readonly materialBinds: ReturnType<typeof materialBinds>
  readonly gbufferBinds: ReturnType<typeof gbufferBinds>
  /** The pass that writes the depth of the surfaces under full coverage: its descriptor. */
  readonly depthPass: ReturnType<typeof gbufferDepthPass>
  /** The sets of resources the image holds, made when it asks for more than they hold. */
  targets?: HairImageTargets & HeldSet
  buffers?: HairImageBuffers & HeldSet
  nodes?: HairNodes & HeldSet
  /** The record of the resources, kept while the sets stay. */
  record?: HairViewRecord
  /** The programs of the image's passes, kept while what picks them stays. */
  programs?: HairPrograms
  /** What was told of each kind of refusal (the resources, the instances, the room), each told once. */
  readonly told: Map<string, string>
  /** What an image refills in place: the instances drawn and the instances they are, the pixels the
   *  strands cover and the tiles that hold them. */
  readonly drawn: DrawnInstance[]
  readonly members: HairInstance[]
  /** The rank of each member's macro group. */
  readonly macroGroups: number[]
  readonly rect: [number, number, number, number]
  readonly tileRect: [number, number, number, number]
  /** The voxel volume of the view, made when the strands are lit (`encodeHairVoxels`), and the instances
   *  it voxelizes this image, refilled in place. */
  readonly voxel: HairVoxelState
  readonly voxelDrawn: DrawnInstance[]
  /** The deep shadows of the view, and what the last image drew; every instance of each macro group, by the
   *  group's rank. */
  readonly deepShadow: HairDeepShadowState
  /** The table of the fibre's scattering (`ensureHairLut`, `frame.ts`), once the strands are lit. */
  lut?: HairLut
  /** The light of the strands (`encodeHairLighting`), made when they are first lit. */
  lighting?: HairLighting
  /** The environment light of the strands from the radiance cache (`armHairEnvironment`). */
  environment?: HairEnvironment
  /** The occlusion of the image with the strands' laid on it (`encodeHairSkyAo`). */
  skyAo?: HairSkyAo
  /** The shadow of the strands on the surfaces, a layer a light (`encodeHairSurfaceShadow`). */
  surfaceShadow?: HairSurfaceShadow
  deepShadows?: HairDeepShadows
  readonly groupInstances: DrawnInstance[][]
  /** The strands of the image last encoded, for the passes of the frame that read them: none until
   *  `encodeHairStrands` sets it, and none again when an image has none to show. */
  visible?: HairVisibilityView
  /** The bytes the view holds. */
  readonly bytes: number
  dispose(): void
}

/** The bytes the view holds: its blocks, its instances' and the sets it keeps. */
function hairViewBytes(state: HairViewGpu) {
  const { bounds, viewBlock, imageBlock, instances } = state
  let bytes = bounds.bytes + viewBlock.buffer.size + imageBlock.buffer.size
  for (const { block } of instances.values()) bytes += block.buffer.size
  for (const held of [
    state.targets,
    state.buffers,
    state.nodes,
    state.voxel.set,
    state.deepShadow.set,
  ])
    bytes += held?.bytes ?? 0
  bytes +=
    (state.lut?.bytes ?? 0) +
    (state.lighting?.bytes ?? 0) +
    (state.environment?.bytes ?? 0) +
    (state.skyAo?.bytes ?? 0) +
    (state.surfaceShadow?.bytes ?? 0)
  return bytes
}

/** Gives back all the view holds: its sets, and its blocks retired (the image being encoded may still name them). */
function disposeHairView(device: GPUDevice, state: HairViewGpu) {
  const { bounds, viewBlock, imageBlock, instances } = state
  state.targets?.dispose()
  state.buffers?.dispose()
  state.nodes?.dispose()
  state.voxel.dispose()
  state.deepShadow.dispose()
  state.lut?.dispose()
  state.lut = undefined
  state.lighting?.dispose()
  state.lighting = undefined
  state.environment?.dispose()
  state.environment = undefined
  state.skyAo?.dispose()
  state.skyAo = undefined
  state.surfaceShadow?.dispose()
  state.surfaceShadow = undefined
  const buffers = [
    viewBlock.buffer,
    imageBlock.buffer,
    ...[...instances.values()].map(({ block }) => block.buffer),
  ]
  retire(device, {
    destroy() {
      bounds.destroy()
      for (const buffer of buffers) buffer.destroy()
    },
  })
  instances.clear()
  state.targets = state.buffers = state.nodes = state.visible = state.record = undefined
  state.told.clear()
}

/** The strands of `scene` for a view on `device`, none of them drawn yet; `inputs` is the record the
 *  frame hook refills for each image. `readable`, the resources of the images can be read back (a
 *  proof's). */
export function createHairViewGpu(
  device: GPUDevice,
  scene: HairScene,
  inputs: HairFrameInputsWritable,
  readable = false,
): HairViewGpu {
  const bounds = createHairBounds(device, scene.instances.length, readable)
  const viewBlock = uniformBlock(device, `${HAIR_STRANDS_PASS_PREFIX}view`, HAIR_VIEW_WORDS * 4)
  const imageBlock = uniformBlock(device, `${HAIR_STRANDS_PASS_PREFIX}image`, HAIR_IMAGE_WORDS * 4)
  const instances = new Map<HairInstance, HairInstanceGpu>()
  const state: HairViewGpu = {
    scene,
    bounds,
    lists: { visible: [], shadowOnly: [] },
    inputs,
    viewBlock,
    imageBlock,
    instances,
    readback: {
      buffers: readable ? GPUBufferUsage.COPY_SRC : 0,
      textures: readable ? GPUTextureUsage.COPY_SRC : 0,
    },
    told: new Map(),
    materialBinds: materialBinds(viewBlock.buffer, imageBlock.buffer),
    gbufferBinds: gbufferBinds(imageBlock.buffer),
    depthPass: gbufferDepthPass(),
    voxel: createHairVoxelState(),
    voxelDrawn: [],
    deepShadow: createHairDeepShadowState(),
    groupInstances: [],
    drawn: [],
    members: [],
    macroGroups: [],
    rect: [0, 0, 0, 0],
    tileRect: [0, 0, 0, 0],
    get bytes() {
      return hairViewBytes(state)
    },
    dispose() {
      disposeHairView(device, state)
    },
  }
  return state
}

/** The GPU side of `instance`, made at its first image. */
export function instanceGpu(
  device: GPUDevice,
  state: HairViewGpu,
  instance: HairInstance,
): HairInstanceGpu {
  let held = state.instances.get(instance)
  if (!held) {
    const block = uniformBlock(
      device,
      `${HAIR_STRANDS_PASS_PREFIX}instance`,
      HAIR_INSTANCE_WORDS * 4,
    )
    const { group } = instance
    // Nine pipelines take turns with an instance's resources: the transmittance, the raster's two phases
    // each with its large ribbons, the material, the voxel raster and the deep shadow's two passes.
    const groups = boundGroups<GPUBuffer, GPUBuffer, GPUBuffer>(
      9,
      (made, pipeline, points, tangents, uniform) =>
        made.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: bufferEntries([points, tangents, uniform]),
        }),
    )
    held = {
      block,
      drawn: {
        pointCount: group.pointCount,
        group: (pipeline) => groups(device, pipeline, group.points, group.tangents, block.buffer),
      },
    }
    state.instances.set(instance, held)
  }
  return held
}

/** The room for compacted samples an image of `needed` takes: whole steps. */
const nodeRoom = (needed: number) => alignUp(needed, NODE_STEP)

/** The names the sets of a view are made under. */
const TARGETS_LABEL = `${HAIR_STRANDS_PASS_PREFIX}targets`
const SAMPLES_LABEL = `${HAIR_STRANDS_PASS_PREFIX}samples`
const NODES_LABEL = `${HAIR_STRANDS_PASS_PREFIX}nodes`

/** Tells `fail` of `why`, a refusal of the kind `kind`, unless it was the last told of that kind: a
 *  reason is told once, the frame after frame it holds. */
export function tellHairOnce(
  state: Pick<HairViewGpu, 'told'>,
  kind: string,
  why: string,
  fail: (error: unknown) => void,
) {
  if (state.told.get(kind) === why) return
  state.told.set(kind, why)
  fail(new Error(`hair strands visibility: ${why}`))
}

/** What an image asks of its resources. */
interface HairImageDemand {
  /** The size of the image, and the size the render targets were made at. */
  readonly size: readonly [number, number]
  readonly allocated: readonly [number, number]
  readonly samples: HairSampleCount
  readonly blendable: boolean
  /** Whether the device's rasterizer writes the samples, which asks for the multisampled targets. */
  readonly hardware: boolean
  /** The most compacted samples the image may place. */
  readonly needed: number
}

/** The sample bands, `rows` rows each but the last, and the lists of `tileCapacity` tiles; `readback`
 *  the usage a proof adds. */
function allocateSamples(
  allocator: Parameters<typeof allocateHairTiles>[0],
  width: number,
  height: number,
  samples: number,
  rows: number,
  tileCapacity: number,
  readback: GPUBufferUsageFlags,
  hardware: boolean,
) {
  const count = hairBandCount(height, rows)
  return {
    tileBuffers: allocateHairTiles(allocator, tileCapacity, readback),
    samples: Array.from({ length: count }, (_, k) =>
      allocator.buffer(
        `samples ${k}`,
        hairBandBytes(k, count, rows, width, height, samples) / 4,
        'storage',
        readback,
      ),
    ),
    windows: Array.from({ length: count }, (_, k) =>
      allocator.buffer(`window ${k}`, HAIR_BAND_WORDS, 'uniform'),
    ),
    // The ribbons too large for a thread, listed by the compute raster, and the dispatch over them:
    // the hardware raster needs neither.
    large: hardware ? undefined : allocator.buffer('large ribbons', HAIR_LARGE_WORDS, 'storage'),
    largeArgs: hardware
      ? undefined
      : allocator.buffer('large ribbons arguments', HAIR_LARGE_ARGS_WORDS, 'args'),
  }
}

/** Whether the sets `state` holds hold what `demand` asks: the targets made for the size of the
 *  render targets, the samples and tiles for an image at least as large, the room at least as large. */
const heldFits = (state: HairViewGpu, demand: HairImageDemand, room: number) => {
  const { targets, buffers, nodes } = state
  const [width, height] = demand.size
  return (
    !!targets &&
    targets.key[0] === demand.allocated[0] &&
    targets.key[1] === demand.allocated[1] &&
    targets.key[2] === demand.blendable &&
    targets.key[3] === demand.hardware &&
    !!buffers &&
    buffers.width >= width &&
    buffers.height >= height &&
    buffers.sampleCount === demand.samples &&
    buffers.hardware === demand.hardware &&
    !!nodes &&
    nodes.capacity >= room
  )
}

/**
 * The resources of `state` for an image of `demand`, made when it asks for more than they hold: the
 * targets at the size of the render targets (they are drawn into beside the opaque depth, and so
 * follow it), the sample bands and the lists of tiles for the pixels of the image, and the room for
 * the compacted samples, with the record of them (`HairViewRecord`, its numbers refilled for the
 * image). A set is never made smaller nor made again for a smaller image, so a render scale that moves
 * does not make them anew; an image the sets hold builds nothing. None where the device cannot hold
 * them: its storage binding is too small for a tile of rows of samples or for the compacted samples, or
 * its budget leaves no room (the reason is told once to `fail`).
 */
export function ensureHairResources(
  device: GPUDevice,
  state: HairViewGpu,
  demand: HairImageDemand,
  fail: (error: unknown) => void,
): HairViewRecord | undefined {
  const room = nodeRoom(demand.needed)
  if (
    !(state.record && heldFits(state, demand, room)) &&
    !makeHairResources(device, state, demand, room, fail)
  )
    return undefined
  const record = state.record!
  record.samples = demand.samples
  record.needed = demand.needed
  return record
}

/** The textures of the strands for `demand`, kept or made. */
function ensureTargets(
  state: HairViewGpu,
  device: GPUDevice,
  { allocated, blendable, hardware }: HairImageDemand,
) {
  const { readback } = state
  const targets = ensureSet(
    state.targets,
    device,
    {
      key: [allocated[0], allocated[1], blendable, hardware],
      what: 'the textures of the hair strands',
      label: TARGETS_LABEL,
    },
    (allocator) =>
      allocateHairImageTargets(
        allocator,
        allocated[0],
        allocated[1],
        blendable,
        readback.textures,
        hardware,
      ),
    extendHairImageTargets,
  )
  state.targets = targets.resources
  return targets
}

/** What the sample buffers carry beside them: the bands of each (their bind groups), the tiles and the raster's view. */
function hairBufferExtras(
  state: HairViewGpu,
  made: HairSampleBuffers,
  {
    width,
    height,
    samples,
    hardware,
    bandRows,
    tileCapacity,
  }: {
    width: number
    height: number
    samples: HairSampleCount
    hardware: boolean
    bandRows: number
    tileCapacity: number
  },
): HairImageBuffersExtra {
  const bands = made.samples.map((buffer, k): HairBandGpu => ({
    samples: buffer,
    window: made.windows[k]!,
    raster: rasterBinds(),
    resolve: msaaResolveBinds(),
    compact: compactionBinds(),
  }))
  return {
    width,
    height,
    sampleCount: samples,
    hardware,
    rows: bandRows,
    tiles: hairTiles(tileCapacity, made.tileBuffers),
    bands,
    raster: {
      viewBuffer: state.viewBlock.buffer,
      large: made.large,
      largeArgs: made.largeArgs,
      bands,
      count: 0,
    },
    windowWords: new Uint32Array(HAIR_BAND_WORDS * bands.length),
  }
}

/** The samples and the tiles of the strands for `demand` in bands of `bandRows`, kept or made. */
function ensureBuffers(
  state: HairViewGpu,
  device: GPUDevice,
  { size, samples, hardware }: HairImageDemand,
  bandRows: number,
) {
  const [width, height] = size
  const tileCapacity = hairTileGrid(width, height).count
  const { readback } = state
  const buffers = ensureSet<HairSampleBuffers, HairImageBuffersExtra>(
    state.buffers,
    device,
    {
      key: [width, height, samples, bandRows, tileCapacity, hardware],
      what: 'the samples and the tiles of the hair strands',
      label: SAMPLES_LABEL,
      fits: (held) =>
        held.width >= width &&
        held.height >= height &&
        held.sampleCount === samples &&
        held.hardware === hardware,
    },
    (allocator) =>
      allocateSamples(
        allocator,
        width,
        height,
        samples,
        bandRows,
        tileCapacity,
        readback.buffers,
        hardware,
      ),
    (made) =>
      hairBufferExtras(state, made, { width, height, samples, hardware, bandRows, tileCapacity }),
  )
  state.buffers = buffers.resources
  return buffers
}

/** The compacted samples of the strands, `room` of them, kept or made. */
function ensureNodes(state: HairViewGpu, device: GPUDevice, room: number) {
  const { readback } = state
  const nodes = ensureSet<ReturnType<typeof allocateHairNodes>, HairNodes>(
    state.nodes,
    device,
    {
      key: [room],
      what: 'the compacted samples of the hair strands',
      label: NODES_LABEL,
      fits: (held) => held.capacity >= room,
    },
    (allocator) => allocateHairNodes(allocator, room, readback.buffers),
    (made) => hairNodes(room, made),
  )
  state.nodes = nodes.resources
  state.nodes = nodes.resources
  return nodes
}

/** Makes the sets `demand` asks for that `state` does not hold, and the record of them; whether all
 *  are there. */
function makeHairResources(
  device: GPUDevice,
  state: HairViewGpu,
  demand: HairImageDemand,
  room: number,
  fail: (error: unknown) => void,
) {
  const { size, samples } = demand
  const [width, height] = size
  const limit = storageBufferCap(device.limits)
  const refuse = (why: string) => {
    tellHairOnce(state, 'resources', why, fail)
    return false
  }
  if (room * Math.max(HAIR_SAMPLE_BYTES, HAIR_NODE_DATA_BYTES) > limit)
    return refuse(`${room} compacted samples exceed the device's ${limit} bytes of one binding`)
  const bandRows = Math.min(hairBandRows(width, samples, limit), alignUp(height, HAIR_TILE_SIZE))
  if (bandRows <= 0)
    return refuse(
      `a tile of rows of ${samples} samples a pixel over ${width} pixels exceeds the device's ${limit}`,
    )
  const targets = ensureTargets(state, device, demand)
  const buffers = ensureBuffers(state, device, demand, bandRows)
  const nodes = ensureNodes(state, device, room)
  const why = targets.why ?? buffers.why ?? nodes.why
  if (!state.targets || !state.buffers || !state.nodes) return refuse(why ?? 'no room')
  const held = state.record
  if (
    held?.targets !== state.targets ||
    held.buffers !== state.buffers ||
    held.nodes !== state.nodes
  )
    state.record = hairViewRecord(
      state.imageBlock.buffer,
      state.targets,
      state.buffers,
      state.nodes,
    )
  return true
}

/** The record of the sets `targets`, `buffers` and `nodes`, over the image block `image`. */
function hairViewRecord(
  image: GPUBuffer,
  targets: HairImageTargets & HeldSet,
  buffers: HairImageBuffers & HeldSet,
  nodes: HairNodes & HeldSet,
): HairViewRecord {
  const { tiles } = buffers
  return {
    targets,
    buffers,
    nodes,
    view: {
      transmittance: targets.transmittance,
      nodeIndex: targets.nodeIndex,
      coverage: targets.coverage,
      hairOnlyDepth: targets.hairOnlyDepth,
      shadow: {
        hairDepth: targets.hairOnlyDepthView,
        counts: tiles.counts,
        tiles: tiles.data,
        dispatchArgs: tiles.dispatchArgs,
      },
    },
    compaction: {
      image,
      transmittance: targets.transmittanceView,
      tiles,
      nodeIndex: targets.nodeIndexView,
      coverage: targets.coverageView,
    },
    samples: buffers.sampleCount,
    needed: 0,
  }
}

/** Writes the windows of the bands of `buffers` for an image of `width` by `height`, where they
 *  changed, and counts the bands the image reaches. */
export function writeHairWindows(
  device: GPUDevice,
  buffers: HairImageBuffers,
  width: number,
  height: number,
) {
  const { bands, windowWords, rows, sampleCount } = buffers
  buffers.raster.count = hairBandCount(height, rows)
  for (let k = 0; k < buffers.raster.count; k++) {
    writeHairBand(windowWords, HAIR_BAND_WORDS * k, k, rows, width, height, sampleCount)
    writeChanged(
      device,
      bands[k]!.window,
      windowWords,
      HAIR_BAND_WORDS * k,
      HAIR_BAND_WORDS * (k + 1),
    )
  }
}

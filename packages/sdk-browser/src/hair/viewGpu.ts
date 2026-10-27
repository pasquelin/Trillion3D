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
import { rasterBinds, type HairBandBuffers, type HairRasterFrame } from './rasterPass.ts'
import { bufferEntries } from '../gpu/core/computeBindings.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { HAIR_INSTANCE_WORDS, HAIR_VIEW_WORDS } from './ribbonWgsl.ts'
import type { HairInstance, HairScene, HairViewLists } from './scene.ts'
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
export interface HairBandGpu extends HairBandBuffers {
  readonly raster: ReturnType<typeof rasterBinds>
  readonly compact: ReturnType<typeof compactionBinds>
}

/** The sample bands, the lists of tiles and the room they were made for: the image they hold is any of
 *  at most that width and height, grown by whole images and never made smaller. */
interface HairImageBuffersExtra {
  readonly width: number
  readonly height: number
  readonly sampleCount: HairSampleCount
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
  /** The strands of the image last encoded, for the passes of the frame that read them: none until
   *  `encodeHairStrands` sets it, and none again when an image has none to show. */
  visible?: HairVisibilityView
  /** The bytes the view holds. */
  readonly bytes: number
  dispose(): void
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
    drawn: [],
    members: [],
    macroGroups: [],
    rect: [0, 0, 0, 0],
    tileRect: [0, 0, 0, 0],
    get bytes() {
      let bytes = bounds.bytes + viewBlock.buffer.size + imageBlock.buffer.size
      for (const { block } of instances.values()) bytes += block.buffer.size
      for (const held of [state.targets, state.buffers, state.nodes]) bytes += held?.bytes ?? 0
      return bytes
    },
    dispose() {
      state.targets?.dispose()
      state.buffers?.dispose()
      state.nodes?.dispose()
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
    const groups = boundGroups<GPUBuffer, GPUBuffer, GPUBuffer>(
      3,
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
    !!buffers &&
    buffers.width >= width &&
    buffers.height >= height &&
    buffers.sampleCount === demand.samples &&
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

/** Makes the sets `demand` asks for that `state` does not hold, and the record of them; whether all
 *  are there. */
function makeHairResources(
  device: GPUDevice,
  state: HairViewGpu,
  demand: HairImageDemand,
  room: number,
  fail: (error: unknown) => void,
) {
  const { size, allocated, samples, blendable } = demand
  const [width, height] = size
  const tileCapacity = hairTileGrid(width, height).count
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
  const { readback } = state
  const targets = ensureSet(
    state.targets,
    device,
    {
      key: [allocated[0], allocated[1], blendable],
      what: 'the textures of the hair strands',
      label: TARGETS_LABEL,
    },
    (allocator) =>
      allocateHairImageTargets(allocator, allocated[0], allocated[1], blendable, readback.textures),
    extendHairImageTargets,
  )
  state.targets = targets.resources
  const buffers = ensureSet<HairSampleBuffers, HairImageBuffersExtra>(
    state.buffers,
    device,
    {
      key: [width, height, samples, bandRows, tileCapacity],
      what: 'the samples and the tiles of the hair strands',
      label: SAMPLES_LABEL,
      fits: (held) => held.width >= width && held.height >= height && held.sampleCount === samples,
    },
    (allocator) =>
      allocateSamples(allocator, width, height, samples, bandRows, tileCapacity, readback.buffers),
    (made): HairImageBuffersExtra => {
      const bands = made.samples.map((buffer, k): HairBandGpu => ({
        samples: buffer,
        window: made.windows[k]!,
        raster: rasterBinds(),
        compact: compactionBinds(),
      }))
      return {
        width,
        height,
        sampleCount: samples,
        rows: bandRows,
        tiles: hairTiles(tileCapacity, made.tileBuffers),
        bands,
        raster: { viewBuffer: state.viewBlock.buffer, bands, count: 0 },
        windowWords: new Uint32Array(HAIR_BAND_WORDS * bands.length),
      }
    },
  )
  state.buffers = buffers.resources
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

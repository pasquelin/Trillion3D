import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import {
  HAIR_TILE_GRID_BINDING,
  HAIR_TILE_LIST_BINDING,
  HAIR_TILE_META2_BINDING,
  HAIR_TILE_META_BINDING,
  HAIR_TILE_PARAMS_BINDING,
  HAIR_TILE_PRIMS2_BINDING,
  HAIR_TILE_PRIMS_BINDING,
  HAIR_TILE_CHUNK,
} from './rasterLimits.ts'
import {
  HAIR_RASTER_PARAM_WORDS,
  writeHairRasterParams,
  type HairRasterGeometry,
  type HairRasterPlan,
} from './rasterModes.ts'
import type { HairBandBuffers, HairRasterFrame } from './rasterPass.ts'

/** The pipelines of the compute raster's lists and tiles that do not depend on the phase of the visibility write: each present where the plan
 *  uses it, none while one compiles. */
export interface HairTilePipelines {
  /** Empties the counters, the tile counts and the lists of an instance. */
  readonly reset: GPUComputePipeline
  readonly classify?: GPUComputePipeline
  readonly depthGrid?: GPUComputePipeline
  readonly bin?: GPUComputePipeline
  readonly compact?: GPUComputePipeline
}

/** What the compute raster works over: the sizes it was made for, the parameters block, the grid of tile counters, the tiles and their segments
 *  (and the compacted ones), the lists of the classified segments, and the bind groups made over them. */
export interface HairBinned {
  readonly geometry: HairRasterGeometry
  readonly params: GPUBuffer
  readonly grid: GPUBuffer
  readonly tileData: GPUBuffer
  readonly prims: GPUBuffer
  readonly ids: GPUBuffer
  readonly tileData2: GPUBuffer
  readonly prims2: GPUBuffer
  readonly binds: ReturnType<typeof binnedBinds>
}

/** The buffers of the compute raster for `geometry`; the compacted tiles' segments only where the plan compacts. */
export const allocateBinned = (
  allocator: ResourceAllocator,
  geometry: HairRasterGeometry,
  plan: HairRasterPlan,
) => ({
  params: allocator.buffer('tile parameters', HAIR_RASTER_PARAM_WORDS, 'uniform'),
  grid: allocator.buffer('tile grid', geometry.gridWords, 'storage'),
  tileData: allocator.buffer('tiles', geometry.tileWords, 'storage'),
  prims: allocator.buffer('tile segments', geometry.primWords, 'storage'),
  ids: allocator.buffer('classified segments', geometry.listWords, 'storage'),
  tileData2: allocator.buffer(
    'compacted tiles',
    plan.compaction ? geometry.tileWords : 1,
    'storage',
  ),
  prims2: allocator.buffer(
    'compacted tile segments',
    plan.compaction ? geometry.primWords : 1,
    'storage',
  ),
})

/** The resources of the compute raster for `geometry`, kept while what sizes them stays, or made; none where the device's budget refuses them. */
export function ensureHairBinned(
  held: (HairBinned & HeldSet) | undefined,
  device: GPUDevice,
  geometry: HairRasterGeometry,
  plan: HairRasterPlan,
) {
  const { gridWords, tileWords, primWords, listWords } = geometry
  return ensureSet<ReturnType<typeof allocateBinned>, Pick<HairBinned, 'geometry' | 'binds'>>(
    held,
    device,
    {
      key: [gridWords, tileWords, primWords, listWords, plan.compaction],
      what: 'the tiles of the hair strands raster',
      label: 'hair strands raster',
    },
    (allocator) => allocateBinned(allocator, geometry, plan),
    () => ({ geometry, binds: binnedBinds() }),
  )
}

/** Writes the parameters block of the raster for an image of `size`. */
export function sendHairBinnedParams(
  device: GPUDevice,
  binned: HairBinned,
  plan: HairRasterPlan,
  size: readonly [number, number],
) {
  const words = new Uint32Array(HAIR_RASTER_PARAM_WORDS)
  writeHairRasterParams(words, binned.geometry, plan, size)
  device.queue.writeBuffer(binned.params, 0, words)
}

/** What a bind group of the raster names beside the held resources: the band, the opaque depth and the frame (the view block, the large ribbons). */
export interface BindContext {
  readonly band: HairBandBuffers | undefined
  readonly depth: GPUTextureView | undefined
  readonly frame: HairRasterFrame
}

/** The bindings, in group 1, each kernel of the raster reads (an `auto` layout holds exactly the bindings its entry reaches). */
export const HAIR_RASTER_SLOTS = {
  depthGrid: [1, 3, HAIR_TILE_PARAMS_BINDING, HAIR_TILE_GRID_BINDING],
  reset: [
    HAIR_TILE_PARAMS_BINDING,
    HAIR_TILE_GRID_BINDING,
    HAIR_TILE_META_BINDING,
    HAIR_TILE_LIST_BINDING,
    HAIR_TILE_META2_BINDING,
  ],
  classify: [0, HAIR_TILE_PARAMS_BINDING, HAIR_TILE_LIST_BINDING],
  bin: [
    0,
    3,
    HAIR_TILE_PARAMS_BINDING,
    HAIR_TILE_GRID_BINDING,
    HAIR_TILE_META_BINDING,
    HAIR_TILE_PRIMS_BINDING,
    HAIR_TILE_LIST_BINDING,
  ],
  compact: [
    HAIR_TILE_PARAMS_BINDING,
    HAIR_TILE_META_BINDING,
    HAIR_TILE_PRIMS_BINDING,
    HAIR_TILE_META2_BINDING,
    HAIR_TILE_PRIMS2_BINDING,
  ],
  tile: [0, 1, 2, 3, HAIR_TILE_PARAMS_BINDING, HAIR_TILE_META_BINDING, HAIR_TILE_PRIMS_BINDING],
  naive: [0, 1, 2, 3, 4, HAIR_TILE_PARAMS_BINDING, HAIR_TILE_LIST_BINDING],
} as const satisfies Record<string, readonly number[]>

/** The resource a binding names; `compacted` reads the compacted tiles in place of the binned ones. */
function resourceOf(
  binding: number,
  binned: HairBinned,
  { band, depth, frame }: BindContext,
  compacted: boolean,
): GPUBindingResource {
  switch (binding) {
    case 0:
      return { buffer: frame.viewBuffer }
    case 1:
      return depth!
    case 2:
      return { buffer: band!.samples }
    case 3:
      return { buffer: band!.window }
    case 4:
      return { buffer: frame.large! }
    case HAIR_TILE_PARAMS_BINDING:
      return { buffer: binned.params }
    case HAIR_TILE_GRID_BINDING:
      return { buffer: binned.grid }
    case HAIR_TILE_META_BINDING:
      return { buffer: compacted ? binned.tileData2 : binned.tileData }
    case HAIR_TILE_PRIMS_BINDING:
      return { buffer: compacted ? binned.prims2 : binned.prims }
    case HAIR_TILE_LIST_BINDING:
      return { buffer: binned.ids }
    case HAIR_TILE_META2_BINDING:
      return { buffer: binned.tileData2 }
    default:
      return { buffer: binned.prims2 }
  }
}

/** The reader of the bind group of the kernels that read `slots`, kept while the resources it names stay. */
const bindsOf = (slots: readonly number[], compacted = false) =>
  boundGroups<HairBinned, HairBandBuffers | undefined, GPUTextureView | undefined, HairRasterFrame>(
    4,
    (device, pipeline, binned, band, depth, frame) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: slots.map((binding) => ({
          binding,
          resource: resourceOf(binding, binned, { band, depth, frame }, compacted),
        })),
      }),
  )

/** The bind groups of the raster's kernels, one reader each. */
export const binnedBinds = () => ({
  depthGrid: bindsOf(HAIR_RASTER_SLOTS.depthGrid),
  reset: bindsOf(HAIR_RASTER_SLOTS.reset),
  classify: bindsOf(HAIR_RASTER_SLOTS.classify),
  bin: bindsOf(HAIR_RASTER_SLOTS.bin),
  compact: bindsOf(HAIR_RASTER_SLOTS.compact),
  tile: bindsOf(HAIR_RASTER_SLOTS.tile),
  compactedTile: bindsOf(HAIR_RASTER_SLOTS.tile, true),
  naive: bindsOf(HAIR_RASTER_SLOTS.naive),
})
type BinnedKernel = keyof ReturnType<typeof binnedBinds>

/** Binds `kernel`'s group 1 on `pass`; the instance's group 0 where `instance` is named. */
export function bindBinned(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  kernel: BinnedKernel,
  binned: HairBinned,
  context: BindContext,
  instance?: DrawnInstance,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    1,
    binned.binds[kernel](device, pipeline, binned, context.band, context.depth, context.frame),
  )
  if (instance) pass.setBindGroup(0, instance.group(pipeline))
}

/** The furthest opaque depth of each cell of the band, before its instances are binned. */
export function encodeDepthGrid(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  binned: HairBinned,
  context: BindContext,
) {
  bindBinned(device, pass, pipeline, 'depthGrid', binned, context)
  pass.dispatchWorkgroups(binned.geometry.cells[0], binned.geometry.cells[1])
}

/** Empties the counters and the lists, then sorts the segments of `instance` into the lists (the classification). */
export function encodeInstanceLists(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  tiles: HairTilePipelines,
  binned: HairBinned,
  context: BindContext,
  instance: DrawnInstance,
) {
  const { geometry } = binned
  const cells = tiles.bin ? geometry.cells[0] * geometry.cells[1] : 0
  bindBinned(device, pass, tiles.reset, 'reset', binned, context)
  dispatchRows(pass, ceilDiv(Math.max(cells * 4 * geometry.binners, 1), HAIR_TILE_CHUNK))
  if (tiles.classify) {
    bindBinned(device, pass, tiles.classify, 'classify', binned, context, instance)
    pass.dispatchWorkgroups(geometry.classifiers)
  }
}

/** Bins the segments of `instance` into the tiles and, where the plan compacts, compacts them; the tiles are then ready to be drawn
 *  (`encodeTileRaster`). */
export function encodeBinning(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  tiles: HairTilePipelines,
  binned: HairBinned,
  context: BindContext,
  instance: DrawnInstance,
) {
  bindBinned(device, pass, tiles.bin!, 'bin', binned, context, instance)
  pass.dispatchWorkgroups(binned.geometry.binners)
  if (tiles.compact) {
    bindBinned(device, pass, tiles.compact, 'compact', binned, context)
    pass.dispatchWorkgroups(binned.geometry.cells[0], binned.geometry.cells[1])
  }
}

/** Draws the tiles, the compacted ones where the plan compacts, with the phase's pipeline. */
export function encodeTileRaster(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  compacted: boolean,
  binned: HairBinned,
  context: BindContext,
  instance: DrawnInstance,
) {
  bindBinned(
    device,
    pass,
    pipeline,
    compacted ? 'compactedTile' : 'tile',
    binned,
    context,
    instance,
  )
  pass.dispatchWorkgroups(binned.geometry.rasterizers)
}

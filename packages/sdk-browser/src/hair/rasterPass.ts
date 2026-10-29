import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { MODE_DEPTH, MODE_ID } from '../visibility/raster/contract.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { clearWgsl, HAIR_LARGE_BINDING, rasterWgsl } from './rasterWgsl.ts'
import { binnedWgsl } from './binnedWgsl.ts'
import {
  bindBinned,
  encodeBinning,
  encodeDepthGrid,
  encodeInstanceLists,
  encodeTileRaster,
  type BindContext,
  type HairBinned,
  type HairTilePipelines,
} from './binnedRasterPass.ts'
import type { HairRasterList, HairRasterPlan } from './rasterModes.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DISPATCH, type HairSampleCount } from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The entries of the raster's module: the segments drawn by a thread, the large ribbons drawn by a group of them, and the arguments of that
 *  group's dispatch. */
type RasterEntry = 'hairRaster' | 'hairRasterLarge' | 'hairLargeArgs'
/** The entries of the tiled raster's module (`binnedWgsl.ts`). */
type TileEntry =
  | 'hairDepthGrid'
  | 'hairTileClear'
  | 'hairClassify'
  | 'hairBin'
  | 'hairTileCompact'
  | 'hairTileRaster'

const TILE_ENTRIES: ReadonlySet<string> = new Set<TileEntry>([
  'hairDepthGrid',
  'hairTileClear',
  'hairClassify',
  'hairBin',
  'hairTileCompact',
  'hairTileRaster',
])

/** The kernels of the raster, by sample count, whether the device has the 64-bit maximum, the phase of the write without it, the entry and
 *  the constants it is set with (the list a thread-a-segment raster walks, the list the binning reads). */
const rasterKernels = preparedPipelines(
  ({
    samples,
    wide,
    mode,
    entry,
    constants,
  }: {
    samples: HairSampleCount
    wide: boolean
    mode: number
    entry: RasterEntry | TileEntry
    constants?: Record<string, number>
  }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}${entry} ${samples} ${wide ? 'wide' : `split ${mode}`} ${JSON.stringify(constants ?? {})}`,
      (TILE_ENTRIES.has(entry) ? binnedWgsl : rasterWgsl)(samples, wide),
      entry,
      wide && !constants ? undefined : { ...(wide ? {} : { MODE: mode }), ...constants },
    ),
  ({ samples, wide, mode, entry, constants }) =>
    `${entry} ${samples} ${wide ? 'wide' : mode} ${JSON.stringify(constants ?? {})}`,
)
const clearKernels = preparedPipelines(
  ({ samples, wide }: { samples: HairSampleCount; wide: boolean }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}clear samples ${samples} ${wide ? 'wide' : 'split'}`,
      clearWgsl(samples, wide),
      'hairClearSamples',
    ),
  ({ samples, wide }) => `${samples} ${wide}`,
)

/** The clear of the samples of the tiles with strands, for either raster; none while it compiles. */
export const clearSamplesPipeline = (device: GPUDevice, samples: HairSampleCount, wide: boolean) =>
  clearKernels.of({ samples, wide })(device).get()

/** One phase of the raster: the pipelines a thread draws a segment with, by the list it walks, the one a group of threads draws a large ribbon
 *  with, and the one that draws the tiles. */
interface RasterPhase {
  readonly naive: ReadonlyMap<HairRasterList, GPUComputePipeline>
  readonly large?: GPUComputePipeline
  readonly tile?: GPUComputePipeline
}

/** The pipelines of the thread-a-segment raster for the lists of `plan`, those that are ready. */
function naivePipelines(
  plan: HairRasterPlan,
  pipeline: (list: HairRasterList) => GPUComputePipeline | undefined,
) {
  const made = new Map<HairRasterList, GPUComputePipeline>()
  for (const list of plan.naive) {
    const ready = pipeline(list)
    if (ready) made.set(list, ready)
  }
  return made
}

/**
 * The pipelines of the raster for `plan`, in the order of its phases (one with the 64-bit maximum, the depth then the identifier without it):
 * the one that writes the arguments over the large ribbons, the lists' and tiles' passes, and the clear of the samples; none while one compiles.
 */
export function rasterPipelines(
  device: GPUDevice,
  samples: HairSampleCount,
  wide: boolean,
  plan: HairRasterPlan,
) {
  const modes = wide ? [MODE_DEPTH] : [MODE_DEPTH, MODE_ID]
  const kernel = (
    entry: RasterEntry | TileEntry,
    mode = MODE_DEPTH,
    constants?: Record<string, number>,
  ) => rasterKernels.of({ samples, wide, mode, entry, constants })(device).get()
  const phases = modes.map((mode): RasterPhase => ({
    naive: naivePipelines(plan, (list) => kernel('hairRaster', mode, { LIST: list })),
    large: plan.naive.length ? kernel('hairRasterLarge', mode) : undefined,
    tile: plan.tiles ? kernel('hairTileRaster', mode) : undefined,
  }))
  const args = plan.naive.length ? kernel('hairLargeArgs') : undefined
  const lists = plan.tiles || plan.classification
  const tiles: Partial<HairTilePipelines> = lists
    ? {
        reset: kernel('hairTileClear'),
        classify: plan.classification ? kernel('hairClassify') : undefined,
        depthGrid: plan.tiles ? kernel('hairDepthGrid') : undefined,
        bin: plan.tiles
          ? kernel('hairBin', MODE_DEPTH, { BIN_LISTED: plan.classification ? 1 : 0 })
          : undefined,
        compact: plan.compaction ? kernel('hairTileCompact') : undefined,
      }
    : {}
  const clear = clearSamplesPipeline(device, samples, wide)
  const ready =
    clear &&
    (!plan.naive.length || args) &&
    (!lists || tiles.reset) &&
    (!plan.classification || tiles.classify) &&
    (!plan.tiles || (tiles.depthGrid && tiles.bin)) &&
    (!plan.compaction || tiles.compact) &&
    phases.every(
      ({ naive, large, tile }) =>
        naive.size === plan.naive.length && (!plan.naive.length || large) && (!plan.tiles || tile),
    )
  return ready
    ? {
        phases,
        args,
        clear,
        plan,
        tiles: lists ? (tiles as HairTilePipelines) : undefined,
      }
    : undefined
}

/** The bind groups of the raster and of the clear over one band, kept while the resources they name
 *  stay. */
export function rasterBinds() {
  return {
    frame: boundGroups<GPUBuffer, GPUTextureView, HairBandBuffers, GPUBuffer>(
      4,
      (device, pipeline, view, depth, band, large) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: sequentialEntries([
            { buffer: view },
            depth,
            { buffer: band.samples },
            { buffer: band.window },
            { buffer: large },
          ]),
        }),
    ),
    args: boundGroups<GPUBuffer, GPUBuffer, undefined>(1, (device, pipeline, large, args) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: [
          { binding: HAIR_LARGE_BINDING, resource: { buffer: large } },
          { binding: HAIR_LARGE_BINDING + 1, resource: { buffer: args } },
        ],
      }),
    ),
    clear: boundGroups<GPUBuffer, HairTiles, HairBandBuffers>(
      1,
      (device, pipeline, image, tiles, band) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: bufferEntries([image, tiles.counts, tiles.data, band.samples, band.window]),
        }),
    ),
  }
}

/** A band of the samples: its buffer and its window (`HAIR_BAND_WGSL`). */
export interface HairBandBuffers {
  readonly samples: GPUBuffer
  readonly window: GPUBuffer
}

/** What the raster binds besides an instance: the view block, the list of large ribbons with the
 *  arguments of the dispatch over it (`HAIR_LARGE_WORDS`, `HAIR_LARGE_ARGS_WORDS`) and the bands of the
 *  samples, each with the bind groups made of it and the resources. */
export interface HairRasterFrame {
  readonly viewBuffer: GPUBuffer
  /** None with the hardware raster, which lists no large ribbon. */
  readonly large: GPUBuffer | undefined
  readonly largeArgs: GPUBuffer | undefined
  readonly bands: readonly (HairBandBuffers & { readonly raster: ReturnType<typeof rasterBinds> })[]
  /** How many of the bands the image reaches: those past it hold no row of it. */
  count: number
}

/** Empties the samples of the tiles with strands, in `pass`, band after band: `image` is the image
 *  block, `tiles` the lists that name them. */
export function encodeHairClearSamples(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  frame: HairRasterFrame,
  image: GPUBuffer,
  tiles: HairTiles,
) {
  pass.setPipeline(pipeline)
  for (let k = 0; k < frame.count; k++) {
    const band = frame.bands[k]!
    pass.setBindGroup(0, band.raster.clear(device, pipeline, image, tiles, band))
    pass.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
  }
}

/**
 * Rasters the strands of `drawn` in `pass`, band after band and phase after phase (each dispatch sees the ones before), by the plan the
 * settings make (`hairRasterPlan`). For each instance the counters and lists are emptied and, with the classification, its segments are sorted
 * into the software and the hardware list. A thread draws a segment (`hairRaster`, over the list the plan names): the ribbons that span more
 * than a tile of pixels are listed by those threads, and the dispatch that follows draws them, a group of threads each (`hairRasterLarge`),
 * after the arguments over the list are written (`hairLargeArgs`, which empties the list for the next dispatch). The segments the plan leaves
 * to the tiled raster are binned into the tiles of the image they reach (`hairBin`), the tiles of a cell optionally compacted
 * (`hairTileCompact`), and each tile drawn by a group of threads (`hairTileRaster`), after the furthest opaque depth of each cell of the band
 * is found (`hairDepthGrid`), which bins no segment behind.
 */
export function encodeHairRaster(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof rasterPipelines>>,
  frame: HairRasterFrame,
  depthView: GPUTextureView,
  drawn: readonly DrawnInstance[],
  binned: HairBinned,
) {
  const { viewBuffer, large, largeArgs } = frame
  if (!large || !largeArgs) return
  const { plan, tiles, args } = pipelines
  for (let k = 0; k < frame.count; k++) {
    const band = frame.bands[k]!
    const context: BindContext = { band, depth: depthView, frame }
    if (tiles?.depthGrid) encodeDepthGrid(device, pass, tiles.depthGrid, binned, context)
    for (const phase of pipelines.phases) {
      for (const instance of drawn) {
        if (tiles) encodeInstanceLists(device, pass, tiles, binned, context, instance)
        for (const [, pipeline] of phase.naive) {
          bindBinned(device, pass, pipeline, 'naive', binned, context, instance)
          pass.dispatchWorkgroups(binned.geometry.rasterizersNaive)
          pass.setPipeline(args!)
          pass.setBindGroup(1, band.raster.args(device, args!, large, largeArgs, undefined))
          pass.dispatchWorkgroups(1)
          const wide = phase.large!
          pass.setPipeline(wide)
          pass.setBindGroup(1, band.raster.frame(device, wide, viewBuffer, depthView, band, large))
          pass.setBindGroup(0, instance.group(wide))
          pass.dispatchWorkgroupsIndirect(largeArgs, 0)
        }
        if (phase.tile) {
          encodeBinning(device, pass, tiles!, binned, context, instance)
          encodeTileRaster(device, pass, phase.tile, plan.compaction, binned, context, instance)
        }
      }
    }
  }
}

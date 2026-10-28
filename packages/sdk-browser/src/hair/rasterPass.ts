import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { MODE_DEPTH, MODE_ID } from '../visibility/raster/contract.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { clearWgsl, HAIR_LARGE_BINDING, rasterWgsl } from './rasterWgsl.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DISPATCH, type HairSampleCount } from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The entries of the raster's module: the segments drawn by a thread, the large ribbons drawn by a group of
 *  them, and the arguments of that group's dispatch. */
type RasterEntry = 'hairRaster' | 'hairRasterLarge' | 'hairLargeArgs'

/** The kernels of the raster, by sample count, whether the device has the 64-bit maximum, the phase of the
 *  write without it, and the entry. */
const rasterKernels = preparedPipelines(
  ({
    samples,
    wide,
    mode,
    entry,
  }: {
    samples: HairSampleCount
    wide: boolean
    mode: number
    entry: RasterEntry
  }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}${entry} ${samples} ${wide ? 'wide' : `split ${mode}`}`,
      rasterWgsl(samples, wide),
      entry,
      wide ? undefined : { MODE: mode },
    ),
  ({ samples, wide, mode, entry }) => `${entry} ${samples} ${wide ? 'wide' : mode}`,
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

/** One phase of the raster: the pipeline a thread draws a segment with, and the one a group of threads
 *  draws a large ribbon with. */
interface RasterPhase {
  readonly raster: GPUComputePipeline
  readonly large: GPUComputePipeline
}

/** The pipelines of the raster, in the order of its phases (one with the 64-bit maximum, the depth
 *  then the identifier without it), the one that writes the arguments over the large ribbons, and the
 *  clear of the samples; none while one compiles. */
export function rasterPipelines(device: GPUDevice, samples: HairSampleCount, wide: boolean) {
  const modes = wide ? [MODE_DEPTH] : [MODE_DEPTH, MODE_ID]
  const kernel = (mode: number, entry: RasterEntry) =>
    rasterKernels.of({ samples, wide, mode, entry })(device).get()
  const phases = modes.map((mode) => ({
    raster: kernel(mode, 'hairRaster'),
    large: kernel(mode, 'hairRasterLarge'),
  }))
  const args = kernel(MODE_DEPTH, 'hairLargeArgs')
  const clear = clearSamplesPipeline(device, samples, wide)
  return clear && args && phases.every(({ raster, large }) => raster && large)
    ? { phases: phases as RasterPhase[], args, clear }
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

/** Rasters the strands of `drawn` in `pass`, band after band and phase after phase (each dispatch
 *  sees the ones before). A thread draws a segment; the ribbons that span more than a tile of pixels
 *  are listed by those threads, and the dispatch that follows draws them, a group of threads each
 *  (`hairRasterLarge`), after the arguments over the list are written (`hairLargeArgs`, which empties
 *  the list for the next instance). */
export function encodeHairRaster(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof rasterPipelines>>,
  frame: HairRasterFrame,
  depthView: GPUTextureView,
  drawn: readonly DrawnInstance[],
) {
  const { viewBuffer, large, largeArgs } = frame
  if (!large || !largeArgs) return
  for (let k = 0; k < frame.count; k++) {
    const band = frame.bands[k]!
    for (const phase of pipelines.phases) {
      for (const instance of drawn) {
        pass.setPipeline(phase.raster)
        pass.setBindGroup(
          1,
          band.raster.frame(device, phase.raster, viewBuffer, depthView, band, large),
        )
        pass.setBindGroup(0, instance.group(phase.raster))
        dispatchRows(pass, ceilDiv(instance.pointCount, WORKGROUP_THREADS))
        pass.setPipeline(pipelines.args)
        pass.setBindGroup(1, band.raster.args(device, pipelines.args, large, largeArgs, undefined))
        pass.dispatchWorkgroups(1)
        pass.setPipeline(phase.large)
        pass.setBindGroup(
          1,
          band.raster.frame(device, phase.large, viewBuffer, depthView, band, large),
        )
        pass.setBindGroup(0, instance.group(phase.large))
        pass.dispatchWorkgroupsIndirect(largeArgs, 0)
      }
    }
  }
}

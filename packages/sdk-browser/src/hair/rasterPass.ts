import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { MODE_DEPTH, MODE_ID } from '../visibility/raster/contract.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { clearWgsl, rasterWgsl } from './rasterWgsl.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DISPATCH, type HairSampleCount } from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The kernels of the raster, by sample count, whether the device has the 64-bit maximum, and the
 *  phase of the write without it. */
const rasterKernels = preparedPipelines(
  ({ samples, wide, mode }: { samples: HairSampleCount; wide: boolean; mode: number }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}raster ${samples} ${wide ? 'wide' : `split ${mode}`}`,
      rasterWgsl(samples, wide),
      'hairRaster',
      wide ? undefined : { MODE: mode },
    ),
  ({ samples, wide, mode }) => `${samples} ${wide ? 'wide' : mode}`,
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

/** The pipelines of the raster, in the order of its phases (one with the 64-bit maximum, the depth
 *  then the identifier without it), and the clear of the samples; none while one compiles. */
export function rasterPipelines(device: GPUDevice, samples: HairSampleCount, wide: boolean) {
  const modes = wide ? [MODE_DEPTH] : [MODE_DEPTH, MODE_ID]
  const phases = modes.map((mode) => rasterKernels.of({ samples, wide, mode })(device).get())
  const clear = clearKernels.of({ samples, wide })(device).get()
  return clear && phases.every((pipeline) => pipeline)
    ? { phases: phases as GPUComputePipeline[], clear }
    : undefined
}

/** The bind groups of the raster and of the clear over one band, kept while the resources they name
 *  stay. */
export function rasterBinds() {
  return {
    frame: boundGroups<GPUBuffer, GPUTextureView, HairBandBuffers>(
      2,
      (device, pipeline, view, depth, band) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: sequentialEntries([
            { buffer: view },
            depth,
            { buffer: band.samples },
            { buffer: band.window },
          ]),
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

/** What the raster binds besides an instance: the view block and the bands of the samples, each with
 *  the bind groups made of it and the resources. */
export interface HairRasterFrame {
  readonly viewBuffer: GPUBuffer
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
 *  sees the ones before). */
export function encodeHairRaster(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: readonly GPUComputePipeline[],
  frame: HairRasterFrame,
  depthView: GPUTextureView,
  drawn: readonly DrawnInstance[],
) {
  for (let k = 0; k < frame.count; k++) {
    const band = frame.bands[k]!
    for (const pipeline of pipelines) {
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, band.raster.frame(device, pipeline, frame.viewBuffer, depthView, band))
      for (const instance of drawn) {
        pass.setBindGroup(0, instance.group(pipeline))
        dispatchRows(pass, ceilDiv(instance.pointCount, WORKGROUP_THREADS))
      }
    }
  }
}

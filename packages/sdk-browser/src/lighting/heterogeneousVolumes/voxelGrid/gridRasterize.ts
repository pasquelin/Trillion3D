import { wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { cellsOf, groupsOf, run, type Encoding } from './gridBuild.ts'
import { VG_PARAMS_STRIDE } from './gridPasses.ts'
import type { GridVolume } from './gridPlan.ts'
import { packArgsParams, packRasterParams, packTileParams, type RasterGrid } from './rasterPack.ts'
import { VG_RASTER_PARAMS_BYTES } from './rasterParamsWgsl.ts'
import { VG_SAMPLE_VECTORS, VG_TILE_VOXELS } from './rasterSamplesWgsl.ts'
import { INDIRECT, STORAGE, UNIFORM } from './bufferUsage.ts'

type Vec3 = readonly [number, number, number]

/** A volume as the grids see it: how to plan the grids round it, its world box, and how to evaluate its material at the positions of the samples. */
export interface GridSource {
  readonly volume: GridVolume
  /** The box the volume's bounds make in the world, as its two corners. */
  readonly boxMin: Vec3
  readonly boxMax: Vec3
  /** Encodes the volume's program over the tiles: for each position the samples hold, the volume's extinction, emission and scattering there. */
  readonly sample: (encoder: GPUCommandEncoder, samples: GPUBuffer, args: GPUBuffer) => void
}

/** What a build asks of the device and the frame: the buffers it keeps, by role, and the limits it stays within. */
export interface GridBuildEnvironment extends Encoding {
  readonly bufferOf: (key: string, size: number, usage: GPUBufferUsageFlags) => GPUBuffer
  readonly noiseView: GPUTextureView
  readonly maxBinding: number
  readonly mostGroups: number
}

/**
 * What a grid's pools hold: the raster tiles (one a top-level cell, or, with the indirection grid, up to 64), whose samples take a vector of
 * four a voxel of a tile; the bottom-level cells, the megabytes asked over the size of an emission cell, and the indirection cells, 64 a
 * top-level cell. None passes what a storage binding of the device holds, and a pool is never empty.
 */
export function gridPools(c: {
  cells: number
  indirection: boolean
  memoryMegabytes: number
  maxBinding: number
}) {
  const sampleBytes = VG_TILE_VOXELS * VG_SAMPLE_VECTORS * 16
  return {
    tiles: Math.max(
      1,
      Math.min(c.cells * (c.indirection ? 64 : 1), Math.floor(c.maxBinding / sampleBytes)),
    ),
    // An emission and scattering cell takes 16 bytes, the larger of the buffers.
    bottom: Math.max(
      VG_TILE_VOXELS,
      Math.min(Math.floor((c.memoryMegabytes * 1e6) / 8), Math.floor(c.maxBinding / 16)),
    ),
    indirection: c.indirection
      ? Math.max(64, Math.min(c.cells * 64, Math.floor(c.maxBinding / 4)))
      : 1,
  }
}

/** Runs `stage` over the groups an indirect buffer holds. */
function runIndirect(
  pass: GPUComputePassEncoder,
  stage: { get(): GPUComputePipeline | undefined },
  group: GPUBindGroup,
  args: GPUBuffer,
  offsets: number[],
) {
  const pipeline = stage.get()
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group, offsets)
  pass.dispatchWorkgroupsIndirect(args, 0)
}

/**
 * The tiles of a grid the volumes are rasterized in, cut and counted on the GPU (`GenerateRasterTiles`, then `SetRasterizeBottomLevelGridIndirectArgs`),
 * the buffer of the samples their voxels take, and the arguments of the dispatches over them.
 */
export function encodeRasterTiles(
  c: GridBuildEnvironment & {
    topLevel: GPUBuffer
    allocators: GPUBuffer
    resolution: Vec3
    indirection: boolean
    tilePool: number
    /** The grid the tiles are of, which names the buffers (two grids built in a frame keep their own). */
    role: 'ortho' | 'frustum'
  },
) {
  const { device, passes } = c
  const tiles = c.bufferOf(`grid ${c.role} raster tiles`, c.tilePool * 8, STORAGE)
  const samples = c.bufferOf(
    `grid ${c.role} raster samples`,
    c.tilePool * VG_TILE_VOXELS * VG_SAMPLE_VECTORS * 16,
    STORAGE,
  )
  const args = c.bufferOf(`grid ${c.role} raster arguments`, 16, STORAGE | INDIRECT)
  const params = c.bufferOf(`grid ${c.role} raster tile parameters`, 2 * VG_PARAMS_STRIDE, UNIFORM)
  device.queue.writeBuffer(params, 0, packTileParams(c.resolution, c.indirection))
  device.queue.writeBuffer(
    params,
    VG_PARAMS_STRIDE,
    packArgsParams([c.mostGroups, c.mostGroups, c.mostGroups], c.tilePool),
  )
  const buffer = (b: GPUBuffer, offset = 0, size?: number) => ({
    buffer: b,
    offset,
    ...(size && { size }),
  })
  const tilesGroup = device.createBindGroup({
    layout: passes.tiles.layout,
    entries: [
      { binding: 0, resource: buffer(params, 0, 16) },
      { binding: 1, resource: buffer(c.topLevel, 0, cellsOf(c.resolution) * 4) },
      { binding: 2, resource: buffer(c.allocators) },
      { binding: 3, resource: buffer(tiles) },
    ],
  })
  const argsGroup = device.createBindGroup({
    layout: passes.args.layout,
    entries: [
      { binding: 0, resource: buffer(params, VG_PARAMS_STRIDE, 16) },
      { binding: 1, resource: buffer(c.allocators) },
      { binding: 2, resource: buffer(args) },
    ],
  })
  const pass = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid raster tiles',
  })
  run(pass, passes.tiles.pipeline, tilesGroup, groupsOf(c.resolution))
  run(pass, passes.args.pipeline, argsGroup, [1, 1, 1])
  pass.end()
  return { tiles, samples, args }
}

/**
 * One volume rasterized into a grid (`RasterizeBottomLevelOrthoGridCS` and `RasterizeBottomLevelFrustumGridCS`, in three steps over the same tiles): the positions of
 * the tiles' voxels, the volume's material at them (by the volume's program, `source.sample`), and the samples folded into the grid.
 */
export function encodeRasterizeVolume(
  c: GridBuildEnvironment & {
    grid: RasterGrid
    source: GridSource
    slot: number
    parameters: GPUBuffer
    topLevel: GPUBuffer
    indirectionGrid: GPUBuffer
    extinction: GPUBuffer
    material: GPUBuffer
    allocators: GPUBuffer
    raster: { tiles: GPUBuffer; samples: GPUBuffer; args: GPUBuffer }
    jitter: boolean
    frame: number
    homogeneousThreshold: number | undefined
  },
) {
  const { device, passes, raster } = c
  device.queue.writeBuffer(
    c.parameters,
    c.slot * VG_PARAMS_STRIDE,
    packRasterParams({
      grid: c.grid,
      primitiveMin: c.source.boxMin,
      primitiveMax: c.source.boxMax,
      jitter: c.jitter,
      frame: c.frame,
      homogeneousThreshold: c.homogeneousThreshold ?? -1,
    }),
  )
  const offset = c.slot * VG_PARAMS_STRIDE
  const params = { buffer: c.parameters, offset: 0, size: VG_RASTER_PARAMS_BYTES }
  const prepare = device.createBindGroup({
    layout: passes.prepareSamples.layout,
    entries: [
      { binding: 0, resource: params },
      { binding: 1, resource: wholeBuffer(c.topLevel) },
      { binding: 2, resource: wholeBuffer(raster.tiles) },
      { binding: 3, resource: wholeBuffer(c.allocators) },
      { binding: 4, resource: wholeBuffer(raster.samples) },
      { binding: 5, resource: c.noiseView },
    ],
  })
  const fold = device.createBindGroup({
    layout: passes.rasterize.layout,
    entries: [
      { binding: 0, resource: params },
      { binding: 1, resource: wholeBuffer(c.topLevel) },
      { binding: 2, resource: wholeBuffer(c.indirectionGrid) },
      { binding: 3, resource: wholeBuffer(c.extinction) },
      { binding: 4, resource: wholeBuffer(c.material) },
      { binding: 5, resource: wholeBuffer(c.allocators) },
      { binding: 6, resource: wholeBuffer(raster.tiles) },
      { binding: 7, resource: wholeBuffer(raster.samples) },
    ],
  })
  const first = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid samples',
  })
  runIndirect(first, passes.prepareSamples.pipeline, prepare, raster.args, [offset])
  first.end()
  c.source.sample(c.encoder, raster.samples, raster.args)
  const last = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid rasterize',
  })
  runIndirect(last, passes.rasterize.pipeline, fold, raster.args, [offset])
  last.end()
}

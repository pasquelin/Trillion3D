import {
  chainBytes,
  cellsOf,
  encodeClearTopLevel,
  encodeMajorantGrid,
  encodePerVolume,
  encodeTopLevelBitmask,
  groupsOf,
  gridBytes,
  run,
} from './gridBuild.ts'
import { VG_PARAMS_STRIDE } from './gridPasses.ts'
import {
  globalBoundsAndMinimumVoxelSize,
  topLevelGridResolution,
  type GridBounds,
  type GridBuildOptions,
  type GridSettings,
  type GridView,
} from './gridPlan.ts'
import { packSizeParams } from './gridPack.ts'
import { packAllocateParams, type RasterGrid } from './rasterPack.ts'
import {
  encodeRasterTiles,
  encodeRasterizeVolume,
  gridPools,
  type GridBuildEnvironment,
  type GridSource,
} from './gridRasterize.ts'
import { STORAGE, UNIFORM } from './bufferUsage.ts'
import { VG_ALLOCATOR_WORDS } from './rasterTilesWgsl.ts'

type Vec3 = readonly [number, number, number]

/** The settings the build reads besides the plan's (`gridPlan.ts`). */
export interface OrthoGridSettings extends GridSettings {
  /** The memory, in megabytes, the bottom level may take. */
  readonly bottomLevelMemoryMegabytes: number
  /** The relative error under which a tile is one voxel, none to leave the tiles whole. */
  readonly homogeneousThreshold: number | undefined
  readonly majorantGrid: boolean
  readonly majorantGridMax: boolean
  readonly topLevelBitmask: boolean
}

/** The ortho grid a build leaves: its buffers and what the passes that read them need of it. */
export interface OrthoGrid {
  readonly resolution: Vec3
  readonly bounds: GridBounds
  readonly indirection: boolean
  /** The voxels along a side of a top-level cell: its bottom level times its indirection grid. */
  readonly cellVoxels: number
  readonly topLevel: GPUBuffer
  readonly indirectionGrid: GPUBuffer
  readonly extinction: GPUBuffer
  readonly material: GPUBuffer
  readonly majorant: GPUBuffer
  readonly bitmask?: GPUBuffer
}

/**
 * THE ORTHO GRID BUILT (`BuildOrthoVoxelGrid`): the bounds of the volumes the view's frustum meets and the smallest voxel they ask give the top
 * level's resolution; each top-level cell a volume's box meets takes the size of voxel its distance asks (`topLevelGridCalculateVoxelSize`); the
 * bottom level is sized (`allocateBottomLevelGrid`), cut into raster tiles, every volume rasterized in turn, and the majorants (and, where the
 * settings ask, the bitmask of the occupied cells) taken. Nothing where no volume meets the view's frustum.
 */
export function encodeOrthoGrid(
  c: GridBuildEnvironment & {
    view: GridView
    orthographic: boolean
    planes: Float32Array
    sources: readonly GridSource[]
    options: GridBuildOptions
    settings: OrthoGridSettings
    jitter: boolean
    frame: number
  },
): OrthoGrid | undefined {
  const { device, passes, settings } = c
  const { bounds, minimumVoxelSize } = globalBoundsAndMinimumVoxelSize(
    [c.view],
    c.sources.map((s) => s.volume),
    c.options,
    settings,
  )
  if (!bounds || !c.sources.length) return undefined
  const resolution = topLevelGridResolution(bounds, minimumVoxelSize, settings)
  const cells = cellsOf(resolution)
  const indirection = settings.indirectionGrid
  const pools = gridPools({
    cells,
    indirection,
    memoryMegabytes: settings.bottomLevelMemoryMegabytes,
    maxBinding: c.maxBinding,
  })
  const topLevel = c.bufferOf('grid ortho top level', cells * 4, STORAGE)
  const indirectionGrid = c.bufferOf('grid ortho indirection', pools.indirection * 4, STORAGE)
  const extinction = c.bufferOf('grid ortho extinction', pools.bottom * 8, STORAGE)
  const material = c.bufferOf('grid ortho material', pools.bottom * 16, STORAGE)
  const majorant = c.bufferOf('grid ortho majorant', gridBytes(resolution).majorant, STORAGE)
  const allocators = c.bufferOf('grid ortho allocators', VG_ALLOCATOR_WORDS * 4, STORAGE)
  const box = {
    min: bounds.origin.map((o, i) => o - bounds.extent[i]) as unknown as Vec3,
    max: bounds.origin.map((o, i) => o + bounds.extent[i]) as unknown as Vec3,
  }
  const shared = { device, encoder: c.encoder, passes }

  encodeClearTopLevel({ ...shared, topLevel, resolution })
  encodeClearTopLevel({
    ...shared,
    topLevel: indirectionGrid,
    resolution: [pools.indirection, 1, 1],
  })
  c.encoder.clearBuffer(allocators)

  // The size of voxel each top-level cell a volume's box meets takes.
  encodePerVolume({
    ...shared,
    stage: passes.voxelSize,
    topLevel,
    uniform: c.bufferOf('grid ortho sizes', c.sources.length * VG_PARAMS_STRIDE, UNIFORM),
    params: c.sources.map((s) =>
      packSizeParams({
        resolution,
        bounds,
        volume: s.volume,
        view: c.view,
        planes: c.planes,
        orthographic: c.orthographic,
        options: c.options,
        settings,
      }),
    ),
    resolution,
    label: 'Trillion3D heterogeneous volume grid voxel size',
  })

  // The bottom level sized: from the voxel size, the cells along a side, or the indirection cells.
  const allocate = c.bufferOf('grid ortho allocation', 256, UNIFORM)
  device.queue.writeBuffer(
    allocate,
    0,
    packAllocateParams({
      resolution,
      indirection,
      boundsMin: box.min,
      boundsMax: box.max,
      maxVoxelResolution: settings.bottomLevelGridResolution,
      indirectionPool: pools.indirection,
    }),
  )
  const allocateGroup = device.createBindGroup({
    layout: passes.allocate.layout,
    entries: [
      { binding: 0, resource: { buffer: allocate, size: 48 } },
      { binding: 1, resource: { buffer: topLevel, size: cells * 4 } },
      { binding: 2, resource: { buffer: allocators } },
    ],
  })
  const sizing = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid bottom level',
  })
  run(sizing, passes.allocate.pipeline, allocateGroup, groupsOf(resolution))
  sizing.end()

  const raster = encodeRasterTiles({
    ...c,
    topLevel,
    allocators,
    resolution,
    indirection,
    tilePool: pools.tiles,
    role: 'ortho',
  })
  const grid: RasterGrid = {
    kind: 'ortho',
    resolution,
    boundsMin: box.min,
    boundsMax: box.max,
    indirection,
    bottomResolution: settings.bottomLevelGridResolution,
    viewToWorld: [],
    tanHalfFov: 0,
    near: 0,
    far: 0,
    pool: pools.bottom,
  }
  const parameters = c.bufferOf(
    'grid ortho raster parameters',
    c.sources.length * VG_PARAMS_STRIDE,
    UNIFORM,
  )
  c.sources.forEach((source, slot) =>
    encodeRasterizeVolume({
      ...c,
      grid,
      source,
      slot,
      parameters,
      topLevel,
      indirectionGrid,
      extinction,
      material,
      allocators,
      raster,
      homogeneousThreshold: settings.homogeneousThreshold,
    }),
  )

  let bitmask: GPUBuffer | undefined
  if (settings.topLevelBitmask) {
    bitmask = c.bufferOf('grid ortho bitmask', gridBytes(resolution).bitmask, STORAGE)
    encodeTopLevelBitmask({
      ...shared,
      topLevel,
      bitmask,
      uniform: c.bufferOf('grid ortho bitmask resolution', 16, UNIFORM),
      resolution,
    })
  }
  if (settings.majorantGrid)
    encodeMajorantGrid({
      ...shared,
      topLevel,
      indirection: indirectionGrid,
      extinction,
      majorant,
      chain: [
        c.bufferOf('grid ortho majorant chain 0', chainBytes(resolution), STORAGE),
        c.bufferOf('grid ortho majorant chain 1', chainBytes(resolution), STORAGE),
      ],
      parameters: c.bufferOf('grid ortho majorant parameters', 6 * VG_PARAMS_STRIDE + 256, UNIFORM),
      resolution,
      indirectionGrid: indirection,
      maximum: settings.majorantGridMax,
    })
  else c.encoder.clearBuffer(majorant)
  return {
    resolution,
    bounds,
    indirection,
    cellVoxels:
      settings.bottomLevelGridResolution * (indirection ? settings.indirectionGridResolution : 1),
    topLevel,
    indirectionGrid,
    extinction,
    material,
    majorant,
    ...(bitmask && { bitmask }),
  }
}

import { STORAGE, UNIFORM } from './bufferUsage.ts'
import { cellsOf, encodeClearTopLevel, encodePerVolume } from './gridBuild.ts'
import { VG_PARAMS_STRIDE } from './gridPasses.ts'
import { packMarkParams } from './gridPack.ts'
import {
  clipNearFarDistances,
  frustumGridResolution,
  frustumGridViewToWorld,
  tanHalfFov,
  viewBoundsAndMinimumVoxelSize,
  type GridBounds,
  type GridBuildOptions,
  type GridSettings,
  type GridView,
} from './gridPlan.ts'
import {
  encodeRasterTiles,
  encodeRasterizeVolume,
  gridPools,
  type GridBuildEnvironment,
  type GridSource,
} from './gridRasterize.ts'
import type { RasterGrid } from './rasterPack.ts'
import { VG_ALLOCATOR_WORDS } from './rasterTilesWgsl.ts'

type Vec3 = readonly [number, number, number]

/** The settings the frustum grid's build reads besides the plan's (`gridPlan.ts`): the distances of its near and far planes (a negative one takes
 *  the volumes'), and the memory, in megabytes, its bottom level may take. */
export interface FrustumGridSettings extends GridSettings {
  readonly nearPlaneDistance: number
  readonly farPlaneDistance: number
  readonly bottomLevelMemoryMegabytes: number
}

/** The frustum grid a build leaves: its buffers and the view it is cut in. */
export interface FrustumGrid {
  /** The box of the volumes it was built for. */
  readonly bounds: GridBounds
  readonly resolution: Vec3
  readonly topLevel: GPUBuffer
  readonly extinction: GPUBuffer
  readonly material: GPUBuffer
  readonly near: number
  readonly far: number
  readonly tanHalfFov: number
  readonly viewToWorld: Float64Array
}

/**
 * THE FRUSTUM GRID BUILT (`BuildFrustumVoxelGrid`): the view cut into slices between a near and a far plane, a top-level cell for each block of
 * its bottom level's voxels on the screen and in depth, wide as the shading rate asks. The cells a volume's bounds meet get a bottom level
 * (`markTopLevelGridVoxelsForFrustumGrid`), the volumes are rasterized into them in turn, and a cell whose extinction sums to nothing keeps none. Nothing
 * where no volume meets the view's frustum.
 */
export function encodeFrustumGrid(
  c: GridBuildEnvironment & {
    view: GridView
    sources: readonly GridSource[]
    options: GridBuildOptions
    settings: FrustumGridSettings
    jitter: boolean
    frame: number
  },
): FrustumGrid | undefined {
  const { device, passes, settings, view } = c
  const { bounds, minimumVoxelSize } = viewBoundsAndMinimumVoxelSize(
    view,
    c.sources.map((s) => s.volume),
    c.options,
    settings,
  )
  if (!bounds || !c.sources.length) return undefined
  const clipped = clipNearFarDistances(
    view,
    bounds,
    settings.nearPlaneDistance,
    settings.farPlaneDistance,
  )
  const { resolution, far } = frustumGridResolution(
    view,
    minimumVoxelSize,
    clipped.near,
    clipped.far,
    settings,
  )
  const cells = cellsOf(resolution)
  if (cells === 0) return undefined
  const near = clipped.near
  const fov = tanHalfFov(view.fovDegrees)
  const viewToWorld = frustumGridViewToWorld(view)
  const pools = gridPools({
    cells,
    indirection: false,
    memoryMegabytes: settings.bottomLevelMemoryMegabytes,
    maxBinding: c.maxBinding,
  })
  const topLevel = c.bufferOf('grid frustum top level', cells * 4, STORAGE)
  const extinction = c.bufferOf('grid frustum extinction', pools.bottom * 8, STORAGE)
  const material = c.bufferOf('grid frustum material', pools.bottom * 16, STORAGE)
  const allocators = c.bufferOf('grid frustum allocators', VG_ALLOCATOR_WORDS * 4, STORAGE)
  const shared = { device, encoder: c.encoder, passes }

  encodeClearTopLevel({ ...shared, topLevel, resolution })
  c.encoder.clearBuffer(allocators)
  encodePerVolume({
    ...shared,
    stage: passes.markFrustum,
    topLevel,
    uniform: c.bufferOf('grid frustum marks', c.sources.length * VG_PARAMS_STRIDE, UNIFORM),
    params: c.sources.map((s) =>
      packMarkParams({
        resolution,
        volume: s.volume,
        viewToWorld,
        fovDegrees: view.fovDegrees,
        near,
        far,
        bottomLevelGridResolution: settings.bottomLevelGridResolution,
      }),
    ),
    resolution,
    label: 'Trillion3D heterogeneous volume grid frustum mark',
  })
  const raster = encodeRasterTiles({
    ...c,
    topLevel,
    allocators,
    resolution,
    indirection: false,
    tilePool: pools.tiles,
    role: 'frustum',
  })
  const grid: RasterGrid = {
    kind: 'frustum',
    resolution,
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
    indirection: false,
    bottomResolution: settings.bottomLevelGridResolution,
    viewToWorld,
    tanHalfFov: fov,
    near,
    far,
    pool: pools.bottom,
  }
  const parameters = c.bufferOf(
    'grid frustum raster parameters',
    c.sources.length * VG_PARAMS_STRIDE,
    UNIFORM,
  )
  const noIndirection = c.bufferOf('grid frustum stand-in', 16, STORAGE)
  c.sources.forEach((source, slot) =>
    encodeRasterizeVolume({
      ...c,
      grid,
      source,
      slot,
      parameters,
      topLevel,
      indirectionGrid: noIndirection,
      extinction,
      material,
      allocators,
      raster,
      homogeneousThreshold: undefined,
    }),
  )
  return {
    bounds,
    resolution,
    topLevel,
    extinction,
    material,
    near,
    far,
    tanHalfFov: fov,
    viewToWorld,
  }
}

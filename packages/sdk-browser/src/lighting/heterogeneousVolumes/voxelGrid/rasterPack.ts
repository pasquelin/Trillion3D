import {
  VG_ALLOC_PARAMS_BYTES,
  VG_ARGS_PARAMS_BYTES,
  VG_TILE_PARAMS_BYTES,
} from './rasterTilesWgsl.ts'
import { VG_RASTER_PARAMS_BYTES } from './rasterParamsWgsl.ts'

type Vec3 = readonly [number, number, number]

/** The parameters of the sizing of the ortho grid's bottom level (`VgAllocParams`): the top level's resolution and bounds, whether the grid has
 *  an indirection grid, the bottom level's resolution and the indirection cells the pool holds. */
export function packAllocateParams(c: {
  resolution: Vec3
  indirection: boolean
  boundsMin: Vec3
  boundsMax: Vec3
  maxVoxelResolution: number
  indirectionPool: number
}): ArrayBuffer {
  const out = new ArrayBuffer(VG_ALLOC_PARAMS_BYTES)
  const i = new Int32Array(out)
  const f = new Float32Array(out)
  i.set(c.resolution, 0)
  i[3] = c.indirection ? 1 : 0
  f.set(c.boundsMin, 4)
  i[7] = c.maxVoxelResolution
  f.set(c.boundsMax, 8)
  new Uint32Array(out)[11] = c.indirectionPool
  return out
}

/** The parameters of the raster tiles (`VgTileParams`): the top level's resolution and whether the grid has an indirection grid. */
export function packTileParams(resolution: Vec3, indirection: boolean): ArrayBuffer {
  const out = new ArrayBuffer(VG_TILE_PARAMS_BYTES)
  const i = new Int32Array(out)
  i.set(resolution, 0)
  i[3] = indirection ? 1 : 0
  return out
}

/** The parameters of the indirect arguments (`VgArgsParams`): the most groups a dispatch may have along a dimension and the tiles the pool holds. */
export function packArgsParams(mostGroups: Vec3, poolSize: number): ArrayBuffer {
  const out = new ArrayBuffer(VG_ARGS_PARAMS_BYTES)
  new Uint32Array(out).set([...mostGroups, poolSize], 0)
  return out
}

/** The grid a volume is rasterized into, and what its cells are made of (`VgRasterParams`). */
export interface RasterGrid {
  readonly kind: 'ortho' | 'frustum'
  readonly resolution: Vec3
  /** The ortho grid's world bounds (the frustum grid has none). */
  readonly boundsMin: Vec3
  readonly boundsMax: Vec3
  readonly indirection: boolean
  /** The bottom level's resolution. */
  readonly bottomResolution: number
  /** The frustum grid's view space to the world (column-major), the tangent of half its field of view across, its near and far depths. */
  readonly viewToWorld: ArrayLike<number>
  readonly tanHalfFov: number
  readonly near: number
  readonly far: number
  /** The bottom-level cells the grid's buffers hold. */
  readonly pool: number
}

/** The parameters of the rasterization of one volume (`VgRasterParams`): the grid, the volume's world box, the jitter and the frame (mod 8), the
 *  threshold under which the ortho grid's region is homogeneous (under 0: no aggregation). */
export function packRasterParams(c: {
  grid: RasterGrid
  primitiveMin: Vec3
  primitiveMax: Vec3
  jitter: boolean
  frame: number
  homogeneousThreshold: number
}): ArrayBuffer {
  const { grid } = c
  const out = new ArrayBuffer(VG_RASTER_PARAMS_BYTES)
  const i = new Int32Array(out)
  const f = new Float32Array(out)
  i.set(grid.resolution, 0)
  i[3] = grid.kind === 'ortho' ? 0 : 1
  f.set(grid.boundsMin, 4)
  i[7] = grid.indirection ? 1 : 0
  f.set(grid.boundsMax, 8)
  i[11] = grid.bottomResolution
  f.set(c.primitiveMin, 12)
  i[15] = c.jitter ? 1 : 0
  f.set(c.primitiveMax, 16)
  new Uint32Array(out)[19] = c.frame
  f.set(Array.from(grid.viewToWorld), 20)
  f.set([grid.tanHalfFov, grid.near, grid.far, c.homogeneousThreshold], 36)
  new Uint32Array(out)[40] = grid.pool
  return out
}

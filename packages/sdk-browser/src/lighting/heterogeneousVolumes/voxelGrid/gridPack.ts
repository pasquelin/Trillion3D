import { VG_GRID_PARAMS_BYTES } from './gridEvalWgsl.ts'
import { VG_MARK_PARAMS_BYTES } from './markFrustumGridWgsl.ts'
import { VG_MAJORANT_PARAMS_BYTES } from './majorantWgsl.ts'
import { VG_SIZE_PARAMS_BYTES } from './topLevelVoxelSizeWgsl.ts'
import type {
  GridBounds,
  GridBuildOptions,
  GridSettings,
  GridView,
  GridVolume,
} from './gridPlan.ts'
import { tanHalfFov } from './gridPlan.ts'

type Vec3 = readonly [number, number, number]

/** The bounds of a box as its two corners. */
const cornersOf = (box: GridBounds) => ({
  min: box.origin.map((o, i) => o - box.extent[i]) as unknown as Vec3,
  max: box.origin.map((o, i) => o + box.extent[i]) as unknown as Vec3,
})

/** The parameters of the voxel size pass for one volume (`VgSizeParams`, `topLevelVoxelSizeWgsl.ts`). `planes` are the five outward
 *  planes of the view's frustum in the world (`outwardFrustumPlanes`), `orthographic` whether the view is. */
export function packSizeParams(c: {
  resolution: Vec3
  bounds: GridBounds
  volume: GridVolume
  view: GridView
  planes: Float32Array
  orthographic: boolean
  options: GridBuildOptions
  settings: GridSettings
}): ArrayBuffer {
  const out = new ArrayBuffer(VG_SIZE_PARAMS_BYTES)
  const i = new Int32Array(out)
  const f = new Float32Array(out)
  const grid = cornersOf(c.bounds)
  const primitive = cornersOf(c.volume)
  const { settings: s, options: o, view } = c
  i.set(c.resolution, 0)
  i[3] = o.useProjectedPixelSize ? 1 : 0
  f.set(grid.min, 4)
  f[7] = o.shadingRateInFrustum
  f.set(grid.max, 8)
  f[11] = o.shadingRateOutOfFrustum
  f.set(primitive.min, 12)
  f[15] = Math.max(c.volume.minimumVoxelSize, s.minimumVoxelSizeInFrustum)
  f.set(primitive.max, 16)
  f[19] = s.minimumVoxelSizeOutsideFrustum
  f.set(view.origin, 20)
  f[23] = s.downsampleFactor
  f.set([tanHalfFov(view.fovDegrees), view.width, c.orthographic ? 1 : 0, 0], 24)
  f.set([...view.forward, 0], 28)
  f.set(c.planes, 32)
  return out
}

/** The parameters of the frustum marking pass for one volume (`VgMarkParams`, `markFrustumGridWgsl.ts`); `viewToWorld` is column-major. */
export function packMarkParams(c: {
  resolution: Vec3
  volume: GridVolume
  viewToWorld: ArrayLike<number>
  fovDegrees: number
  near: number
  far: number
  bottomLevelGridResolution: number
}): ArrayBuffer {
  const out = new ArrayBuffer(VG_MARK_PARAMS_BYTES)
  const f = new Float32Array(out)
  const primitive = cornersOf(c.volume)
  f.set(Array.from(c.viewToWorld), 0)
  f.set(primitive.min, 16)
  f[19] = tanHalfFov(c.fovDegrees)
  f.set(primitive.max, 20)
  f[23] = c.near
  new Int32Array(out).set(c.resolution, 24)
  f[27] = c.far
  new Uint32Array(out).set([c.bottomLevelGridResolution], 28)
  return out
}

/** The parameters of the majorant kernels: the top level's resolution, whether the indirection grid is in use, the input grid's resolution. */
export function packMajorantParams(
  resolution: Vec3,
  indirection: boolean,
  inputSize: Vec3,
): ArrayBuffer {
  const out = new ArrayBuffer(VG_MAJORANT_PARAMS_BYTES)
  const i = new Int32Array(out)
  i.set(resolution, 0)
  i[3] = indirection ? 1 : 0
  i.set(inputSize, 4)
  return out
}

/** One of the grids the reads cut a point into: its world bounds and the cells of its top level a side. */
export interface GridExtent {
  readonly min: Vec3
  readonly max: Vec3
  readonly resolution: Vec3
}

/**
 * The parameters of the grid reads (`VgGridParams`, `gridEvalWgsl.ts`): the ortho grid and the frustum grid, each with its flag (a grid that
 * is not built has none and is not read), and, for the frustum grid, the view space it is cut in: `worldToView` column-major, the near and
 * far depths and the tangent of half the field of view across; `cellVoxels` the voxels along a side of a top-level cell of the ortho grid.
 */
export function packGridParams(c: {
  ortho?: GridExtent
  indirection: boolean
  frustum?: GridExtent
  worldToView: ArrayLike<number>
  nearDepth: number
  farDepth: number
  tanHalfFov: number
  cellVoxels: number
}): ArrayBuffer {
  const out = new ArrayBuffer(VG_GRID_PARAMS_BYTES)
  const f = new Float32Array(out)
  const i = new Int32Array(out)
  const zero: GridExtent = { min: [0, 0, 0], max: [0, 0, 0], resolution: [0, 0, 0] }
  const ortho = c.ortho ?? zero
  const frustum = c.frustum ?? zero
  f.set(ortho.min, 0)
  i[3] = c.ortho ? 1 : 0
  f.set(ortho.max, 4)
  i[7] = c.indirection ? 1 : 0
  i.set(ortho.resolution, 8)
  i[11] = c.frustum ? 1 : 0
  f.set(frustum.min, 12)
  f[15] = c.nearDepth
  f.set(frustum.max, 16)
  f[19] = c.farDepth
  i.set(frustum.resolution, 20)
  f[23] = c.tanHalfFov
  f.set(Array.from(c.worldToView), 24)
  i[40] = c.cellVoxels
  return out
}

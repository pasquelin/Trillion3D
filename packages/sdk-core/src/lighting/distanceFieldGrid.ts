import {
  DISTANCE_FIELD_BAND_VOXELS,
  DISTANCE_FIELD_BRICK,
  DISTANCE_FIELD_MAX_INDIRECTION,
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_OBJECT_BORDER,
  DISTANCE_FIELD_UNIQUE_BRICK,
  type DISTANCE_FIELD_RULES,
} from '../contracts/distanceFieldAbi.ts'
import type { SettingValues } from '../contracts/settingRules.ts'
import type { Scene, Vec3 } from './distanceFieldScene.ts'

/**
 * THE GRID OF A MESH'S FIELD AND ITS BRICKS (`asset-compiler-rust/src/distance_field/grid.rs` and `brick.rs`, which this follows step by
 * step): the box at least one unit of half-extent, a texel more for a mesh mostly two-sided; its mip 0 holds
 * `size × density × scale / 7` bricks an axis, rounded and held between 1 and what the resolution allows, each mip half the one before,
 * rounded up; a voxel's border of the volume all round, the band four voxels either side. A brick is 8³ voxels, 7 of them its own.
 */

/** What a field is built with, each the reference's by default (`DISTANCE_FIELD_RULES`). */
export type DistanceFieldBuildSettings = Pick<
  SettingValues<typeof DISTANCE_FIELD_RULES>,
  | 'distanceFieldScale'
  | 'distanceFieldTwoSided'
  | 'distanceFieldDensity'
  | 'distanceFieldMaxResolution'
>

const UNIQUE = DISTANCE_FIELD_UNIQUE_BRICK
const BRICK = DISTANCE_FIELD_BRICK
export const BRICK_VOXELS = BRICK ** 3

/** `value` rounded to the nearest whole number, halves up. */
const round = (value: number) => Math.floor(value + 0.5)
/** `a / b` rounded to the nearest whole number, for `b` positive (integer division as the compiler's). */
const roundNearest = (a: number, b: number) =>
  a > 0 ? Math.trunc((a + Math.trunc(b / 2)) / b) : Math.trunc((a - Math.trunc(b / 2)) / b)

/** The most bricks along an axis at mip 0 the resolution allows: half of it for a scale of at most 1, at least 1. */
function mostBricks(settings: DistanceFieldBuildSettings) {
  const resolution = settings.distanceFieldMaxResolution
  const allowed = settings.distanceFieldScale <= 1 ? Math.floor(resolution / 2) : resolution
  return Math.max(Math.min(roundNearest(allowed, UNIQUE), DISTANCE_FIELD_MAX_INDIRECTION - 1), 1)
}

/** The bricks along each axis at mip 0 of a box of `size`: its voxels at the density the scale gives, in bricks, held between 1 and the most. */
function mip0Bricks(size: Vec3, settings: DistanceFieldBuildSettings) {
  const most = mostBricks(settings)
  const perUnit = settings.distanceFieldDensity * settings.distanceFieldScale
  return size.map((s) => Math.min(Math.max(round((s * perUnit) / UNIQUE), 1), most))
}

/** The box of the field and the placement of each mip. */
export interface MipGrid {
  readonly bricks: Vec3
  readonly low: Vec3
  readonly brickSize: Vec3
  readonly band: number
  readonly traceDistance: number
  readonly toVolume: number
  readonly uvScale: Vec3
  readonly uvAdd: Vec3
}

export function gridOf(
  boxLow: Vec3,
  boxHigh: Vec3,
  settings: DistanceFieldBuildSettings,
  twoSided: boolean,
) {
  const centre = boxLow.map((l, k) => 0.5 * (l + boxHigh[k]))
  const half = boxLow.map((l, k) => Math.max(0.5 * (boxHigh[k] - l), 1))
  let low = centre.map((c, k) => c - half[k]) as Vec3,
    high = centre.map((c, k) => c + half[k]) as Vec3
  if (twoSided) {
    const bricks = mip0Bricks(high.map((h, k) => h - low[k]) as Vec3, settings)
    const texel = bricks.map((b, k) => (high[k] - low[k]) / (b * UNIQUE))
    ;[low, high] = [
      low.map((l, k) => l - texel[k]) as Vec3,
      high.map((h, k) => h + texel[k]) as Vec3,
    ]
  }
  const halfMax = Math.max(...high.map((h, k) => 0.5 * (h - low[k])))
  const toVolume = 1 / halfMax
  const bricks0 = mip0Bricks(high.map((h, k) => h - low[k]) as Vec3, settings)
  const mip = (index: number): MipGrid => {
    const bricks = bricks0.map((b) => Math.ceil(b / 2 ** index)) as Vec3
    const voxels = bricks.map((b) => b * UNIQUE)
    const border = 2 * DISTANCE_FIELD_OBJECT_BORDER
    const texel = voxels.map((v, k) => (high[k] - low[k]) / (v - border))
    const mipLow = low.map((l, k) => l - texel[k]) as Vec3
    const mipHigh = high.map((h, k) => h + texel[k])
    const brickSize = bricks.map((b, k) => (mipHigh[k] - mipLow[k]) / b) as Vec3
    const voxelVolume = brickSize.map((s) => (s * toVolume) / UNIQUE)
    const band =
      DISTANCE_FIELD_BAND_VOXELS * Math.sqrt(voxelVolume.reduce((sum, v) => sum + v * v, 0))
    const extent = high.map((h, k) => 0.5 * (h - low[k]) * toVolume)
    const uvMin = voxels.map((v) => DISTANCE_FIELD_OBJECT_BORDER / v)
    const uvSize = voxels.map((v) => (v - border) / v)
    const uvScale = uvSize.map((s, k) => s / (2 * extent[k])) as Vec3
    return {
      bricks,
      low: mipLow,
      brickSize,
      band,
      traceDistance: band / toVolume,
      toVolume,
      uvScale,
      uvAdd: extent.map((e, k) => e * uvScale[k] + uvMin[k]) as Vec3,
    }
  }
  return { low, high, mips: Array.from({ length: DISTANCE_FIELD_MIPS }, (_, index) => mip(index)) }
}

/** The byte of a signed `distance` (centimetres) held to the band of `mip`. */
export function quantise(mip: MipGrid, distance: number) {
  const scale = 2 * mip.band,
    bias = -mip.band
  const rescaled = (distance * mip.toVolume - bias) / scale
  return Math.min(Math.max(Math.floor(rescaled * 255 + 0.5), 0), 255)
}

/** The box the bricks of `mip` span: its low corner and its high one. */
export const volumeOf = (mip: MipGrid): [Vec3, Vec3] => [
  mip.low,
  mip.low.map((l, k) => l + mip.brickSize[k] * mip.bricks[k]) as Vec3,
]

/** The cell, `x` fastest, of rank `rank` in a grid of `bricks`. */
export const cellOf = (rank: number, bricks: Vec3): Vec3 => [
  rank % bricks[0],
  Math.floor(rank / bricks[0]) % bricks[1],
  Math.floor(rank / (bricks[0] * bricks[1])),
]

/** Where the voxels of one brick lie: its corner and the step between voxels. */
export interface Frame {
  readonly corner: Vec3
  readonly voxel: Vec3
}

/** The frame of the brick at cell `at` of `mip`. */
export const frameOf = (mip: MipGrid, at: Vec3): Frame => ({
  corner: mip.low.map((l, k) => l + at[k] * mip.brickSize[k]) as Vec3,
  voxel: mip.brickSize.map((s) => s / UNIQUE) as Vec3,
})

/** The position of the brick's voxel of rank `index`, `x` fastest, then `y`, then `z`, written to `out`. */
export function voxelAt({ corner, voxel }: Frame, index: number, out: Vec3) {
  out[0] = (index % BRICK) * voxel[0] + corner[0]
  out[1] = (Math.floor(index / BRICK) % BRICK) * voxel[1] + corner[1]
  out[2] = Math.floor(index / (BRICK * BRICK)) * voxel[2] + corner[2]
  return out
}

/** Whether a triangle of `scene` lies where a voxel of the brick can find one: within the trace distance and the voxels' half diagonal of
 *  their centre, a billionth more. A brick none reaches is the band's far end all through, its voxels not measured one by one. */
export function reached(scene: Scene, mip: MipGrid, { corner, voxel }: Frame) {
  const last = BRICK - 1
  const halfDiagonal = 0.5 * last * Math.hypot(...voxel)
  return (
    scene.nearest(
      corner[0] + 0.5 * last * voxel[0],
      corner[1] + 0.5 * last * voxel[1],
      corner[2] + 0.5 * last * voxel[2],
      (mip.traceDistance + halfDiagonal) * (1 + 1e-9),
    ) >= 0
  )
}

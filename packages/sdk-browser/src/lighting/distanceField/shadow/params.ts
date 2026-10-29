import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { largestAxisScale } from '../../../../../math/src/vector/vector.ts'
import { writeSplitDouble } from '../../../../../math/src/float/splitDouble.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../sdk-core/src/page/format.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import type { VolumeBounds } from './bounds.ts'
import {
  DFSH_CUBE_VERTICES,
  DFSH_FLAG,
  DFSH_MAX_CONE_RADIUS,
  DFSH_MIN_DEPTH_RANGE,
  DFSH_MIN_SNAP_RESOLUTION,
  DFSH_PARAMS,
  DFSH_PARAMS_STRIDE,
  DFSH_SNAP_BORDER,
  DFSH_SNAP_STEP_TEXELS,
  DFSH_STEPS,
  shadowTileSide,
} from './layout.ts'

/** The settings of the suns' mesh lists (`SUN_SHADOW_RULES`): the steps of a ray (the quality, 1 to 3), the side of a
 *  tile (metres), the factor on a two-sided mesh's bias, the meshes a tile has room for, whether the tiles' lists
 *  lie one after the other, and the texels across the shadow space whose grid its origin snaps to (`snapTexelsOf`). */
export interface DfshSettings {
  quality: number
  tileSize: number
  twoSidedBias: number
  perTile: number
  compactTiles: boolean
  snapTexels: number
}

/** The texels across the shadow space the origin snaps to, for a map of `resolution` texels on a
 *  device whose textures go to `limit`: the resolution held between the least and the limit, less the
 *  border of each side. */
export const snapTexelsOf = (resolution: number, limit: number) =>
  clamp(resolution, DFSH_MIN_SNAP_RESOLUTION, limit) - 2 * DFSH_SNAP_BORDER

/** What the scene gives a sun's pass: the meshes in it. */
interface DfshScene {
  objects: number
}

/** The tiles along a side of the grid the meshes of a volume of bounds `bounds` are listed in. */
export const tilesOf = (bounds: VolumeBounds, settings: Pick<DfshSettings, 'tileSize'>) =>
  shadowTileSide(bounds.radius, settings.tileSize * CM)

/**
 * Writes the matrix that takes a position from the eye to the shadow space: the light's
 * right and up over the sphere's rounded radius, then the distance toward the light, from `range`
 * short of the origin on the far side over twice `range`. The origin is the sphere's centre moved
 * along the light's right and up to a grid fixed in the world — a step of `DFSH_SNAP_STEP_TEXELS`
 * texels of a map of `snapTexels` across the space, a space of width 2 —, so that the tile grid does
 * not slide with the camera; `range` is the radius, at least `DFSH_MIN_DEPTH_RANGE`, so that the
 * space reaches the meshes toward the light.
 */
function putToShadow(
  out: Float32Array,
  at: number,
  input: { bounds: VolumeBounds; toLight: readonly number[]; eye: ArrayLike<number> },
  snapTexels: number,
) {
  const { bounds: b, toLight, eye } = input
  const scale = b.roundedRadius
  const range = Math.max(scale, DFSH_MIN_DEPTH_RANGE)
  const step = (2 * DFSH_SNAP_STEP_TEXELS) / snapTexels
  const origin = [b.centre[0], b.centre[1], b.centre[2]]
  for (const axis of [b.right, b.up]) {
    // The centre's place along the axis in the world (the eye is metres), in the space's width.
    let along = 0
    for (let k = 0; k < 3; k++) along += axis[k] * (eye[k] * CM + b.centre[k])
    const snap = (along / scale) % step
    for (let k = 0; k < 3; k++) origin[k] -= snap * scale * axis[k]
  }
  const axes = [b.right, b.up, toLight]
  for (let r = 0; r < 3; r++) {
    const axis = axes[r]
    const width = r === 2 ? 2 * range : scale
    for (let c = 0; c < 3; c++) out[at + c * 4 + r] = axis[c] / width
    const shift = axis[0] * origin[0] + axis[1] * origin[1] + axis[2] * origin[2]
    out[at + 12 + r] = ((r === 2 ? range : 0) - shift) / width
  }
  out[at + 15] = 1
}

/**
 * Writes the uniform of sun number `index` of the frame (`DFSH_PARAMS`) into `floats` and `words`,
 * two views of the same buffer, at its stride: everything the passes of its lists read of the
 * settings, the eye, the scene and the sun's direction. `bounds` are the volume's (`boxBounds`).
 */
export function writeDfshParams(
  floats: Float32Array,
  words: Uint32Array,
  index: number,
  input: {
    eye: ArrayLike<number>
    toLight: readonly [number, number, number]
    bounds: VolumeBounds
  },
  settings: DfshSettings,
  scene: DfshScene,
) {
  const { eye, toLight, bounds } = input
  const base = (index * DFSH_PARAMS_STRIDE) / 4
  const at = DFSH_PARAMS.at
  putToShadow(floats, base + at.toShadow, { bounds, toLight, eye }, settings.snapTexels)
  floats.set(bounds.planes, base + at.planes)
  for (let k = 0; k < 3; k++) {
    writeSplitDouble(floats, base + at.eyeHigh + k, base + at.eyeLow + k, eye[k] * CM)
  }
  putVec4(floats, base + at.light, ...toLight, 0)
  putVec4(floats, base + at.trace, 0, 0, DFSH_STEPS[clamp(Math.trunc(settings.quality), 1, 3)], 0)
  putVec4(floats, base + at.range, 0, 0, settings.twoSidedBias, 0)
  const side = tilesOf(bounds, settings)
  putVec4(
    floats,
    base + at.expand,
    (1.414 * bounds.radius) / side,
    DFSH_MAX_CONE_RADIUS * largestAxisScale(floats, base + at.toShadow),
  )
  words.set([0, 0, 0, 0], base + at.lists)
  const room = settings.perTile * side * side
  words.set([side, room, scene.objects, settings.perTile], base + at.tiles)
  const flags = settings.compactTiles ? DFSH_FLAG.compactTiles : 0
  words.set([bounds.planeCount, DFSH_CUBE_VERTICES, 0, flags], base + at.counts)
}

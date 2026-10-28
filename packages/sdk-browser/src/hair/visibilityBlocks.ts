import {
  HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT,
  HAIR_STRANDS_FLAG_SCATTER,
  HAIR_STRANDS_FLAG_SCATTER_SET,
  HAIR_STRANDS_FLAG_STABLE,
  HAIR_STRANDS_FLAG_STABLE_SET,
} from '../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import type { wordViews } from '../gpu/core/wordViews.ts'
import { HAIR_DEFAULT_MATERIAL, HAIR_FLAG } from './materialMath.ts'
import type { HairInstance } from './scene.ts'
import { hairGroupFlags } from './groupFlags.ts'

/** The words of a block, read three ways (`wordViews`). */
type Words = ReturnType<typeof wordViews>

/** The least radius of a strand at a distance of 1: for the visibility's samples, for the
 *  transmittance's one, and each of them for a groom drawn stable. */
export type HairRadii = readonly [number, number, number, number]

/**
 * Writes a view block (`HAIR_VIEW_WGSL`): `viewProjection` (column-major, the eye at the origin, with
 * the jitter of the image), `forward` and whether the projection is orthographic, the least radii
 * (`radii`), the image's `width` by `height`, whether the samples of a pixel are `sorted` by depth, and
 * `inverse`, the inverse of the view-projection.
 */
export function writeHairViewBlock(
  words: Words,
  viewProjection: ArrayLike<number>,
  inverse: ArrayLike<number>,
  forward: ArrayLike<number>,
  ortho: boolean,
  radii: HairRadii,
  width: number,
  height: number,
  sorted: boolean,
) {
  const { f } = words
  for (let i = 0; i < 16; i++) f[i] = viewProjection[i]!
  f[16] = forward[0]!
  f[17] = forward[1]!
  f[18] = forward[2]!
  f[19] = ortho ? 1 : 0
  for (let k = 0; k < 4; k++) f[20 + k] = radii[k]!
  f[24] = width
  f[25] = height
  f[26] = sorted ? 1 : 0
  f[27] = 0
  for (let i = 0; i < 16; i++) f[28 + i] = inverse[i]!
}

/**
 * Writes an instance block (`HAIR_RIBBON_WGSL`'s `Instance`): the group's space to the world seen from
 * `eye`, the three axes of that space as unit directions (a tangent turns by them, whatever the
 * scale), the position offset and the radius, the material of the instance, its point count and
 * whether its group was built for strips; then what the material pass reads: the default strand
 * material's colour and roughness, its specular and backlit share, the flags of the strands (`flags`,
 * `HAIR_FLAG`, the project's with the group's own settings over them, `hairGroupFlags`), a word no pass reads, its object's lighting channels and the macro group it lies in.
 */
export function writeHairInstanceBlock(
  words: Words,
  instance: HairInstance,
  eye: ArrayLike<number>,
  material: number,
  macroGroup: number,
  flags: number,
) {
  const { f, u } = words
  const m = instance.localToWorld
  for (let i = 0; i < 12; i++) f[i] = m[i]!
  for (let axis = 0; axis < 3; axis++) f[12 + axis] = m[12 + axis]! - eye[axis]!
  f[15] = 1
  for (let axis = 0; axis < 3; axis++) {
    const x = m[axis * 4]!,
      y = m[axis * 4 + 1]!,
      z = m[axis * 4 + 2]!
    const length = Math.hypot(x, y, z) || 1
    f[16 + axis * 4] = x / length
    f[17 + axis * 4] = y / length
    f[18 + axis * 4] = z / length
    f[19 + axis * 4] = 0
  }
  const { group } = instance
  f[28] = group.positionOffset[0]
  f[29] = group.positionOffset[1]
  f[30] = group.positionOffset[2]
  f[31] = instance.radius
  u[32] = material
  u[33] = group.pointCount
  u[34] = (group.flags & HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT) !== 0 ? 1 : 0
  u[35] = 0
  const base = HAIR_DEFAULT_MATERIAL.color
  f[36] = base[0]
  f[37] = base[1]
  f[38] = base[2]
  f[39] = HAIR_DEFAULT_MATERIAL.roughness
  f[40] = HAIR_DEFAULT_MATERIAL.specular
  f[41] = HAIR_DEFAULT_MATERIAL.backlit
  f[42] = 0
  f[43] = 0
  u[44] = hairGroupFlags(group.flags, flags)
  u[45] = 0
  u[46] = HAIR_DEFAULT_MATERIAL.lightChannels
  u[47] = macroGroup
}

/** The flags every strand of an image carries (`HAIR_FLAG`), from the settings: whether the strands
 *  light the scene behind them, are drawn stable and cast contact shadows. */
export const hairFlagsOf = (
  scatterSceneLight: boolean,
  stableRaster: boolean,
  castContactShadow: boolean,
) =>
  (scatterSceneLight ? HAIR_FLAG.scatterSceneLight : 0) |
  (stableRaster ? HAIR_FLAG.stableRaster : 0) |
  (castContactShadow ? HAIR_FLAG.castContactShadow : 0)

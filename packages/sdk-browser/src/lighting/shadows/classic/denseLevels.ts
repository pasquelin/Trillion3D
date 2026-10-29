import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { VSM_LEVEL0_TEXELS, VSM_MIPS } from '../vsm/constants.ts'

/** The clipmap level (its index from the first) whose texels are the nearest at or above those a cascade bounded by a sphere of `radius` centimetres gets at `resolution` texels. */
export function sunLevelIndex(
  radius: number,
  resolution: number,
  firstLevel: number,
  levelCount: number,
) {
  // A level of absolute number `a` spans 2^(a+2) centimetres over the map's texels.
  const absolute = Math.ceil(
    Math.log2((radius * (VSM_LEVEL0_TEXELS / 2)) / Math.max(resolution, 1)),
  )
  return clamp(absolute - firstLevel, 0, Math.max(levelCount - 1, 0))
}

/** The mip of a map whose texels a side are the nearest at or under `resolution`, 0 to the last. */
export const localMip = (resolution: number) =>
  clamp(Math.ceil(Math.log2(VSM_LEVEL0_TEXELS / Math.max(resolution, 1))), 0, VSM_MIPS - 1)

import { HIZ_MAX_LEVELS } from './uniforms.ts'
import { HIZ_LEVELS, HIZ_NEAREST, HIZ_WHOLE_FARTHEST, hizRoute } from './pyramidTexture.ts'

/** The word of the levels uniform that says this image wrote level 0's front layer. */
export const HIZ_LEVELS_FRONT_WORD = HIZ_LEVELS.at.count + 1

/** The word of the levels uniform that says the nearest layer holds the planes' corners
 *  (`hizTrace` `'planes'`), not the closest centre depth. */
export const HIZ_LEVELS_PLANES_WORD = HIZ_LEVELS.at.count + 3

/** The levels uniform of a pyramid of `sizes` at `offsets` (`pyramidBytes`), its first
 *  `HIZ_MAX_LEVELS` built (`HizLevels`): per level the first index of its nearest bound, its
 *  width and height, and the first index of its finished depth's farthest bound (`hizRoute`);
 *  then the count of levels, whether this image wrote level 0's front layer
 *  (`HIZ_LEVELS_FRONT_WORD`, `HIZ_FOLD_WGSL`), and `upper`, by which a coarser level's bounds of
 *  two layers lie apart: the culling layer's lies one `upper` before the nearest's (`hizMip`);
 *  the fourth word, the planes word (`HIZ_LEVELS_PLANES_WORD`), is left to the host. */
export function hizLevelWords(
  sizes: Array<[number, number]>,
  offsets: number[],
  layout: { first: number; upper: number },
) {
  const words = new Uint32Array(HIZ_LEVELS.words)
  const count = Math.min(sizes.length, HIZ_MAX_LEVELS)
  for (let level = 0; level < count; level++)
    words.set(
      [
        hizRoute(offsets[level], level, HIZ_NEAREST, layout),
        ...sizes[level],
        hizRoute(offsets[level], level, HIZ_WHOLE_FARTHEST, layout),
      ],
      level * 4,
    )
  words[HIZ_LEVELS.at.count] = count
  words[HIZ_LEVELS.at.count + 2] = layout.upper
  return words
}

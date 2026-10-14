import { HIZ_MAX_LEVELS } from './uniforms.ts'
import { HIZ_NEAREST, HIZ_WHOLE_FARTHEST, hizRoute } from './pyramidTexture.ts'

/** Words of the levels uniform (`HizLevels`): per level the first index of its nearest bound, its
 *  width and height, and the first index of its finished depth's farthest bound (`hizRoute`);
 *  then the count of levels, and whether this image wrote level 0's front layer
 *  (`HIZ_LEVELS_FRONT_WORD`, `HIZ_FOLD_WGSL`). */
export const HIZ_LEVELS_WORDS = HIZ_MAX_LEVELS * 4 + 4
/** The word of the levels uniform that says this image wrote level 0's front layer. */
export const HIZ_LEVELS_FRONT_WORD = HIZ_MAX_LEVELS * 4 + 1

/** The levels uniform of a pyramid of `sizes` at `offsets` (`pyramidBytes`), its first
 *  `HIZ_MAX_LEVELS` built. */
export function hizLevelWords(
  sizes: Array<[number, number]>,
  offsets: number[],
  layout: { first: number; upper: number },
) {
  const words = new Uint32Array(HIZ_LEVELS_WORDS)
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
  words[HIZ_MAX_LEVELS * 4] = count
  return words
}

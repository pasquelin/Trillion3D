/**
 * THE REFLECTIONS' LEVELS: the values each quality level holds (`REFLECTION_LEVEL_KNOBS`), apart from the settings
 * that read them (`./reflectionOptions.ts`). The levels are the reference's own scalability rows of its reflections:
 * the two lowest allow none, the third traces one ray in a block of two pixels a side, reads three of the rays
 * around a pixel, filters at least a little and traces no ray for the transparents' front layer, the top one traces a
 * ray a pixel, reads five and filters only where a ray found nothing and allows that front layer to be traced where the
 * project asks for it (`reflectionFrontLayer`); the cinematic row holds the top one's values and traces it itself.
 */

/** The levels, `'off'` first, then from the coarsest to the finest. */
export const REFLECTION_LEVELS = ['off', 'high', 'ultra', 'cinematic'] as const
/** A level of the reflections. */
export type ReflectionLevel = (typeof REFLECTION_LEVELS)[number]
/** The level of a view that names none: the reference's default row, a ray every pixel. */
export const DEFAULT_REFLECTION_LEVEL = 'ultra' satisfies ReflectionLevel

/** What a level that traces holds. */
export type ReflectionKnobs = {
  /** The side, in pixels, of the blocks of pixels that trace one ray each image. */
  downsample: number
  /** The neighbours' rays the reconstruction reads of a pixel at most. */
  reconstructionSamples: number
  /** The least share of the pixel's own weight the neighbours' rays weigh together, a filter where none is good. */
  reconstructionMinWeight: number
  /** Whether the level allows the transparents' front layer to be traced at all, and whether it traces it whatever the
   *  project says: the layer is traced where it is allowed and either the level or the project's setting
   *  (`reflectionFrontLayer`) asks for it. */
  frontLayerAllowed: boolean
  frontLayerTraced: boolean
}

/** The values of each level that traces. */
export const REFLECTION_LEVEL_KNOBS: Readonly<
  Record<Exclude<ReflectionLevel, 'off'>, ReflectionKnobs>
> = {
  high: {
    downsample: 2,
    reconstructionSamples: 3,
    reconstructionMinWeight: 1,
    frontLayerAllowed: false,
    frontLayerTraced: false,
  },
  ultra: {
    downsample: 1,
    reconstructionSamples: 5,
    reconstructionMinWeight: 0,
    frontLayerAllowed: true,
    frontLayerTraced: false,
  },
  cinematic: {
    downsample: 1,
    reconstructionSamples: 5,
    reconstructionMinWeight: 0,
    frontLayerAllowed: true,
    frontLayerTraced: true,
  },
}

/** What each quality preset below the top writes of the level, the reference's own scalability rows: the two lowest
 *  allow no reflection, the third is `high` (`runtime/qualityLevels.ts`); `max` writes nothing, the default `ultra`;
 *  `cinematic` is the level of its own name, the reference's fifth row. */
export const REFLECTION_PRESET_LEVELS = {
  smooth: { reflectionQuality: 'off' },
  balanced: { reflectionQuality: 'off' },
  fine: { reflectionQuality: 'high' },
  cinematic: { reflectionQuality: 'cinematic' },
} as const

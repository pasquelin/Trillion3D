import {
  ANY_NUMBER,
  choiceSetting as choice,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * How the bloom of a view is drawn (`./bloomOptions.ts` says what it is and the effect's own
 * settings): the quality, the cross, the resolution of the convolution and two switches. Run-time
 * settings, as `./settingRules.ts` says, of the world's registry (`BLOOM_RULES`) — what the effect
 * holds is what a volume of the picture holds, these are the view's —, a quality preset writing the
 * quality and the convolution's resolution.
 */

/** The quality levels, `off` first, then coarsest to finest: each names how many of the six
 *  Gaussian levels draw (`BLOOM_QUALITY_LEVELS`). */
const BLOOM_QUALITY_LEVELS = ['off', 'lowest', 'low', 'medium', 'high', 'highest'] as const
/** A quality level of the bloom. */
export type BloomQualityLevel = (typeof BLOOM_QUALITY_LEVELS)[number]

/** How many Gaussian levels draw, by level, the widest first: the reference's own, 3, 3, 4, 5 and 6.
 *  The tint of a level is the same at every quality, so a lower quality carries less of the glow. */
export const BLOOM_QUALITY_STAGES: Readonly<Record<Exclude<BloomQualityLevel, 'off'>, number>> = {
  lowest: 3,
  low: 3,
  medium: 4,
  high: 5,
  highest: 6,
}

/**
 * The settings of how the bloom is drawn, by field, each with the reference's default:
 * - `bloomQuality` (`'highest'`): the level — `'off'` draws no bloom of either method, `'lowest'`
 *   and `'low'` the three widest Gaussian levels, `'medium'` four, `'high'` five, `'highest'` all
 *   six; `false` is `'off'`, `true` the default;
 * - `bloomCross` (0): a bright centre given to the Gaussian blur, a pass keeping this share of its
 *   centre texel instead of blurring it (from 0 to 1 the rest is the bell, from 1 on the pass
 *   blurs nothing, and the level's own enlargement shows): above 0 both passes do, a cross of
 *   light with arms along both axes; below 0 only the vertical pass does, by the absolute value, a
 *   streak along the horizontal; 0 is the plain blur;
 * - `bloomScreenPercentage` (50): the resolution the convolution runs at, in percent of the
 *   image's width, from 10 to 100 (a value outside is read as the nearer end); lower is much
 *   cheaper and softer, 100 the cinematic setting;
 * - `bloomApplyLocalExposure` (on): whether the local exposure is applied to the image the bloom
 *   reads, so what glows is what the image will show;
 * - `bloomCacheKernel` (on): whether the convolution keeps the transform of its kernel while the
 *   kernel, its size and the image's size hold; off, it is made again at every image.
 */
export const BLOOM_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('bloomQuality', 'highest', BLOOM_QUALITY_LEVELS),
    number('bloomCross', 0, ANY_NUMBER),
    nonNegative('bloomScreenPercentage', 50),
    flag('bloomApplyLocalExposure', true),
    flag('bloomCacheKernel', true),
  ] as const))()
/** The field of one setting of how the bloom is drawn. */
export type BloomField = keyof typeof BLOOM_RULES
/** The settings of how the bloom is drawn as a host writes them, by their fields: each its value,
 *  or nothing for its default. */
export type BloomSettings = SettingOptions<typeof BLOOM_RULES>
/** The settings of how the bloom is drawn as the engine reads them: every field set. */
export type BloomValues = SettingValues<typeof BLOOM_RULES>

/** What each quality level below the top writes of the quality and the convolution's resolution, the
 *  reference's own scalability rows: five Gaussian levels and the convolution at 25 % of the image's
 *  width at `smooth`, five and 35.355 % at `balanced`, all six and 50 % at `fine`; `max` writes
 *  nothing: six levels and half the width, the defaults, which are its row (`runtime/qualityLevels.ts`);
 *  `cinematic` all six and the whole width, the reference's last row. The blur's own settings are
 *  the Gaussian blur's (`./gaussianBlurRules.ts`). */
export const BLOOM_PRESET_LEVELS = {
  smooth: { bloomQuality: 'high', bloomScreenPercentage: 25 },
  balanced: { bloomQuality: 'high', bloomScreenPercentage: 35.355 },
  fine: { bloomQuality: 'highest', bloomScreenPercentage: 50 },
  cinematic: { bloomQuality: 'highest', bloomScreenPercentage: 100 },
} as const

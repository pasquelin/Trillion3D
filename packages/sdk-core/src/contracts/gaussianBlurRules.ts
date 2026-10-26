import {
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * How the Gaussian blur is drawn, wherever the engine blurs with one: the bloom's six levels and the
 * local exposure's blurred luminance. Run-time settings, as `./settingRules.ts` says, of the world's
 * registry (`GAUSSIAN_BLUR_RULES`) — the view's, not an effect's —, a quality preset writing two of
 * them.
 */

/**
 * The settings of how the blur is drawn, by field, each with the reference's default:
 * - `gaussianFastBlurThreshold` (100): the radius, in texels, from which a blur writes its first
 *   pass at half the width, the second pass reading it bilinearly — a cheaper pass of a blur a
 *   little softer along x, which shows more the narrower the blur; 0 halves every blur, a radius
 *   under the threshold none; at 100 no blur of a 1080p image is halved;
 * - `gaussianSampleScale` (1): the reach of the kernel as a multiple of its radius, from 0.1 to 10
 *   (a value outside is read as the nearer end): the weights are those of the radius, so a scale
 *   under 1 cuts the kernel short — fewer reads, cheaper, with artefacts on bright light — and over
 *   1 reads further out;
 * - `gaussianLoopMode` (0): the most reads of a pass — 0 limits it to 32 (a kernel of 63 texels at
 *   most), 1 and 2 raise it to 128. The reference runs the reads of mode 0 unrolled, those of 2 by a
 *   loop with a stop test and those of 1 either way by their count; here every pass is one loop
 *   over the reads its uniform holds, so 1 and 2 are the same.
 */
export const GAUSSIAN_BLUR_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('gaussianFastBlurThreshold', 100),
    nonNegative('gaussianSampleScale', 1),
    integer('gaussianLoopMode', 0, [0, 2]),
  ] as const))()
/** The field of one setting of how the Gaussian blur is drawn. */
export type GaussianBlurField = keyof typeof GAUSSIAN_BLUR_RULES
/** The settings of how the blur is drawn as a host writes them, by their fields: each its value, or
 *  nothing for its default. */
export type GaussianBlurSettings = SettingOptions<typeof GAUSSIAN_BLUR_RULES>
/** The settings of how the blur is drawn as the engine reads them: every field set. */
export type GaussianBlurValues = SettingValues<typeof GAUSSIAN_BLUR_RULES>

/** What each quality level below the top writes of the blur, the reference's own scalability rows:
 *  every blur halved from a radius of 0 and the reach at 0.6 of the radius at `smooth`, 2 and 0.7 at
 *  `balanced`, 3 and 0.8 at `fine`; `max` writes nothing: the defaults are its row
 *  (`runtime/qualityLevels.ts`); `cinematic` the reference's last row, a radius of 100 and the
 *  whole reach. */
export const GAUSSIAN_BLUR_PRESET_LEVELS = {
  smooth: { gaussianFastBlurThreshold: 0, gaussianSampleScale: 0.6 },
  balanced: { gaussianFastBlurThreshold: 2, gaussianSampleScale: 0.7 },
  fine: { gaussianFastBlurThreshold: 3, gaussianSampleScale: 0.8 },
  cinematic: { gaussianFastBlurThreshold: 100, gaussianSampleScale: 1 },
} as const

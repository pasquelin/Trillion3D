import {
  atLeast,
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  countSetting as count,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * HOW THE DEPTH OF FIELD IS DRAWN (`./depthOfFieldOptions.ts` says what it is and what its pass holds):
 * run-time settings, as `./settingRules.ts` says, of the world's registry (`DEPTH_OF_FIELD_RULES`),
 * each with the default of the reference's quality level the reference is compared at (the fourth
 * of its five post-process levels), a quality preset writing the ones the reference's own levels
 * write (`DEPTH_OF_FIELD_PRESET_LEVELS`).
 *
 * The draw, per image: each pixel's circle of confusion is set up at the gather's resolution; the
 * image is reduced to tiles of 8 × 8 texels that know the smallest and largest circle of their texels,
 * dilated by the largest circle; a chain of mip levels of the setup is reduced; each layer — the
 * foreground, the foreground's hole filling, what is slightly out of focus, the background — is
 * gathered by a kernel of `depthOfFieldRingCount` rings over that chain, post-filtered, and the
 * brightest large circles are scattered instead as sprites, which the gather would only make
 * noisy; a last pass recombines the layers with the full-size image.
 */

/** The quality levels: `off` draws no depth of field, `on` draws it. The reference reads its quality
 *  level as on or off alone (above 0) for this method — what differs between its levels are the
 *  settings each level writes (`DEPTH_OF_FIELD_PRESET_LEVELS`) —, so the level is no more than the switch. */
export const DEPTH_OF_FIELD_LEVELS = ['off', 'on'] as const

/** The accumulators of the gather, coarsest first: the cheaper one that gathers the rings as they are,
 *  the one that sorts the samples by their depth, and that one gathering the background in layers. */
const DEPTH_OF_FIELD_ACCUMULATORS = ['low', 'high', 'cinematic'] as const
/** The post-filters of a gather: none, the median or the maximum of each channel over 3 × 3 texels. */
export const DEPTH_OF_FIELD_POSTFILTERS = ['none', 'median', 'max'] as const
/** How the bright highlights of the foreground are scattered: not at all, or added over the gather. */
const DEPTH_OF_FIELD_FOREGROUND_SCATTERS = ['off', 'additive'] as const
/** How those of the background are: not at all, added over the gather, or added and occluding the
 *  gather behind them (the one that asks the gather to output its own occlusion). */
const DEPTH_OF_FIELD_BACKGROUND_SCATTERS = ['off', 'additive', 'occlusion'] as const
/** The quality of the recombine's slight out of focus: none, 12 pairs of samples at the full size,
 *  or 16. */
export const DEPTH_OF_FIELD_RECOMBINES = ['off', 'low', 'high'] as const
/** The quality of the temporal accumulation of the setup: both read the history bicubically, bound it by
 *  the neighbourhood and filter the image's samples by a window the size of the jitter's pixels; the
 *  stable one also works in a luma-chroma space, which keeps the colours of the box together. */
const DEPTH_OF_FIELD_TEMPORALS = ['low', 'high'] as const

/**
 * The settings of how the depth of field is drawn, by field, each with the default of the
 * reference's third quality level (the one its images are compared at):
 * - `depthOfFieldQuality` (`'on'`): `'off'` draws no depth of field (`DEPTH_OF_FIELD_LEVELS`);
 * - `depthOfFieldGatherDivisor` (2): the gather runs at the image's size divided by this, 1 or 2;
 * - `depthOfFieldAccumulator` (`'high'`): which accumulator the gather uses;
 * - `depthOfFieldDistinctionLimit` (0): a bright, large circle that is not scattered but exceeds this
 *   product of its radius and its perceived brightness is dropped from the gather, which lowers
 *   its noise and darkens the bokeh; 0 is off;
 * - `depthOfFieldGatherBokeh` (off): whether the gather draws the shape of the diaphragm's blades;
 * - `depthOfFieldPostfilter` (`'median'`): the filter each gather is cleaned by;
 * - `depthOfFieldRingCount` (4): rings of the gather's kernel, 3 to 5 — 1 + 4 · rings · (rings + 1)
 *   samples;
 * - `depthOfFieldMaxMips` (4): the most mip levels of the setup the gather reads, which lowers the
 *   noise of a wide, sparse kernel;
 * - `depthOfFieldForegroundScatter` (`'additive'`), `depthOfFieldBackgroundScatter`
 *   (`'occlusion'`): how the highlights are scattered, per layer;
 * - `depthOfFieldScatterBokeh` (on): whether scattered sprites take the diaphragm's shape;
 * - `depthOfFieldScatterMinRadius` (3): the smallest circle radius scattered, in pixels at the gather's
 *   size, 3 at least;
 * - `depthOfFieldScatterMaxRatio` (0.1): the most pixel quads scattered, as a share of them all;
 * - `depthOfFieldScatterNeighborColor` (10): the linear colour a pixel must exceed over its neighbours
 *   that are already scattered to be scattered too;
 * - `depthOfFieldRecombine` (`'low'`): the recombine's slight out of focus, whose samples are taken at
 *   the full size; `'off'` has none;
 * - `depthOfFieldRecombineBokeh` (off): whether that slight out of focus takes the diaphragm's shape;
 * - `depthOfFieldRecombineMinBlur` (0.1): the smallest blur, in full-size pixels, the recombine
 *   draws when it does its slight out of focus;
 * - `depthOfFieldMaxForegroundRadius`, `depthOfFieldMaxBackgroundRadius` (0.025): the largest circle
 *   radius, in shares of the image's width;
 * - `depthOfFieldSlightFocusRejection` (0): widens the range the recombine's slight out of focus is
 *   held to, a share of it, 0 to 0.125;
 * - `depthOfFieldTemporalQuality` (`'high'`), `depthOfFieldBilateralStrength` (0) and
 *   `depthOfFieldTemporalCurrentWeight` (0.04): the temporal accumulation of the setup the pass runs
 *   before the image's own (`DEPTH_OF_FIELD_TEMPORALS`) — where the image is temporally accumulated —,
 *   how far a circle of confusion that differs from the history's rejects it, 0 to 1, and the weight of
 *   the image in the history.
 */
export const DEPTH_OF_FIELD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('depthOfFieldQuality', 'on', DEPTH_OF_FIELD_LEVELS),
    integer('depthOfFieldGatherDivisor', 2, [1, 2]),
    choice('depthOfFieldAccumulator', 'high', DEPTH_OF_FIELD_ACCUMULATORS),
    nonNegative('depthOfFieldDistinctionLimit', 0),
    flag('depthOfFieldGatherBokeh', false),
    choice('depthOfFieldPostfilter', 'median', DEPTH_OF_FIELD_POSTFILTERS),
    integer('depthOfFieldRingCount', 4, [3, 5]),
    count('depthOfFieldMaxMips', 4, 1),
    choice('depthOfFieldForegroundScatter', 'additive', DEPTH_OF_FIELD_FOREGROUND_SCATTERS),
    choice('depthOfFieldBackgroundScatter', 'occlusion', DEPTH_OF_FIELD_BACKGROUND_SCATTERS),
    flag('depthOfFieldScatterBokeh', true),
    number('depthOfFieldScatterMinRadius', 3, atLeast(3)),
    number('depthOfFieldScatterMaxRatio', 0.1, [0, 1]),
    nonNegative('depthOfFieldScatterNeighborColor', 10),
    choice('depthOfFieldRecombine', 'low', DEPTH_OF_FIELD_RECOMBINES),
    flag('depthOfFieldRecombineBokeh', false),
    nonNegative('depthOfFieldRecombineMinBlur', 0.1),
    nonNegative('depthOfFieldMaxForegroundRadius', 0.025),
    nonNegative('depthOfFieldMaxBackgroundRadius', 0.025),
    number('depthOfFieldSlightFocusRejection', 0, [0, 0.125]),
    choice('depthOfFieldTemporalQuality', 'high', DEPTH_OF_FIELD_TEMPORALS),
    number('depthOfFieldBilateralStrength', 0, [0, 1]),
    number('depthOfFieldTemporalCurrentWeight', 0.04, [0, 1]),
  ] as const))()
/** The field of one setting of how the depth of field is drawn. */
export type DepthOfFieldField = keyof typeof DEPTH_OF_FIELD_RULES
/** The settings of how the depth of field is drawn as a host writes them, by their fields: each its
 *  value, or nothing for its default. */
export type DepthOfFieldSettings = SettingOptions<typeof DEPTH_OF_FIELD_RULES>
/** The settings of how the depth of field is drawn as the engine reads them: every field set. */
export type DepthOfFieldValues = SettingValues<typeof DEPTH_OF_FIELD_RULES>

/** What each quality level below the top writes: the reference's own, its first three quality
 *  levels — none at `smooth`, the cheap level at `balanced`, the next at `fine`; `max`
 *  writes nothing, the defaults; `cinematic` writes its fifth row, the gather at the full size
 *  with five rings and the diaphragm's shape, the scatter and the recombine at their finest. Each
 *  level writes only the settings the reference's level does (`runtime/qualityLevels.ts`). */
export const DEPTH_OF_FIELD_PRESET_LEVELS = {
  smooth: { depthOfFieldQuality: 'off' },
  balanced: {
    depthOfFieldGatherDivisor: 2,
    depthOfFieldAccumulator: 'low',
    depthOfFieldPostfilter: 'max',
    depthOfFieldGatherBokeh: false,
    depthOfFieldRingCount: 3,
    depthOfFieldForegroundScatter: 'off',
    depthOfFieldBackgroundScatter: 'off',
    depthOfFieldRecombine: 'off',
    depthOfFieldTemporalQuality: 'low',
    depthOfFieldMaxForegroundRadius: 0.006,
    depthOfFieldMaxBackgroundRadius: 0.006,
  },
  fine: {
    depthOfFieldGatherDivisor: 2,
    depthOfFieldAccumulator: 'low',
    depthOfFieldPostfilter: 'max',
    depthOfFieldGatherBokeh: false,
    depthOfFieldRingCount: 4,
    depthOfFieldForegroundScatter: 'additive',
    depthOfFieldBackgroundScatter: 'additive',
    depthOfFieldScatterBokeh: false,
    depthOfFieldScatterMaxRatio: 0.04,
    depthOfFieldRecombine: 'off',
    depthOfFieldTemporalQuality: 'low',
    depthOfFieldMaxForegroundRadius: 0.012,
    depthOfFieldMaxBackgroundRadius: 0.012,
  },
  cinematic: {
    depthOfFieldQuality: 'on',
    depthOfFieldGatherDivisor: 1,
    depthOfFieldAccumulator: 'high',
    depthOfFieldPostfilter: 'median',
    depthOfFieldGatherBokeh: true,
    depthOfFieldRingCount: 5,
    depthOfFieldForegroundScatter: 'additive',
    depthOfFieldBackgroundScatter: 'occlusion',
    depthOfFieldScatterBokeh: true,
    depthOfFieldScatterMaxRatio: 0.25,
    depthOfFieldRecombine: 'high',
    depthOfFieldRecombineBokeh: true,
    depthOfFieldTemporalQuality: 'high',
    depthOfFieldMaxForegroundRadius: 0.025,
    depthOfFieldMaxBackgroundRadius: 0.025,
  },
} as const

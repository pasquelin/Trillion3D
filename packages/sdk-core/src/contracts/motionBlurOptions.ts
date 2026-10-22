import {
  choiceSetting,
  flagSetting,
  integerSetting,
  nonNegativeSetting,
  numberSetting,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The motion blur of a view: what a camera sees of a shutter that stays open while the picture
 * moves. Each pixel gathers its colour along the motion it had since the last image, the length
 * of the streak following `amount`, the speed of the image against `targetFps` and the ceiling
 * `max`; a still image, whose motion is zero, is left as it is. Every world starts with it in its
 * effect chain (`world.effects`), ahead of the bloom; removing it, an `amount` of 0 or a quality
 * of `off` turns it off.
 *
 * The pass reads the motion measured for each render texel (the temporal pass's, or, with it off,
 * the same analysis run alone). Each texel's motion, taken from the nearest surface of its
 * neighbourhood, is scaled to pixels and capped at `max`; the largest and the smallest motion of
 * each tile of 16 × 16 texels is kept, then spread to the tiles the largest one crosses; each tile
 * of 16 × 16 pixels is gathered along the motion of its tile, at half the resolution where the
 * motion is long enough (`motionBlurHalfResGather`), by a number of samples the quality names.
 * Where the surfaces of the streak move differently, the samples are weighed by their depth and
 * their own motion, so a still foreground is not smeared over the moving background behind it nor
 * the reverse.
 *
 * Two layers, as the reference has them. The pass holds what a post-process volume holds: the
 * strength, the longest streak, the frame rate it is relative to, whether the camera blurs
 * (`MotionBlurOptions`). The way it is drawn is the view's: the quality, the half-resolution
 * gather and input, the two passes, the drawn spread — run-time settings, as `./settingRules.ts`
 * says, of the world's registry (`MOTION_BLUR_RULES`), a quality preset writing the first two.
 */

/** The quality levels, `off` first, then coarsest to finest: each names how many samples a pixel
 *  gathers at most (`MOTION_BLUR_SAMPLES`). */
export const MOTION_BLUR_LEVELS = ['off', 'low', 'medium', 'high', 'veryHigh'] as const
/** A quality level of the motion blur. */
export type MotionBlurLevel = (typeof MOTION_BLUR_LEVELS)[number]
/** A level that draws. */
type MotionBlurRunningLevel = Exclude<MotionBlurLevel, 'off'>

/** Samples a pixel gathers at most, by level: the reference's own, 4, 8, 12 and 16. */
export const MOTION_BLUR_SAMPLES: Readonly<Record<MotionBlurRunningLevel, number>> = {
  low: 4,
  medium: 8,
  high: 12,
  veryHigh: 16,
}

/**
 * The settings of how the motion blur is drawn, by field, each with the reference's default:
 * - `motionBlurQuality` (`'veryHigh'`): the level, `'off'`, `'low'`, `'medium'`, `'high'` or
 *   `'veryHigh'` — 16 samples a pixel at most; the grain shows at the coarser levels, `low`
 *   taking 4; `'off'` draws no blur;
 * - `motionBlurHalfResGather` (off): whether a tile whose streak is longer, in pixels, than the
 *   samples a pixel takes is gathered at half the resolution of the image — the value the
 *   reference runs at by default; every tile is gathered at the full resolution;
 * - `motionBlurHalfResInput` (on): whether the samples of a streak spaced more than a pixel apart
 *   read the half-resolution image, wholly so from two pixels apart, which lets the few samples
 *   cover the whole streak without gaps;
 * - `motionBlurSeparable` (off): whether the blur runs twice, the second pass smoothing the grain
 *   of the first and reading the full-size image alone;
 * - `motionBlurScatter` (off): whether the largest motion of each tile is always spread over the
 *   tiles it crosses by drawing it, rather than by reading the neighbours — which a streak of more
 *   than three tiles of 16 pixels (a `max` over 5 on a 1920-pixel image, or a wider image) needs
 *   anyway;
 * - `motionBlurDirections` (1), 1 or 2: the motions a tile keeps and a pixel gathers along. With
 *   2, a tile keeps a second largest motion, one more than 5 degrees from the first, and a pixel
 *   of a tile where two motions cross gathers along both, the two weighed by depth and by how
 *   well each sample's motion follows the one it is gathered along, and the gaps either leaves
 *   filled from the other; a tile with one motion is blurred as with 1. Costs one more image of
 *   ranges per tile image, a list of tiles and the passes that read them.
 */
export const MOTION_BLUR_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choiceSetting('motionBlurQuality', 'veryHigh', MOTION_BLUR_LEVELS),
    flagSetting('motionBlurHalfResGather', false),
    flagSetting('motionBlurHalfResInput', true),
    flagSetting('motionBlurSeparable', false),
    flagSetting('motionBlurScatter', false),
    integerSetting('motionBlurDirections', 1, [1, 2]),
  ] as const))()
/** The field of one setting of how the motion blur is drawn. */
export type MotionBlurField = keyof typeof MOTION_BLUR_RULES
/** The settings of how the motion blur is drawn as a host writes them, by their fields: each its
 *  value, or nothing for its default. */
export type MotionBlurSettings = SettingOptions<typeof MOTION_BLUR_RULES>
/** The settings of how the motion blur is drawn as the engine reads them: every field set. */
export type MotionBlurValues = SettingValues<typeof MOTION_BLUR_RULES>

/** What each quality level below the top writes of the quality and the half-resolution gather,
 *  the reference's own scalability levels: no blur at `smooth`, the high level at `balanced` and
 *  `fine`, the half-resolution gather on at the first two; `max` writes nothing, the very high
 *  level and the full-resolution gather (`runtime/qualityLevels.ts`). */
export const MOTION_BLUR_PRESET_LEVELS = {
  smooth: { motionBlurQuality: 'off', motionBlurHalfResGather: true },
  balanced: { motionBlurQuality: 'high', motionBlurHalfResGather: true },
  fine: { motionBlurQuality: 'high', motionBlurHalfResGather: false },
} as const

/**
 * The settings of the pass (`effect.motionBlur`), by field, each with the reference's default:
 * - `amount` (0.5), from 0 to 1: the strength of the blur — the streak is this share of the motion
 *   of one `targetFps` frame, a shutter open half the frame at the default; linear: 1 doubles the
 *   streak, 0 removes it, and is off;
 * - `max` (5), from 0 to 100: the longest streak, in percent of the image's width, which keeps a
 *   fast turn legible; 0 is off. A streak of more than three 16-pixel tiles of a 1920-pixel image
 *   (a `max` over 5, or a wider image) is spread by drawing its tile's motion over the tiles it
 *   crosses (`motionBlurScatter`);
 * - `targetFps` (30), a whole number from 0 to 120: the frame rate the streak is relative to — the
 *   blur is the one a shutter of that frame's length gives, whatever the rate the page runs at,
 *   a higher target shortening it; the default is the blur of a frame of 1/30 s, which a page at
 *   60 frames a second sees as the shutter of a frame twice as long as its own; 0 makes it follow
 *   the rate the page runs at;
 * - `cameraMotion` (true): whether the motion of the camera blurs the image as an object's does;
 *   off, only what moves in the scene does;
 * - `perObjectSize` (0), a number of at least 0: the smallest object whose own motion is
 *   measured, the diameter of its bounding sphere — the one about its world box — in percent of
 *   the screen, along the axis the projection magnifies most, scaled by the view's field of view
 *   over 90 degrees. A smaller object is measured as still, the camera's motion alone moving it,
 *   for every pass that reads the motion (the blur, the temporal pass, the indirect light); one
 *   of no world box is never left out. 0 leaves no object out.
 */
const MOTION_BLUR_PASS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    numberSetting('amount', 0.5, [0, 1]),
    numberSetting('max', 5, [0, 100]),
    integerSetting('targetFps', 30, [0, 120]),
    flagSetting('cameraMotion', true),
    nonNegativeSetting('perObjectSize', 0),
  ] as const))()

/** What a page may pass to `effect.motionBlur`: each setting of the pass (`MOTION_BLUR_PASS_RULES`)
 *  or none for its default. */
export type MotionBlurOptions = SettingOptions<typeof MOTION_BLUR_PASS_RULES>

/** The motion blur as the engine reads it: every field set. */
export type ResolvedMotionBlur = Readonly<SettingValues<typeof MOTION_BLUR_PASS_RULES>>

/** The amount and the longest streak under which the blur draws nothing, the reference's: a pass
 *  of either is idle. */
export const MOTION_BLUR_LEAST = 0.001

/**
 * The motion blur an option names: every field it leaves out is the default
 * (`MOTION_BLUR_PASS_RULES`). The one reading of the option, whoever takes it — `effect.motionBlur`,
 * the world's own, a setter.
 * @throws TypeError naming the field and the values it takes when one is none of them.
 */
export const resolveMotionBlur = (options: MotionBlurOptions = {}): ResolvedMotionBlur =>
  Object.freeze(resolveSettings(MOTION_BLUR_PASS_RULES, options))

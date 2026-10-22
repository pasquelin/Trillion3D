import {
  ANY_NUMBER as ANY,
  choiceSetting as choice,
  countSetting as count,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * The film effects of a view's display finishing: what a lens and a film do to the image after
 * its exposure and before its curve — the vignette's look, the colour fringe at the corners, the
 * film grain, the tint — and what the display adds to hide its own steps, the dither. Run-time
 * settings, as `./settingRules.ts` says: no compiler job names them. The vignette's strength
 * (`SceneEnvironment.vignette`, 0.4) and the sharpening (`SceneEnvironment.sharpness`) stay the
 * scene's; these are the engine's own, read again at each image by the finishing
 * (`packages/sdk-browser/src/post/finish/`), which draws only the lit image of a view that shows
 * its beauty.
 *
 * Every setting has the reference's default, so with nothing written the image is the reference's:
 * the vignette on, the dither on, the grain, the fringe and the tint off.
 */

/** The shapes of the vignette's falloff: the cosine-fourth law of a lens, and an oval whose edge
 *  is the `vignetteSize` and whose fall is `vignetteSoftness`. */
export const VIGNETTE_TYPES = ['cosineFourthLaw', 'oval'] as const

/** The levels of the colour fringe's quality: none, or the fringe read with three samples. */
const FRINGE_LEVELS = ['off', 'high'] as const

/** The fringe's intensity, in percent, over which the effect draws at all: a smaller one is
 *  skipped. */
export const FRINGE_LEAST = 0.01
/** The fringe's intensity `chromaticAberrationMax` of −2 forces, to look at an extreme one. */
export const FRINGE_EXTREME = 5
/** The wavelengths of the three primaries, in nanometres: a simple lens bends a colour
 *  roughly in proportion to its wavelength's distance from the blue's. */
export const FRINGE_PRIMARIES = { red: 611.3, green: 549.1, blue: 464.3 } as const
/** The fringe's shift of a colour per nanometre away from the blue's wavelength, for an intensity
 *  of 100 percent, as a share of the position's distance past the start offset: the shift is
 *  `intensity / 100 × 0.007 × nanometres`, over what remains of the image past that offset. */
export const FRINGE_PER_NANOMETRE = 0.007
/** The start offset from which the fringe does nothing: the whole image lies under it. */
export const FRINGE_START_LIMIT = 1 - 1e-4

/** The tonemapper quality under which the vignette is off. */
export const VIGNETTE_LEAST_QUALITY = 2
/** The tonemapper quality under which the grain is off. */
export const GRAIN_LEAST_QUALITY = 4
/** The strongest sharpening the tonemapper takes. */
const SHARPEN_MOST = 10

/** Side of the grain's texture, in texels. */
export const GRAIN_TEXTURE_SIDE = 128
/** Width of the image, in pixels, the grain's texels are sized for: at this width a texel is a
 *  pixel at a `filmGrainScale` of 1, and the grain grows with the image. */
export const GRAIN_REFERENCE_WIDTH = 1920
/** The smallest `filmGrainScale` read: under it the grain would grow past every image. */
export const GRAIN_LEAST_SCALE = 0.001
/** The smallest `vignetteSize` read. */
export const VIGNETTE_LEAST_SIZE = 0.001

/** The bits of a channel whose level the dither's step is, where the display target is not an
 *  8-bit one: ten. An 8-bit target steps by 1/255. */
export const DITHER_OTHER_BITS = 10

/**
 * The film settings by field, each with the reference's default.
 *
 * The grain multiplies the exposed linear light by a noise that has a mean of 1, weighted by the
 * light of the pixel (`filmGrainIntensity` is 0, off, by default):
 * - `filmGrainIntensity` (0): the grain's overall strength, 0 draws none; below the top quality it
 *   is read as 0 (`tonemapperQuality`);
 * - `filmGrainIntensityShadows`, `filmGrainIntensityMidtones` and `filmGrainIntensityHighlights`
 *   (1 each): the share of it in the dark, middle and bright pixels; all three 0 draws none;
 * - `filmGrainShadowsMax` (0.09): the luminance up to which a pixel is dark, the weight falling to
 *   nothing there; `filmGrainHighlightsMin` (0.5) and `filmGrainHighlightsMax` (1): the luminances
 *   from which a pixel starts to be bright and from which it is wholly so;
 * - `filmGrainScaleX` and `filmGrainScaleY` (1 each): the size of a grain along each axis; 1 is a
 *   texel of a pixel on an image 1920 wide, and the grain grows with the image;
 * - `filmGrainSequenceLength` (97): the images after which the grain's pattern repeats, a whole
 *   number from 1.
 *
 * The colour fringe moves the red and the green of a pixel toward the centre of the image, by
 * their wavelengths, the blue staying where it is (`chromaticAberration` is 0, off, by default):
 * - `chromaticAberration` (0): the intensity, in percent of the distance to the centre; an
 *   intensity of at most 0.01 draws nothing;
 * - `chromaticAberrationStartOffset` (0), from 0 to 1: the distance from the centre, 1 the
 *   corner's, where the fringe starts; 1 draws nothing;
 * - `chromaticAberrationQuality` (`'high'`): `'off'` draws none whatever the intensity;
 * - `chromaticAberrationMax` (−1): −1 leaves the intensity as it is, 0 or more caps it there, −2
 *   forces an extreme one, 5, to look at the fringe.
 *
 * The vignette's look beside its strength:
 * - `vignetteType` (`'cosineFourthLaw'`, or `'oval'`);
 * - `vignetteColorRed`, `vignetteColorGreen` and `vignetteColorBlue` (0 each, black): the colour
 *   the image darkens toward;
 * - `vignetteCenterX` and `vignetteCenterY` (0.5 each, the middle of the image): where it is
 *   brightest;
 * - `vignetteSizeX` and `vignetteSizeY` (1 each) and `vignetteSoftness` (5): the oval's extent and
 *   how fast it falls to the colour.
 *
 * The tonemapper:
 * - `tonemapperQuality` (5), from 0 to 5: 0 draws no vignette and no grain, under 2 no vignette,
 *   under 4 no grain;
 * - `tonemapperSharpen` (−1): below 0 the scene's sharpness, 0 or more replaces it, read from 0
 *   to 10;
 * - `sceneColorTintRed`, `sceneColorTintGreen` and `sceneColorTintBlue` (1 each): the tint the
 *   scene's colour is multiplied by, the bloom's glow not.
 *
 * The dither adds a triangular noise of one step of the display's channel to the colour shown, so
 * that a smooth gradient does not band: `quantizationDitheringBits` (0): 0 takes the step from the
 * target — 1/255 for an 8-bit target, 1/1023 for another —, a number of bits from 1 makes the step
 * 1/(2^bits − 1), 32 or so making it too small to show.
 */
export const FILM_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('filmGrainIntensity', 0),
    nonNegative('filmGrainIntensityShadows', 1),
    nonNegative('filmGrainIntensityMidtones', 1),
    nonNegative('filmGrainIntensityHighlights', 1),
    nonNegative('filmGrainShadowsMax', 0.09),
    nonNegative('filmGrainHighlightsMin', 0.5),
    nonNegative('filmGrainHighlightsMax', 1),
    nonNegative('filmGrainScaleX', 1),
    nonNegative('filmGrainScaleY', 1),
    count('filmGrainSequenceLength', 97, 1),
    nonNegative('chromaticAberration', 0),
    number('chromaticAberrationStartOffset', 0, [0, 1]),
    choice('chromaticAberrationQuality', 'high', FRINGE_LEVELS),
    number('chromaticAberrationMax', -1, [-2, ANY[1]]),
    choice('vignetteType', 'cosineFourthLaw', VIGNETTE_TYPES),
    nonNegative('vignetteColorRed', 0),
    nonNegative('vignetteColorGreen', 0),
    nonNegative('vignetteColorBlue', 0),
    number('vignetteCenterX', 0.5, ANY),
    number('vignetteCenterY', 0.5, ANY),
    nonNegative('vignetteSizeX', 1),
    nonNegative('vignetteSizeY', 1),
    nonNegative('vignetteSoftness', 5),
    integer('tonemapperQuality', 5, [0, 5]),
    number('tonemapperSharpen', -1, ANY),
    nonNegative('sceneColorTintRed', 1),
    nonNegative('sceneColorTintGreen', 1),
    nonNegative('sceneColorTintBlue', 1),
    integer('quantizationDitheringBits', 0, [0, 32]),
  ] as const))()
/** The field of one film setting. */
export type FilmField = keyof typeof FILM_RULES
/** The film settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type FilmSettings = SettingOptions<typeof FILM_RULES>
/** The film settings as the engine reads them: every field set. */
export type FilmValues = SettingValues<typeof FILM_RULES>

/** What each quality level below the top writes of the film's settings, the reference's own
 *  levels: no vignette and no grain, and no fringe, at `smooth`; the vignette but no grain and no
 *  fringe at `balanced`; all three at `fine`, as at `max`, which writes nothing
 *  (`runtime/qualityLevels.ts`). */
export const FILM_PRESET_LEVELS = {
  smooth: { tonemapperQuality: 0, chromaticAberrationQuality: 'off' },
  balanced: { tonemapperQuality: 2, chromaticAberrationQuality: 'off' },
  fine: { tonemapperQuality: 5, chromaticAberrationQuality: 'high' },
} as const

/**
 * The sharpening the tonemapper applies: `override` — `tonemapperSharpen` — when 0 or more,
 * else the scene's `sharpness`, read from 0 to `SHARPEN_MOST`.
 */
export const tonemapperSharpness = (override: number, sceneSharpness: number) =>
  clamp(override >= 0 ? override : sceneSharpness, 0, SHARPEN_MOST)

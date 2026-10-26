import { VIGNETTE_TYPES, type FilmValues } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import { quantizationError } from '../taa/colorSpaceWgsl.ts'
import { FINISH } from './finishLayout.ts'
import { GRAIN_TEXTURE_SIDE, grainTexels } from './grain.ts'

const AT = FINISH.at

/** The tonemapper quality under which the vignette is off. */
const VIGNETTE_LEAST_QUALITY = 2
/** The tonemapper quality under which the grain is off. */
const GRAIN_LEAST_QUALITY = 4
/** The fringe's intensity, in percent, over which the effect draws at all. */
const FRINGE_LEAST = 0.01
/** The fringe's intensity `chromaticAberrationMax` of −2 forces, to look at an extreme one. */
const FRINGE_EXTREME = 5
/** The wavelengths of the three primaries, in nanometres: a simple lens bends a colour roughly in
 *  proportion to its wavelength's distance from the blue's. */
const FRINGE_PRIMARIES = { red: 611.3, green: 549.1, blue: 464.3 } as const
/** The shift of a colour per nanometre away from the blue's wavelength, for an intensity of 100
 *  percent, as a share of the position's distance past the start offset. */
const FRINGE_PER_NANOMETRE = 0.007
/** The start offset from which the fringe does nothing: the whole image lies under it. */
const FRINGE_START_LIMIT = 1 - 1e-4
/** Width of the image, in pixels, the grain's texels are sized for: at this width a texel is a
 *  pixel at a grain scale of 1, and the grain grows with the image. */
const GRAIN_REFERENCE_WIDTH = 1920
/** The smallest grain scale and the smallest vignette size read. */
const LEAST_SCALE = 0.001
/** The bits of a channel of the display (`DISPLAY_FORMAT`): its step is the dither's. */
const DISPLAY_BITS = Math.round(-Math.log2(quantizationError(DISPLAY_FORMAT)))

/** What the film's words are written from, beside the settings. */
export type FilmInput = {
  /** The film settings, resolved. */
  film: FilmValues
  /** The scene's vignette strength. */
  vignette: number
  /** The display image's size, in pixels. */
  size: readonly number[]
  /** Whether the grain is drawn (`grainOn`). */
  grain: boolean
  /** The number of the image: the grain's pattern and the dither's follow it. */
  frame: number
}

/** The vignette's strength: the scene's, 0 under the quality that has none. */
const vignetteStrength = (film: FilmValues, vignette: number) =>
  film.tonemapperQuality < VIGNETTE_LEAST_QUALITY ? 0 : vignette

/**
 * The fringe's intensity, in percent: `chromaticAberration`, 0 where the quality is `'off'`, then
 * capped by `chromaticAberrationMax` — 0 or more caps it there, −2 sets it to `FRINGE_EXTREME`
 * whatever the quality said.
 */
function fringeIntensity(film: FilmValues) {
  const intensity = film.chromaticAberrationQuality === 'off' ? 0 : film.chromaticAberration
  const cap = film.chromaticAberrationMax
  if (cap >= 0) return Math.min(intensity, cap)
  return cap === -2 ? FRINGE_EXTREME : intensity
}

/** The fringe's shift of the red and of the green, as a fraction of the distance past the start
 *  offset, and that offset: nothing drawn from an offset at the end of the image. The shift of a
 *  colour follows its wavelength's distance from the blue's. */
function fringeShifts(intensity: number, start: number) {
  const reach = start < FRINGE_START_LIMIT
  const offset = reach ? intensity * 0.01 : 0
  const stretch = reach ? 1 / (1 - start) : 1
  const shift = (nanometres: number) =>
    offset * FRINGE_PER_NANOMETRE * (nanometres - FRINGE_PRIMARIES.blue) * stretch
  return [shift(FRINGE_PRIMARIES.red), shift(FRINGE_PRIMARIES.green), reach ? start : 0] as const
}

/** Whether the grain is drawn: its strength, nil under the quality that has none, and the strength
 *  of at least one of its three zones, are not 0. */
export function grainOn(film: FilmValues) {
  const strength = film.tonemapperQuality < GRAIN_LEAST_QUALITY ? 0 : film.filmGrainIntensity
  return (
    strength > 0 &&
    (film.filmGrainIntensityShadows !== 0 ||
      film.filmGrainIntensityMidtones !== 0 ||
      film.filmGrainIntensityHighlights !== 0)
  )
}

/** The dither's step: one level of the display's channel, or of `quantizationDitheringBits` where
 *  the setting names some (above 0), 1/(2^bits − 1): always added, as the reference adds it, the
 *  step of 32 bits too small to change a colour the display holds. */
function ditherStep(film: FilmValues) {
  const bits = film.quantizationDitheringBits
  return 1 / (2 ** (bits > 0 ? bits : DISPLAY_BITS) - 1)
}

const tintOn = (film: FilmValues) =>
  film.sceneColorTintRed !== 1 || film.sceneColorTintGreen !== 1 || film.sceneColorTintBlue !== 1

/** The vignette's words: its strength, scale, shape, colour, centre and size. */
function writeVignette(words: Float32Array, { film, size, vignette }: FilmInput) {
  const aspect = size[1] / size[0]
  const circle = Math.SQRT2 / Math.sqrt(1 + aspect * aspect)
  const { vignetteColorRed: red, vignetteColorGreen: green, vignetteColorBlue: blue } = film
  words[AT.look] = vignetteStrength(film, vignette)
  const shape = VIGNETTE_TYPES.indexOf(film.vignetteType)
  putVec4(words, AT.screen, circle, aspect * circle, shape, red || green || blue ? 1 : 0)
  putVec4(words, AT.shape, red, green, blue, film.vignetteSoftness)
  putVec4(
    words,
    AT.around,
    film.vignetteCenterX - 0.5,
    film.vignetteCenterY - 0.5,
    1 / Math.max(LEAST_SCALE, film.vignetteSizeX),
    1 / Math.max(LEAST_SCALE, film.vignetteSizeY),
  )
}

/** The grain's words: its strength in each zone, the zones' bounds, the decode of its texture and
 *  the texture's coordinates per image coordinate. */
function writeGrain(words: Float32Array, { film, size, frame }: FilmInput) {
  const strength = film.filmGrainIntensity
  putVec4(
    words,
    AT.grainLevels,
    strength * film.filmGrainIntensityShadows,
    strength * film.filmGrainIntensityMidtones,
    strength * film.filmGrainIntensityHighlights,
  )
  putVec4(
    words,
    AT.grainBounds,
    film.filmGrainShadowsMax,
    film.filmGrainHighlightsMin,
    film.filmGrainHighlightsMax,
  )
  const [decodeRed, decodeGreen, decodeBlue] = grainTexels().decode
  putVec4(words, AT.grainDecode, decodeRed, decodeGreen, decodeBlue)
  // A texel is one pixel of an image `GRAIN_REFERENCE_WIDTH` wide, whatever the image's size, so
  // the pattern repeats across it; the repeat steps through the van der Corput points of the
  // images of the sequence.
  const across = GRAIN_REFERENCE_WIDTH / GRAIN_TEXTURE_SIDE
  const point = (frame % film.filmGrainSequenceLength) + 1
  putVec4(
    words,
    AT.grainUv,
    across / Math.max(film.filmGrainScaleX, LEAST_SCALE),
    (across * (size[1] / size[0])) / Math.max(film.filmGrainScaleY, LEAST_SCALE),
    halton(point, 2),
    halton(point, 3),
  )
}

/**
 * Writes the film's words of the finishing's uniform (`FINISH`, `finishLayout.ts`) into `words`:
 * the vignette, the tint, the fringe, the dither and, where it is drawn, the grain, each as the
 * reference reads its settings, from `input`. A word of an effect that is off stays at the 0 the
 * caller cleared, or is 0 here, which the shader tests once.
 */
export function writeFilmParams(words: Float32Array, input: FilmInput) {
  const { film, frame } = input
  writeVignette(words, input)
  const { sceneColorTintRed: r, sceneColorTintGreen: g, sceneColorTintBlue: b } = film
  putVec4(words, AT.tint, r, g, b, tintOn(film) ? 1 : 0)
  const intensity = fringeIntensity(film)
  const [shiftRed, shiftGreen, start] = fringeShifts(intensity, film.chromaticAberrationStartOffset)
  putVec4(words, AT.fringe, shiftRed, shiftGreen, start, intensity > FRINGE_LEAST ? 1 : 0)
  putVec4(words, AT.dither, ditherStep(film), halton(frame & 7, 2), halton(frame & 7, 3))
  if (input.grain) writeGrain(words, input)
}

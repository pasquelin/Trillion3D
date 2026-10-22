import {
  DITHER_OTHER_BITS,
  FRINGE_EXTREME,
  FRINGE_LEAST,
  FRINGE_PER_NANOMETRE,
  FRINGE_PRIMARIES,
  FRINGE_START_LIMIT,
  GRAIN_LEAST_QUALITY,
  GRAIN_LEAST_SCALE,
  GRAIN_REFERENCE_WIDTH,
  GRAIN_TEXTURE_SIDE,
  VIGNETTE_LEAST_QUALITY,
  VIGNETTE_LEAST_SIZE,
  VIGNETTE_TYPES,
  type FilmValues,
} from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { FILM as FILM_CURVE } from '../../lighting/filmCurveConstants.ts'
import { FINISH } from './finishLayout.ts'
import { grainTexels } from './grain.ts'

const AT = FINISH.at

/** The formats of a channel of 8 bits: the display's, whose step the dither is one of. */
const EIGHT_BIT = new Set<GPUTextureFormat>([
  'rgba8unorm',
  'bgra8unorm',
  'rgba8unorm-srgb',
  'bgra8unorm-srgb',
])

/** What the film's words are written from, beside the settings. */
export type FilmInput = {
  /** The film settings, resolved. */
  film: FilmValues
  /** The scene's vignette strength. */
  vignette: number
  /** The display image's size, in pixels. */
  size: readonly number[]
  /** The format the image is written in: its channel's bits are the dither's step. */
  format: GPUTextureFormat
  /** The number of the image: the grain's pattern and the dither's follow it. */
  frame: number
}

/** The vignette's strength: the scene's, 0 under the quality that has none. */
export const vignetteStrength = (film: FilmValues, vignette: number) =>
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

/**
 * The weights of a colour's channels in the luminance the grain's zones read: the grading gamut's
 * luminance row carried through the matrix from that gamut to sRGB — the matrix applied to the
 * row, as the reference writes it.
 */
const GRAIN_LUMA = [0, 1, 2].map((channel) => {
  const { luma, workingToSrgb } = FILM_CURVE.numbers
  return (
    luma[0] * workingToSrgb[channel] +
    luma[1] * workingToSrgb[3 + channel] +
    luma[2] * workingToSrgb[6 + channel]
  )
})

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

/** The dither's step: one level of the display's channel, or of `bits` where the setting names
 *  them, the target's own bits otherwise — 8, or ten for any other format. */
function ditherStep(film: FilmValues, format: GPUTextureFormat) {
  const bits = film.quantizationDitheringBits
  return 1 / (2 ** (bits > 0 ? bits : EIGHT_BIT.has(format) ? 8 : DITHER_OTHER_BITS) - 1)
}

/** Writes the three words `(x, y, z)` of the `vec4f` at `at`, its fourth `w`. */
const put3 = (words: Float32Array, at: number, x: number, y: number, z: number, w = 0) => {
  words[at] = x
  words[at + 1] = y
  words[at + 2] = z
  words[at + 3] = w
}

/**
 * Writes the film's words of the finishing's uniform (`FINISH`, `finishLayout.ts`) into `words`:
 * the tint, the fringe, the vignette's look, the grain and the dither, each as the reference reads
 * its settings, from `input`. The vignette's strength is the first word of `look`, which the
 * caller writes (`vignetteStrength`) with its own words; the vignette's shape is written here. The
 * grain's words are written only where it is drawn, the rest left at the 0 the caller cleared.
 */
export function writeFilmParams(words: Float32Array, input: FilmInput) {
  const { film, size, frame } = input
  put3(words, AT.tint, film.sceneColorTintRed, film.sceneColorTintGreen, film.sceneColorTintBlue)
  const intensity = fringeIntensity(film)
  const [red, green, start] = fringeShifts(intensity, film.chromaticAberrationStartOffset)
  put3(words, AT.fringe, red, green, start, intensity > FRINGE_LEAST ? 1 : 0)
  words[AT.screen + 2] = VIGNETTE_TYPES.indexOf(film.vignetteType)
  put3(words, AT.shape, film.vignetteColorRed, film.vignetteColorGreen, film.vignetteColorBlue)
  words[AT.shape + 3] = film.vignetteSoftness
  words[AT.around] = film.vignetteCenterX - 0.5
  words[AT.around + 1] = film.vignetteCenterY - 0.5
  words[AT.around + 2] = 1 / Math.max(VIGNETTE_LEAST_SIZE, film.vignetteSizeX)
  words[AT.around + 3] = 1 / Math.max(VIGNETTE_LEAST_SIZE, film.vignetteSizeY)
  const dither = AT.dither
  words[dither] = ditherStep(film, input.format)
  words[dither + 1] = halton(frame & 7, 2)
  words[dither + 2] = halton(frame & 7, 3)
  if (!grainOn(film)) return
  const strength = film.filmGrainIntensity
  put3(
    words,
    AT.grainLevels,
    strength * film.filmGrainIntensityShadows,
    strength * film.filmGrainIntensityMidtones,
    strength * film.filmGrainIntensityHighlights,
    1,
  )
  put3(words, AT.grainBounds, film.filmGrainShadowsMax, film.filmGrainHighlightsMin, 0)
  words[AT.grainBounds + 2] = film.filmGrainHighlightsMax
  put3(words, AT.grainLuma, GRAIN_LUMA[0], GRAIN_LUMA[1], GRAIN_LUMA[2])
  put3(words, AT.grainDecode, ...grainTexels().decode)
  // The texture's coordinates per image coordinate: a texel is one pixel of an image
  // `GRAIN_REFERENCE_WIDTH` wide, whatever the image's size, so the pattern repeats across it; the
  // repeat steps through the van der Corput points of the images of the sequence.
  const across = GRAIN_REFERENCE_WIDTH / GRAIN_TEXTURE_SIDE
  const point = (frame % Math.max(1, film.filmGrainSequenceLength)) + 1
  words[AT.grainUv] = across / Math.max(film.filmGrainScaleX, GRAIN_LEAST_SCALE)
  words[AT.grainUv + 1] =
    (across * size[1]) / size[0] / Math.max(film.filmGrainScaleY, GRAIN_LEAST_SCALE)
  words[AT.grainUv + 2] = halton(point, 2)
  words[AT.grainUv + 3] = halton(point, 3)
}

import { EXPOSURE_MIDDLE_GREY } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { luminanceReading, type ExposureSettings } from '../exposure/meterParams.ts'
import { halfOf } from '../filters/levelSizes.ts'
import { FINISH, GRID_EMPTY, GRID_TILE } from './finishLayout.ts'
import { vignetteStrength, writeFilmParams, type FilmInput } from './filmParams.ts'

const AT = FINISH.at
/** How near to 1 a contrast or a strength is to leave the image as it is. */
const NEARLY = 1e-8
/** The distance past a threshold, in stops, of a strength of 1: the contrast scale takes over
 *  at once, as a distance no image reaches. */
const SHARPEST = 1e30

const moved = (value: number) => Math.abs(value - 1) > NEARLY

/** Whether the settings ask the local exposure to run: a contrast, or the detail, not 1. At 1 for
 *  all three the layers put every pixel back where it was. */
export const localExposureOn = (settings: ExposureSettings) =>
  moved(settings.localExposureHighlightContrast) ||
  moved(settings.localExposureShadowContrast) ||
  moved(settings.localExposureDetailStrength)

/** What the finishing's uniform is written from: the film's input (`FilmInput`: the film settings,
 *  the scene's vignette strength, the display image's size — the grid is built over its half-size
 *  image —, its format and its number) and the exposure's. */
export type FinishInput = FilmInput & {
  settings: ExposureSettings
  /** Whether the exposure is the automatic one, whose bias moves the middle grey. */
  auto: boolean
  /** Whether the local exposure runs, and whether a glow is added. */
  local: boolean
  glow: boolean
}

/** The share of the grid's width the half-size image fills along one axis, `pixels` wide: the
 *  grid holds a whole tile where the image fills part of one, so the image's unit coordinate lands
 *  at this share of the grid's. */
const gridScale = (pixels: number) => pixels / GRID_TILE / ceilDiv(pixels, GRID_TILE)

/** How far past a threshold the contrast takes over: `1 / (1 − strength)` stops. */
const reachOf = (strength: number) => (strength >= 1 ? SHARPEST : 1 / (1 - strength))

/**
 * Writes the finishing's uniform (`FINISH`) into `words`. The exposure, its second word, is the
 * GPU's to copy in (`finishFrame`): written as 1 here, so a buffer written again holds the same
 * words frame after frame. The middle grey the local exposure pulls toward is 0.18 times two to
 * the local bias, times two to the exposure's own bias where the exposure is automatic — its
 * target —; a manual exposure leaves the grey where it is. The film's words follow
 * (`writeFilmParams`).
 */
export function writeFinishParams(words: Float32Array, input: FinishInput) {
  const { settings, size } = input
  const reading = luminanceReading(settings)
  const aspect = size[1] / size[0]
  const circle = Math.SQRT2 / Math.sqrt(1 + aspect * aspect)
  const grey =
    EXPOSURE_MIDDLE_GREY *
    2 ** ((input.auto ? settings.exposureBias : 0) + settings.localExposureMiddleGreyBias)
  words.fill(0)
  words[AT.look] = vignetteStrength(input.film, input.vignette)
  words[AT.look + 1] = 1
  words[AT.look + 2] = input.local ? 1 : 0
  words[AT.look + 3] = input.glow ? 1 : 0
  words[AT.screen] = circle
  words[AT.screen + 1] = aspect * circle
  words.set(reading.weights, AT.weights)
  words[AT.weights + 3] = reading.lowest
  words[AT.histogram] = reading.scale
  words[AT.histogram + 1] = reading.bias
  words[AT.histogram + 2] = settings.localExposureBlurBlend
  words[AT.histogram + 3] = GRID_EMPTY
  words[AT.base] = Math.log2(grey)
  words[AT.base + 1] = settings.localExposureHighlightContrast
  words[AT.base + 2] = settings.localExposureShadowContrast
  words[AT.base + 3] = settings.localExposureDetailStrength
  words[AT.grid] = gridScale(halfOf(size[0]))
  words[AT.grid + 1] = gridScale(halfOf(size[1]))
  words[AT.grid + 2] = settings.localExposureHighlightThreshold
  words[AT.grid + 3] = settings.localExposureShadowThreshold
  words[AT.reach] = reachOf(settings.localExposureHighlightThresholdStrength)
  words[AT.reach + 1] = reachOf(settings.localExposureShadowThresholdStrength)
  writeFilmParams(words, input)
}

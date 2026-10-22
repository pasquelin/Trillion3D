import { EXPOSURE_MIDDLE_GREY } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { luminanceReading, reachOf, type ExposureSettings } from '../exposure/meterParams.ts'
import { halfOf } from '../filters/levelSizes.ts'
import { FINISH, GRID_EMPTY, GRID_TILE } from './finishLayout.ts'
import { writeFilmParams, type FilmInput } from './filmParams.ts'

const AT = FINISH.at

/** What the finishing's uniform is written from: the film's input (`FilmInput`: the film settings,
 *  the scene's vignette strength, the display image's size — the grid is built over its half-size
 *  image —, whether the grain is drawn and the image's number) and the exposure's. */
export type FinishInput = FilmInput & {
  settings: ExposureSettings
  /** Whether the exposure is the automatic one, whose bias moves the middle grey. */
  auto: boolean
  /** Whether the local exposure runs, and whether a glow is added. */
  local: boolean
  glow: boolean
  /** What the image's colour is multiplied by where the glow took some of its light, per channel;
   *  none where it took none. */
  keep?: readonly number[]
  /** What the glow's dirt mask multiplies it by, per channel; none where no mask is drawn. */
  dirt?: readonly number[]
}

/** The share of the grid's width the half-size image fills along one axis, `pixels` wide: the
 *  grid holds a whole tile where the image fills part of one, so the image's unit coordinate lands
 *  at this share of the grid's. */
const gridScale = (pixels: number) => pixels / GRID_TILE / ceilDiv(pixels, GRID_TILE)

/**
 * Writes the finishing's uniform (`FINISH`) into `words`. The exposure, its second word, is the
 * GPU's to copy in (`finishFrame`): written as 1 here, so a buffer written again holds the same
 * words frame after frame. The middle grey the local exposure pulls toward is 0.18 times two to
 * the local bias, times two to the exposure's own bias where the exposure is automatic — its
 * target —; a manual exposure leaves the grey where it is. The film's words follow
 * (`writeFilmParams`), the vignette's among them.
 */
export function writeFinishParams(words: Float32Array, input: FinishInput) {
  const { settings, size } = input
  const reading = luminanceReading(settings)
  const grey =
    EXPOSURE_MIDDLE_GREY *
    2 ** ((input.auto ? settings.exposureBias : 0) + settings.localExposureMiddleGreyBias)
  words.fill(0)
  words[AT.look + 1] = 1
  words[AT.look + 2] = input.local ? 1 : 0
  words[AT.look + 3] = input.glow ? 1 : 0
  if (input.keep) putVec4(words, AT.keep, input.keep[0], input.keep[1], input.keep[2], 1)
  if (input.dirt) putVec4(words, AT.dirt, input.dirt[0], input.dirt[1], input.dirt[2], 1)
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

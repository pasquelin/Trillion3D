import type { ExposureValues } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { ViewTile } from '../../camera/engineCamera.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { luminanceReading, reachOf, writeLuminanceReading } from '../exposure/meterParams.ts'
import { halfOf } from '../filters/levelSizes.ts'
import { FINISH, GRID_EMPTY, GRID_TILE } from './finishLayout.ts'
import { writeFilmParams, type FilmInput } from './filmParams.ts'

const AT = FINISH.at

/** What the finishing's uniform is written from: the film's input (`FilmInput`: the film settings,
 *  the scene's vignette strength, the display image's size — the grid is built over its half-size
 *  image —, whether the grain is drawn and the image's number) and the exposure's. */
export type FinishInput = FilmInput & {
  settings: ExposureValues
  /** Whether the local exposure runs, and whether a glow is added. */
  local: boolean
  glow: boolean
  /** What the image's colour is multiplied by where the glow took some of its light, per channel;
   *  none where it took none. */
  keep?: readonly number[]
  /** What the glow's dirt mask multiplies it by, per channel; none where no mask is drawn. */
  dirt?: readonly number[]
  /** The lens' principal point (`lensOf`). */
  lens: readonly number[]
  /** The pre-exposure the image's light is held multiplied by (`preExposureOf`); 1 by default. */
  preExposure?: number
}

/** The lens of a view drawn whole: its centre at the image's, its scale the image's. */
const WHOLE_LENS: readonly number[] = Object.freeze([0, 0, 1, 1])

/**
 * The lens' principal point of a camera that draws `tile` of a wider view: the offset of the tile's
 * centre in the wider view's `[−1, 1]` square and the scale from the one square to the other, on
 * each axis — a point at `p` of the tile's square lies at `offset + p · scale` of the lens' —;
 * `(0, 0, 1, 1)` where the view is drawn whole. The inverse of the clip window the tile's
 * projection applies (`camera/engineCamera.ts`). Written into `into` when given, which a frame that
 * draws a tile does, so an image allocates none; else a new array, or the shared whole lens.
 */
export function lensOf(tile: ViewTile | null | undefined, into?: number[]): readonly number[] {
  if (!tile && !into) return WHOLE_LENS
  const [x, y, scaleX, scaleY] = tile
    ? [tile.offsetX / tile.scaleX, tile.offsetY / tile.scaleY, 1 / tile.scaleX, 1 / tile.scaleY]
    : WHOLE_LENS
  const out = into ?? []
  out[0] = x
  out[1] = y
  out[2] = scaleX
  out[3] = scaleY
  return out
}

/** The share of the grid's width the half-size image fills along one axis, `pixels` wide: the
 *  grid holds a whole tile where the image fills part of one, so the image's unit coordinate lands
 *  at this share of the grid's. */
const gridScale = (pixels: number) => pixels / GRID_TILE / ceilDiv(pixels, GRID_TILE)

/**
 * Writes the finishing's uniform (`FINISH`) into `words`. The exposure, its second word, is the
 * GPU's to copy in (`finishFrame`): written as 1 here, so a buffer written again holds the same
 * words frame after frame. The log2 of the middle grey the local exposure pulls toward, the first
 * word of `base`, is the GPU's to copy in too, from the exposure buffer (`ExposureMeter.copyGrey`):
 * 0 here; so are the scales of the local exposure's contrast curves (the last two words of `pre`), 1 here. The film's words follow (`writeFilmParams`), the vignette's among them.
 */
export function writeFinishParams(words: Float32Array, input: FinishInput) {
  const { settings, size } = input
  const reading = luminanceReading(settings)
  words.fill(0)
  words[AT.look + 1] = 1
  words[AT.look + 2] = input.local ? 1 : 0
  words[AT.look + 3] = input.glow ? 1 : 0
  if (input.keep) putVec4(words, AT.keep, input.keep[0], input.keep[1], input.keep[2], 1)
  if (input.dirt) putVec4(words, AT.dirt, input.dirt[0], input.dirt[1], input.dirt[2], 1)
  writeLuminanceReading(words, AT.weights, AT.histogram, reading)
  words[AT.histogram + 2] = settings.localExposureBlurBlend
  words[AT.histogram + 3] = GRID_EMPTY
  words[AT.base + 1] = settings.localExposureHighlightContrast
  words[AT.base + 2] = settings.localExposureShadowContrast
  words[AT.base + 3] = settings.localExposureDetailStrength
  words[AT.grid] = gridScale(halfOf(size[0]))
  words[AT.grid + 1] = gridScale(halfOf(size[1]))
  words[AT.grid + 2] = settings.localExposureHighlightThreshold
  words[AT.grid + 3] = settings.localExposureShadowThreshold
  words[AT.reach] = reachOf(settings.localExposureHighlightThresholdStrength)
  words[AT.reach + 1] = reachOf(settings.localExposureShadowThresholdStrength)
  const pre = input.preExposure ?? 1
  putVec4(words, AT.pre, pre, 1 / pre, 1, 1)
  putVec4(words, AT.lens, input.lens[0], input.lens[1], input.lens[2], input.lens[3])
  writeFilmParams(words, input)
}

import { refusal } from './nameMatch.ts'
import { finiteAtLeast, resolveTint, type BloomTint } from './bloomFields.ts'
import {
  resolveBloomConvolution,
  type BloomConvolutionOptions,
  type ResolvedBloomConvolution,
} from './bloomConvolutionOptions.ts'
import {
  resolveBloomDirtMask,
  type BloomDirtMaskOptions,
  type ResolvedBloomDirtMask,
} from './bloomDirtOptions.ts'

/**
 * The bloom of a view: the glow that spills around what is bright, added to the linear radiance
 * before its exposure and display curve. Every world starts with it in its effect chain
 * (`world.effects`); removing it, or an intensity of 0, turns it off.
 *
 * Two ways to make the glow (`method`). The default is a sum of six Gaussian blurs of the image at
 * six scales: the image is brought to half size, then down five more halvings; the blur of each
 * level is as wide as a share of that level's width (its `size` times `sizeScale`, in percent),
 * tinted by its `tint`, and the six are summed from the smallest level up, each added into the next
 * larger one's. The sum is scaled by `intensity × gaussianIntensity / 6` and added to the image: it
 * adds light, it is not a blend. With a `threshold` above −1 only the pixels brighter than it glow,
 * with local exposure on the image the bloom reads has its local exposure applied first. How many
 * of the six levels draw, and whether the blur keeps a bright centre, are the view's settings
 * (`./bloomRules.ts`: `bloomQuality`, `bloomCross`).
 *
 * The other is a convolution of the image with a kernel (`./bloomConvolutionOptions.ts`), the
 * glow a lens makes, cinematic and costly, off by default. A dirt mask (`./bloomDirtOptions.ts`)
 * modulates either glow with a picture of the lens's smudges, also off by default.
 */

export type { BloomTint } from './bloomFields.ts'

/** The ways to make the glow: a sum of Gaussian blurs, or a convolution with a kernel. */
export const BLOOM_METHODS = ['gaussian', 'convolution'] as const
/** A way to make the glow. */
export type BloomMethod = (typeof BLOOM_METHODS)[number]

/** One of the bloom's six levels as a host writes it, from the finest (`levels[0]`, drawn at half
 *  the image) to the widest (`levels[5]`, at 1/64). */
export interface BloomLevelOptions {
  /** The blur's diameter, in percent of the level's width before `sizeScale`; 0 leaves the level
   *  out. */
  size?: number
  /** The level's share of the glow, per channel. */
  tint?: BloomTint
}
/** What a page may pass to `effect.bloom`. */
export interface BloomOptions {
  /** How the glow is made: `'gaussian'` (the default) or `'convolution'`. */
  method?: BloomMethod
  /** Multiplier of the whole glow: 0 is off, 1 adds the glow at the tints' own strength. */
  intensity?: number
  /** Multiplier of the Gaussian glow alone, at 1 by default; 0 turns that method off. */
  gaussianIntensity?: number
  /** The luminance, in the image's exposed radiance, past which a pixel glows; −1 lets every pixel
   *  glow, in proportion to its radiance. */
  threshold?: number
  /** Multiplier of every level's `size`. */
  sizeScale?: number
  /** The six levels' settings; a level or a field left out keeps its default. */
  levels?: readonly BloomLevelOptions[]
  /** The convolution's settings, read when `method` is `'convolution'`. */
  convolution?: BloomConvolutionOptions
  /** The dirt mask: a picture that modulates the glow, none by default. */
  dirtMask?: BloomDirtMaskOptions
}
/** A level as the engine reads it: every field set. */
export interface ResolvedBloomLevel {
  readonly size: number
  readonly tint: readonly [number, number, number]
}
/** The bloom as the engine reads it: every field set. */
export interface ResolvedBloom {
  readonly method: BloomMethod
  readonly intensity: number
  readonly gaussianIntensity: number
  readonly threshold: number
  readonly sizeScale: number
  readonly levels: readonly ResolvedBloomLevel[]
  readonly convolution: ResolvedBloomConvolution
  readonly dirtMask: ResolvedBloomDirtMask
}

/** A level of `size` and a grey `tint`. */
const levelOf = (size: number, grey: number): ResolvedBloomLevel =>
  Object.freeze({ size, tint: Object.freeze([grey, grey, grey] as const) })

/** The levels of the bloom: the image halved six times at most. A declared value, not a measured
 *  one: it sets how far the widest glow reaches, 2⁶ texels of the half image per texel of the
 *  last level. */
export const BLOOM_LEVEL_COUNT = 6

/**
 * The defaults, each the reference's own:
 * - `method` gaussian: the sum of blurs, the cheap glow of a game; the convolution is for stills.
 * - `intensity` 0.675: the share of the image's energy the glow adds, 0.675 × the tints' sum
 *   (0.795) over the six levels, about 9 % of the light. Sensitivity: linear — 1.35 doubles the
 *   halo, 0 removes it.
 * - `gaussianIntensity` 1: the Gaussian glow at the strength `intensity` gives it.
 * - `threshold` −1: no pixel is left out, the physically right glow, which also leaves out the pass
 *   that applies a threshold.
 * - `sizeScale` 4: it keeps the look the level sizes were tuned for when a factor of four was
 *   fixed in the filter.
 * - the levels, finest to widest: sizes 0.3, 1, 2, 10, 30 and 64, tints 0.3465, 0.138, 0.1176,
 *   0.066, 0.066 and 0.061, greys. Each is a look: the wider levels carry less of the glow so that
 *   it falls off smoothly from the bright pixel.
 */
const DEFAULT_BLOOM = Object.freeze({
  method: 'gaussian' as BloomMethod,
  intensity: 0.675,
  gaussianIntensity: 1,
  threshold: -1,
  sizeScale: 4,
  levels: Object.freeze(
    [
      [0.3, 0.3465],
      [1, 0.138],
      [2, 0.1176],
      [10, 0.066],
      [30, 0.066],
      [64, 0.061],
    ].map(([size, grey]) => levelOf(size, grey)),
  ),
})

/**
 * The bloom an option names: every field it leaves out is the default (`DEFAULT_BLOOM`). The one
 * reading of the option, whoever takes it — `effect.bloom`, the world's own, a setter.
 * @throws RangeError naming the field and the value when one is out of its range, TypeError when
 *   `levels` is not a list of at most six or `method` is not one of the two.
 */
export function resolveBloom(options: BloomOptions = {}): ResolvedBloom {
  const { levels = [], method = DEFAULT_BLOOM.method } = options
  if (!Array.isArray(levels) || levels.length > BLOOM_LEVEL_COUNT)
    return refusal('bloom')(`levels must list at most ${BLOOM_LEVEL_COUNT} levels`)
  if (!BLOOM_METHODS.includes(method))
    return refusal('bloom')(`method must be one of ${BLOOM_METHODS.join(', ')}`)
  const gaussian = options.gaussianIntensity ?? DEFAULT_BLOOM.gaussianIntensity
  return Object.freeze({
    method,
    intensity: finiteAtLeast(options.intensity ?? DEFAULT_BLOOM.intensity, 0, 'BLOOM_INTENSITY'),
    gaussianIntensity: finiteAtLeast(gaussian, 0, 'BLOOM_GAUSSIAN_INTENSITY'),
    threshold: finiteAtLeast(options.threshold ?? DEFAULT_BLOOM.threshold, -1, 'BLOOM_THRESHOLD'),
    sizeScale: finiteAtLeast(options.sizeScale ?? DEFAULT_BLOOM.sizeScale, 0, 'BLOOM_SIZE_SCALE'),
    levels: Object.freeze(
      DEFAULT_BLOOM.levels.map((level, at) =>
        Object.freeze({
          size: finiteAtLeast(levels[at]?.size ?? level.size, 0, `BLOOM_SIZE:${at}`),
          tint: resolveTint(levels[at]?.tint, level.tint, `BLOOM_TINT:${at}`),
        }),
      ),
    ),
    convolution: resolveBloomConvolution(options.convolution),
    dirtMask: resolveBloomDirtMask(options.dirtMask),
  })
}

import { refusal } from './nameMatch.ts'

/**
 * The bloom of a view: the glow that spills around what is bright, a sum of six Gaussian blurs of
 * the image at six scales, added to the linear radiance before its exposure and display curve.
 * Every world starts with it in its effect chain (`world.effects`); removing it, or an intensity
 * of 0, turns it off.
 *
 * The image is brought to half size, then down five more halvings; the blur of each level is
 * as wide as a share of that level's width (its `size` times `sizeScale`, in percent), tinted by
 * its `tint`, and the six are summed from the smallest level up, each added into the next
 * larger one's. The sum is scaled by `intensity / 6` and added to the image: it adds light, it is
 * not a blend. With a `threshold` above −1 only the pixels brighter than it glow, with local
 * exposure on the image the bloom reads has its local exposure applied first.
 */

/** A tint: one number for a grey, or red, green and blue. */
export type BloomTint = number | readonly [red: number, green: number, blue: number]
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
  /** Multiplier of the whole glow: 0 is off, 1 adds the glow at the tints' own strength. */
  intensity?: number
  /** The luminance, in the image's exposed radiance, past which a pixel glows; −1 lets every pixel
   *  glow, in proportion to its radiance. */
  threshold?: number
  /** Multiplier of every level's `size`. */
  sizeScale?: number
  /** The six levels' settings; a level or a field left out keeps its default. */
  levels?: readonly BloomLevelOptions[]
}
/** A level as the engine reads it: every field set. */
export interface ResolvedBloomLevel {
  readonly size: number
  readonly tint: readonly [number, number, number]
}
/** The bloom as the engine reads it: every field set. */
export interface ResolvedBloom {
  readonly intensity: number
  readonly threshold: number
  readonly sizeScale: number
  readonly levels: readonly ResolvedBloomLevel[]
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
 * - `intensity` 0.675: the share of the image's energy the glow adds, 0.675 × the tints' sum
 *   (0.795) over the six levels, about 9 % of the light. Sensitivity: linear — 1.35 doubles the
 *   halo, 0 removes it.
 * - `threshold` −1: no pixel is left out, the physically right glow, which also leaves out the pass
 *   that applies a threshold.
 * - `sizeScale` 4: it keeps the look the level sizes were tuned for when a factor of four was
 *   fixed in the filter.
 * - the levels, finest to widest: sizes 0.3, 1, 2, 10, 30 and 64, tints 0.3465, 0.138, 0.1176,
 *   0.066, 0.066 and 0.061, greys. Each is a look: the wider levels carry less of the glow so that
 *   it falls off smoothly from the bright pixel.
 */
const DEFAULT_BLOOM: ResolvedBloom = Object.freeze({
  intensity: 0.675,
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

const finiteAtLeast = (value: unknown, least: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < least)
    throw new RangeError(`${label}:${String(value)}`)
  return value
}

/** A tint as its three channels, each finite and at least 0. */
function resolveTint(
  tint: BloomTint | undefined,
  fallback: ResolvedBloomLevel['tint'],
  at: number,
): ResolvedBloomLevel['tint'] {
  if (tint === undefined) return fallback
  const channels = typeof tint === 'number' ? [tint, tint, tint] : [...tint]
  if (channels.length !== 3) throw new RangeError(`BLOOM_TINT:${at}`)
  const [red, green, blue] = channels.map((c) => finiteAtLeast(c, 0, `BLOOM_TINT:${at}`))
  return Object.freeze([red, green, blue] as const)
}

/**
 * The bloom an option names: every field it leaves out is the default (`DEFAULT_BLOOM`). The one
 * reading of the option, whoever takes it — `effect.bloom`, the world's own, a setter.
 * @throws RangeError naming the field and the value when one is out of its range, TypeError when
 *   `levels` is not a list of at most six.
 */
export function resolveBloom(options: BloomOptions = {}): ResolvedBloom {
  const { levels = [] } = options
  if (!Array.isArray(levels) || levels.length > BLOOM_LEVEL_COUNT)
    return refusal('bloom')(`levels must list at most ${BLOOM_LEVEL_COUNT} levels`)
  return Object.freeze({
    intensity: finiteAtLeast(options.intensity ?? DEFAULT_BLOOM.intensity, 0, 'BLOOM_INTENSITY'),
    threshold: finiteAtLeast(options.threshold ?? DEFAULT_BLOOM.threshold, -1, 'BLOOM_THRESHOLD'),
    sizeScale: finiteAtLeast(options.sizeScale ?? DEFAULT_BLOOM.sizeScale, 0, 'BLOOM_SIZE_SCALE'),
    levels: Object.freeze(
      DEFAULT_BLOOM.levels.map((level, at) =>
        Object.freeze({
          size: finiteAtLeast(levels[at]?.size ?? level.size, 0, `BLOOM_SIZE:${at}`),
          tint: resolveTint(levels[at]?.tint, level.tint, at),
        }),
      ),
    ),
  })
}

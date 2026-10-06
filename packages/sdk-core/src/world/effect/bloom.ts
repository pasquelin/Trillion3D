import { EffectPass } from './chain.ts'

/** What a page may pass to `effect.bloom`. */
export interface BloomOptions {
  /** Share of the image replaced by its glow, from 0 (none) to 1 (only the glow). */
  intensity?: number
  /** Spread of the glow at every level, in texels of that level; 1 is the filter's own width. */
  radius?: number
}

/**
 * The defaults: a 4 % blend of the glow and a one-texel tent. Neither is read from a scene; both
 * are the page's to change.
 *
 * - radius 1, derived: the factor on the tent's own width, the taps one texel of the level read
 *   apart, so the glow's reach is the level chain's alone (`BLOOM_LEVELS`); and the one spread the
 *   four-tap form of the same kernel serves, four reads instead of nine (`tent4`, `bloomLevel.ts`,
 *   proved in `bloomTent.test.ts`).
 * - intensity 0.04, declared: stands for the share of every pixel's light shown as glow, a look
 *   and not a measure of a lens. Sensitivity: linear, the image keeps `1 − intensity` of its
 *   sharp radiance and the glow gets the rest (`bloomBlend`, `bloomFilter.ts`): 0.08 doubles the
 *   halo and the sharpness it takes, 0 leaves the image as it is, 1 shows only the glow.
 */
const BLOOM_DEFAULTS = { intensity: 0.04, radius: 1 }

const checkIntensity = (value: number) => {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`BLOOM_INTENSITY:${value}`)
  return value
}
const checkRadius = (value: number) => {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`BLOOM_RADIUS:${value}`)
  return value
}

/**
 * Light that spills around what is bright, as a lens spreads it. Physically based: it runs on the
 * scene's linear radiance, before tone mapping, with no threshold, and it conserves energy — the
 * glow is a blurred copy of the image blended in, so the total light stays what it was.
 */
export class Bloom extends EffectPass {
  readonly kind = 'bloom'
  readonly stage = 'before-tone-mapping'
  private blend: number
  private spread: number
  constructor(options: BloomOptions = {}) {
    super()
    this.blend = checkIntensity(options.intensity ?? BLOOM_DEFAULTS.intensity)
    this.spread = checkRadius(options.radius ?? BLOOM_DEFAULTS.radius)
  }
  /** Share of the image replaced by its glow, from 0 to 1. */
  get intensity() {
    return this.blend
  }
  set intensity(value: number) {
    this.blend = checkIntensity(value)
    this.changed()
  }
  /** Spread of the glow at every level, in texels of that level; above 0. */
  get radius() {
    return this.spread
  }
  set radius(value: number) {
    this.spread = checkRadius(value)
    this.changed()
  }
}

import { EffectPass } from './chain.ts'
import {
  resolveBloom,
  type BloomLevelOptions,
  type BloomOptions,
  type ResolvedBloom,
  type ResolvedBloomLevel,
} from '../../contracts/bloomOptions.ts'

export type {
  BloomLevelOptions,
  BloomOptions,
  BloomTint,
  ResolvedBloomLevel,
} from '../../contracts/bloomOptions.ts'

/**
 * Light that spills around what is bright, as a lens spreads it: six Gaussian blurs of the scene's
 * linear radiance at six scales, summed and added to it before exposure and tone mapping
 * (`../../contracts/bloomOptions.ts` says each setting and its default). It adds light rather
 * than moving it: an intensity of 0 draws nothing, and the pass costs nothing then.
 */
export class Bloom extends EffectPass {
  readonly kind = 'bloom'
  readonly stage = 'before-tone-mapping'
  private held: ResolvedBloom
  constructor(options: BloomOptions = {}) {
    super()
    this.held = resolveBloom(options)
  }
  private write(options: BloomOptions) {
    this.held = resolveBloom({ ...this.held, ...options })
    this.changed()
  }
  /** Multiplier of the whole glow, 0 or more; 0 is off. */
  get intensity() {
    return this.held.intensity
  }
  set intensity(value: number) {
    this.write({ intensity: value })
  }
  /** The luminance past which a pixel glows, −1 or more; −1 lets every pixel glow. */
  get threshold() {
    return this.held.threshold
  }
  set threshold(value: number) {
    this.write({ threshold: value })
  }
  /** Multiplier of every level's size, 0 or more. */
  get sizeScale() {
    return this.held.sizeScale
  }
  set sizeScale(value: number) {
    this.write({ sizeScale: value })
  }
  /** The six levels, finest first, each its size and tint; a write takes the fields it names and
   *  leaves the other levels and fields as they are. */
  get levels(): readonly ResolvedBloomLevel[] {
    return this.held.levels
  }
  set levels(value: readonly BloomLevelOptions[]) {
    this.write({ levels: this.held.levels.map((level, at) => ({ ...level, ...value[at] })) })
  }
  /** Nothing to add at an intensity of 0: the engine passes it by. */
  override get idle() {
    return this.held.intensity <= 0
  }
}

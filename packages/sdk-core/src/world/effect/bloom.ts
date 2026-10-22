import { EffectPass } from './chain.ts'
import {
  resolveBloom,
  type BloomLevelOptions,
  type BloomMethod,
  type BloomOptions,
  type ResolvedBloom,
  type ResolvedBloomLevel,
} from '../../contracts/bloomOptions.ts'
import type { BloomConvolutionOptions } from '../../contracts/bloomConvolutionOptions.ts'
import type { BloomDirtMaskOptions } from '../../contracts/bloomDirtOptions.ts'

export type {
  BloomLevelOptions,
  BloomMethod,
  BloomOptions,
  BloomTint,
  ResolvedBloom,
  ResolvedBloomLevel,
} from '../../contracts/bloomOptions.ts'
export type {
  BloomConvolutionOptions,
  BloomKernelImage,
  ResolvedBloomConvolution,
} from '../../contracts/bloomConvolutionOptions.ts'
export type {
  BloomDirtImage,
  BloomDirtMaskOptions,
  ResolvedBloomDirtMask,
} from '../../contracts/bloomDirtOptions.ts'

/**
 * Light that spills around what is bright, as a lens spreads it: six Gaussian blurs of the scene's
 * linear radiance at six scales, summed and added to it before exposure and tone mapping, or a
 * convolution of it with a kernel (`../../contracts/bloomOptions.ts` says each setting and its
 * default; how it is drawn — its quality above all — is the world's settings',
 * `../../contracts/bloomRules.ts`). The Gaussian glow adds light rather than moving it: an
 * intensity of 0 draws nothing, and the pass costs nothing then.
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
  /** How the glow is made: `'gaussian'` or `'convolution'`. */
  get method() {
    return this.held.method
  }
  set method(value: BloomMethod) {
    this.write({ method: value })
  }
  /** Multiplier of the whole glow, 0 or more; 0 is off. */
  get intensity() {
    return this.held.intensity
  }
  set intensity(value: number) {
    this.write({ intensity: value })
  }
  /** Multiplier of the Gaussian glow alone, 0 or more; 0 turns that method off. */
  get gaussianIntensity() {
    return this.held.gaussianIntensity
  }
  set gaussianIntensity(value: number) {
    this.write({ gaussianIntensity: value })
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
  /** The convolution's settings; a write takes the fields it names and leaves the others as they
   *  are. */
  get convolution() {
    return this.held.convolution
  }
  set convolution(value: BloomConvolutionOptions) {
    this.write({ convolution: { ...this.held.convolution, ...value } })
  }
  /** The dirt mask's settings; a write takes the fields it names and leaves the others as they
   *  are. */
  get dirtMask() {
    return this.held.dirtMask
  }
  set dirtMask(value: BloomDirtMaskOptions) {
    this.write({ dirtMask: { ...this.held.dirtMask, ...value } })
  }
  /** Nothing to add at an intensity of 0, or of the method's own: the engine passes it by. */
  override get idle() {
    const { intensity, method, gaussianIntensity, convolution } = this.held
    return (
      intensity <= 0 || (method === 'convolution' ? convolution.intensity : gaussianIntensity) <= 0
    )
  }
}

import { Bloom, type BloomOptions } from './bloom.ts'
import { DepthOfField, type DepthOfFieldOptions } from './depthOfField.ts'
import { MotionBlur, type MotionBlurOptions } from './motionBlur.ts'
import { Outline, type OutlineOptions } from './outline.ts'

export {
  Bloom,
  type BloomConvolutionOptions,
  type BloomDirtImage,
  type BloomDirtMaskOptions,
  type BloomKernelImage,
  type BloomLevelOptions,
  type BloomMethod,
  type BloomOptions,
  type BloomTint,
  type ResolvedBloom,
  type ResolvedBloomConvolution,
  type ResolvedBloomDirtMask,
  type ResolvedBloomLevel,
} from './bloom.ts'
export {
  DepthOfField,
  type DepthOfFieldOptions,
  type MatteBoxFlag,
  type ResolvedDepthOfField,
  type ResolvedMatteBoxFlag,
} from './depthOfField.ts'
export { MotionBlur, type MotionBlurOptions, type ResolvedMotionBlur } from './motionBlur.ts'
export { Outline, type OutlineOptions } from './outline.ts'
export { Blendables, type ChainedBlendable, type WeightedBlendable } from './blendables.ts'
export { EffectChain, EffectPass, type EffectKind, type EffectStage } from './chain.ts'

/** The `effect` family: the passes `world.effects` draws over the image. */
export const effect = {
  /**
   * The blur of a lens: each pixel's depth gives it a circle of confusion and the image is blurred by
   * them, on the lit image before the temporal pass — so ahead of the motion blur, wherever it is added.
   * Off until `focusDistance` is above 0.
   * @param options - `focusDistance`, `aperture`, `bladeCount`, `sensorWidth`…; the defaults when absent.
   */
  depthOfField: (options?: DepthOfFieldOptions) => new DepthOfField(options),
  /**
   * The blur of a moving picture, on the resolved image, ahead of the other passes.
   * @param options - `amount`, `max`, `targetFps` and `cameraMotion`; the defaults when absent.
   */
  motionBlur: (options?: MotionBlurOptions) => new MotionBlur(options),
  /**
   * A glow around what is bright, on the linear image before tone mapping.
   * @param options - `method`, `intensity`, `gaussianIntensity`, `threshold`, `sizeScale`, `levels`,
   *   `convolution` and `dirtMask`; the defaults when absent.
   */
  bloom: (options?: BloomOptions) => new Bloom(options),
  /**
   * A line around the visible silhouette of `objects`, with their subtrees, over the display image.
   * @param options - `objects`, `color` and `thickness` (CSS pixels); the defaults when absent.
   */
  outline: (options?: OutlineOptions) => new Outline(options),
}

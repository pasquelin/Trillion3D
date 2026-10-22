import { Bloom, type BloomOptions } from './bloom.ts'
import { Outline, type OutlineOptions } from './outline.ts'

export {
  Bloom,
  type BloomLevelOptions,
  type BloomOptions,
  type BloomTint,
  type ResolvedBloomLevel,
} from './bloom.ts'
export { Outline, type OutlineOptions } from './outline.ts'
export { EffectChain, EffectPass, type EffectKind, type EffectStage } from './chain.ts'

/** The `effect` family: the passes `world.effects` draws over the image. */
export const effect = {
  /**
   * A glow around what is bright, on the linear image before tone mapping.
   * @param options - `intensity`, `threshold`, `sizeScale` and `levels`; the defaults when absent.
   */
  bloom: (options?: BloomOptions) => new Bloom(options),
  /**
   * A line around the visible silhouette of `objects`, with their subtrees, over the display image.
   * @param options - `objects`, `color` and `thickness` (CSS pixels); the defaults when absent.
   */
  outline: (options?: OutlineOptions) => new Outline(options),
}

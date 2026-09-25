import { Bloom, type BloomOptions } from './bloom.ts';

export { Bloom, type BloomOptions } from './bloom.ts';
export { EffectChain, EffectPass, type EffectKind, type EffectStage } from './chain.ts';

/** The `effect` family: the passes `world.effects` draws over the image. */
export const effect = {
  /**
   * A glow around what is bright, on the linear image before tone mapping.
   * @param options - `intensity` and `radius`; the published values when absent.
   */
  bloom: (options?: BloomOptions) => new Bloom(options),
};

import type { EffectKind } from '../../../sdk-core/src/world/effect/chain.ts';
import { type WebglRenderTarget } from '../webgl/core/renderTarget.ts';
import { type EffectPassOf } from './targets.ts';
import { createWebglBloom } from './webglBloom.ts';

/** One kind of pass on WebGL2: its programs, made with the context, and the resources its passes
 *  share. */
export type WebglEffectKind<P> = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number;
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void;
  /** Draws `pass`, the `nth` of its kind in the chain, from `input` into `output`; returns the
   *  draws made, zero when it cannot draw at this size. */
  draw(pass: P, nth: number, input: WebglRenderTarget, output: WebglRenderTarget): number;
  dispose(): void;
};

export type Kinds = { [K in EffectKind]: WebglEffectKind<EffectPassOf<K>> };

/** Each kind's WebGL2 implementation: the one place a new built-in or a custom pass plugs in. */
export const WEBGL_KINDS: { [K in EffectKind]: (gl: WebGL2RenderingContext) => Kinds[K] } = {
  bloom: createWebglBloom,
};

import { wgslFn } from './decl.ts'

/**
 * Real-number folds and remaps, as the shaders write them (`../scalar/reals.ts` on the processor).
 * WGSL's `%` truncates toward zero, so a period fold is written with `floor`; two spellings of one
 * fold round apart on a device whose division is not exact, and are two declarations.
 */

/** `x` modulo `n` floored, the sign of `n`: `x − n·floor(x/n)`, `floorMod` of the processor. */
export const floorMod = wgslFn(
  'floorMod',
  [],
  'fn floorMod(x:f32,n:f32)->f32{return x-n*floor(x/n);}',
)

/** `x` modulo 2 floored, by a product where `floorMod` divides: `x − 2·floor(x·0.5)`, a mirror's
 *  period. */
export const floorMod2 = wgslFn(
  'floorMod2',
  [],
  'fn floorMod2(x:f32)->f32{return x-2.0*floor(x*0.5);}',
)

/** A unit value to a signed one, `[0, 1]` to `[-1, 1]`: `v·2 − 1`, a stored normal or offset read
 *  back. */
export const unitToSigned2 = wgslFn(
  'unitToSigned2',
  [],
  'fn unitToSigned2(v:vec2f)->vec2f{return v*2.0-1.0;}',
)

/** `unitToSigned2` on three components. */
export const unitToSigned3 = wgslFn(
  'unitToSigned3',
  [],
  'fn unitToSigned3(v:vec3f)->vec3f{return v*2.0-1.0;}',
)

/** A signed value to a unit one, `[-1, 1]` to `[0, 1]`: `v·0.5 + 0.5`, a normal shown as a colour.
 *  On two components it is `ndcToUvUnflipped` (`projection.ts`). */
export const signedToUnit3 = wgslFn(
  'signedToUnit3',
  [],
  'fn signedToUnit3(v:vec3f)->vec3f{return v*0.5+0.5;}',
)

/**
 * Numbers the shader texts read, held once as numbers: a shader names each through its declaration
 * (`shaderConstantsWgsl.ts`), the `f32` nearest it, as `LTC_SIZE` is written where a text reads it.
 * π and its multiples are the maths library's declarations (`packages/math/src/wgsl/constants.ts`).
 */

/** The smoothest roughness a lit surface is shaded at: every shading path clamps to it. */
export const ROUGHNESS_FLOOR = 0.0525

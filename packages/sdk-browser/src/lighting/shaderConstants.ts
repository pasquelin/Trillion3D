import { LTC_SIZE } from '../../../sdk-core/src/lighting/ltcTable.ts'

/**
 * Numbers the shader texts read, held once as numbers: a shader names each through its declaration
 * (`shaderConstantsWgsl.ts`), the `f32` nearest it, as `LTC_SIZE` is written where a text reads it.
 * π and its multiples are the maths library's declarations (`packages/math/src/wgsl/constants.ts`).
 */

/** The smoothest roughness a lit surface is shaded at: every shading path clamps to it, and the
 *  deferred resolve reads a surface at it as a mirror (`../bounce/reflectWgsl.ts`). */
export const ROUGHNESS_FLOOR = 0.0525

/** One roughness sample of the lobe table above the floor, where the mirror term has faded out:
 *  transition resolution, not a rough-lobe filter. */
export const MIRROR_TRANSITION_END = ROUGHNESS_FLOOR + 1 / (LTC_SIZE - 1)

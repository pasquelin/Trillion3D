import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/**
 * Numbers the shader texts write, held once as numbers and written where each text reads them
 * through `wgslF32` (as `LTC_SIZE` already is): no two texts carry two copies of a constant. π and
 * its multiples are the maths library's declarations (`packages/math/src/wgsl/constants.ts`).
 */

/** The smoothest roughness a lit surface is shaded at: every shading path clamps to it, and the
 *  deferred resolve reads a surface at it as a mirror (`../bounce/reflectWgsl.ts`). */
export const ROUGHNESS_FLOOR = 0.0525

/** A 3×3 matrix, nine numbers column after column. */
type Matrix3 = readonly number[]

/** `m` as a WGSL `mat3x3f`, one `vec3f` per column. */
export const wgslMatrix3 = (m: Matrix3) =>
  `mat3x3f(${[0, 3, 6]
    .map(
      (at) =>
        `vec3f(${m
          .slice(at, at + 3)
          .map(wgslF32)
          .join(',')})`,
    )
    .join(',')})`

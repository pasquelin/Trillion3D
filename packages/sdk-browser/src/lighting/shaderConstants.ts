/**
 * Numbers the WGSL and GLSL texts both write, held once as numbers and interpolated where each
 * text reads them (as `LTC_SIZE` already is): two languages never carry two copies of a constant.
 */

/** A number as a float literal both languages read the same: every digit JavaScript keeps, and
 *  never an integer token, which WGSL would type as `i32`. */
export const shaderFloat = (value: number) => {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const PI = shaderFloat(Math.PI);
/** The Lambert normalisation, 1/π. */
export const INVERSE_PI = shaderFloat(1 / Math.PI);
/** The vector form factor's normalisation, 1/(2π) (`direct/rectLightWgsl.ts`). */
export const INVERSE_TWO_PI = shaderFloat(1 / (2 * Math.PI));

/** A 3×3 matrix, nine numbers column after column. */
type Matrix3 = readonly number[];

/** `m` as a WGSL `mat3x3f`, one `vec3f` per column. */
export const wgslMatrix3 = (m: Matrix3) =>
  `mat3x3f(${[0, 3, 6]
    .map(
      (at) =>
        `vec3f(${m
          .slice(at, at + 3)
          .map(shaderFloat)
          .join(',')})`,
    )
    .join(',')})`;

/** `m` as a GLSL `mat3`, column-major like the WGSL one. */
export const glslMatrix3 = (m: Matrix3) => `mat3(${m.map(shaderFloat).join(',')})`;

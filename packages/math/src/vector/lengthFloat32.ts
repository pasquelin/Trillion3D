/** `Math.fround`: one float32 rounding. */

/** The length of `(x, y, z)` in float32 steps, as WGSL's `length()` on f32 operands: each square,
 *  each sum (left to right) and the root rounded to float32. */
export function length3Float32(x: number, y: number, z: number) {
  return Math.fround(
    Math.sqrt(
      Math.fround(Math.fround(Math.fround(x * x) + Math.fround(y * y)) + Math.fround(z * z)),
    ),
  )
}

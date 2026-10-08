/** `Math.fround`: one float32 rounding. */
const f = Math.fround

/** The length of `(x, y, z)` in float32 steps, as WGSL's `length()` on f32 operands: each square,
 *  each sum (left to right) and the root rounded to float32. */
export function length3Float32(x: number, y: number, z: number) {
  return f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))))
}

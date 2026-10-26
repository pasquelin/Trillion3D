/**
 * The first row of the orthonormal frame around the unit axis `(x, y, z)`, with no branch on the
 * axis' direction: a unit vector across it, the one every unoriented frame starts from. The sign of
 * `z` picks the hemisphere's formula, so `1/(s + z)` never divides by less than 1. The processor's
 * twin of the shader's `frameAround` (`../wgsl/basis.ts`), whose second row is `z × x`, and of the
 * Rust core's `vec3::frame_across`.
 */
export function frameAcross<T extends { [i: number]: number }>(
  out: T,
  x: number,
  y: number,
  z: number,
) {
  return frameRows(out, x, y, z, false)
}

/**
 * The first two rows of the orthonormal frame around the unit axis `(x, y, z)`, into `out[0..5]`:
 * `frameAcross` in `out[0..2]`, and the second row, the axis crossed with the first, in
 * `out[3..5]`, with the same hemisphere rule and no branch on the direction. The processor's twin of the shader's
 * `frameAround` (`../wgsl/basis.ts`).
 */
export function frameAround<T extends { [i: number]: number }>(
  out: T,
  x: number,
  y: number,
  z: number,
) {
  return frameRows(out, x, y, z, true)
}

/** The rows of both: the hemisphere's sign and `a = -1/(s + z)` taken once, the first row, and
 *  the second only when `second` asks for it. */
function frameRows<T extends { [i: number]: number }>(
  out: T,
  x: number,
  y: number,
  z: number,
  second: boolean,
) {
  const s = z >= 0 ? 1 : -1
  const a = -1 / (s + z)
  const b = x * y * a
  out[0] = 1 + s * a * x * x
  out[1] = s * b
  out[2] = -s * x
  if (second) {
    out[3] = b
    out[4] = s + a * y * y
    out[5] = -y
  }
  return out
}

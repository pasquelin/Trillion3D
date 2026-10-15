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
  const s = z >= 0 ? 1 : -1
  const a = -1 / (s + z)
  out[0] = 1 + s * a * x * x
  out[1] = s * (x * y * a)
  out[2] = -s * x
  return out
}

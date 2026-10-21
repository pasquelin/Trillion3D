import { clamp } from '../scalar/reals.ts'
// Mathematical oracles and reference algorithms for Trillion3D: pure TypeScript, no DOM
// and no platform dependency.

/**
 * Largest factor by which a 3x3 linear map can stretch a distance: its largest singular value,
 * obtained in closed form from the symmetric matrix A^T A. A rotation reports exactly 1.
 *
 * THE ONE STRETCH every screen error, reach and level of detail goes through: exact for a rotation
 * and a scale, still the stretch under a shear, where a column's length falls below it. NaN for a
 * matrix with a non-finite number or too short, which each caller refuses — never a throw on a
 * frame path. Same formula and same refusal as the GPU's `maxStretchOf` (doubles, all-ones bits)
 * and the Rust core's `linear::max_stretch` (fdlibm's arc cosine and sine there: the last bits may
 * differ).
 *
 * `elements` is a column-major 4x4 as stored by a 3D library, read from `at`: indices 0,1,2 /
 * 4,5,6 / 8,9,10. A row-major 3×4 gives the same value: a matrix and its transpose share their
 * singular values.
 */
export function maxStretch(elements: ArrayLike<number>, at = 0): number {
  if (elements.length < at + 11) return NaN
  const a = elements[at],
    b = elements[at + 4],
    c = elements[at + 8]
  const d = elements[at + 1],
    e = elements[at + 5],
    f = elements[at + 9]
  const g = elements[at + 2],
    h = elements[at + 6],
    i = elements[at + 10]
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(e) ||
    !Number.isFinite(f) ||
    !Number.isFinite(g) ||
    !Number.isFinite(h) ||
    !Number.isFinite(i)
  )
    return NaN
  const m00 = a * a + d * d + g * g,
    m11 = b * b + e * e + h * h,
    m22 = c * c + f * f + i * i
  const m01 = a * b + d * e + g * h,
    m02 = a * c + d * f + g * i,
    m12 = b * c + e * f + h * i
  const offDiagonal = m01 * m01 + m02 * m02 + m12 * m12
  if (offDiagonal <= 0) return Math.sqrt(Math.max(m00, m11, m22, 0))
  const mean = (m00 + m11 + m22) / 3
  const spread = Math.sqrt(
    ((m00 - mean) ** 2 + (m11 - mean) ** 2 + (m22 - mean) ** 2 + 2 * offDiagonal) / 6,
  )
  if (!(spread > 0)) return Math.sqrt(Math.max(mean, 0))
  const b00 = (m00 - mean) / spread,
    b11 = (m11 - mean) / spread,
    b22 = (m22 - mean) / spread
  const b01 = m01 / spread,
    b02 = m02 / spread,
    b12 = m12 / spread
  const determinant =
    b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02)
  const angle = Math.acos(clamp(determinant / 2, -1, 1)) / 3
  return Math.sqrt(Math.max(mean + 2 * spread * Math.cos(angle), 0))
}

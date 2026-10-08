// The transform tests' point arithmetic: a tolerance, a point checked within it, and a point taken
// through a column-major 4x4.
import assert from 'node:assert/strict'

export const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol
export const assertPoint = (got: ArrayLike<number>, want: number[], label: string) => {
  for (let i = 0; i < want.length; i++)
    assert.ok(near(got[i], want[i]), `${label}[${i}]: ${got[i]} vs ${want[i]}`)
}
/** A column-major 4x4 applied to the point `(x, y, z, 1)`, divided by w. */
export function transformPoint(m: ArrayLike<number>, p: number[]) {
  const [x, y, z] = p
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  return [0, 1, 2].map((r) => (m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]) / w)
}

// The `inverseTranspose3` kernel of `inverseTransposeWgsl.ts`, replayed in f32 on the CPU: the same
// order of operations, the same rounding on every product and sum (`Math.fround`), the same guards.
// This is the MODEL — what the shader must compute, not what it computes. What ties it to the text
// the GPU runs is `tests/gpu/math/normal-transform.gpu.ts`, which compares, case by case, this model
// with the shipped shader's output on Dawn; without it the model would be a second implementation,
// free to drift in silence.
//
// Written here rather than in a test: `normalTransform.test.ts` (lighting),
// `packages/sdk-browser/src/gpu/dag/inverseTranspose.test.ts` (selection) and the GPU proof all read
// the same arithmetic, instead of each holding a copy.
import { SINGULAR_DETERMINANT } from '../../../packages/sdk-core/src/math/matrix/singular.ts'
import type { Vec3, Mat3 } from '../kit/vecTypes.ts'

export const f = Math.fround
const cross = (a: Vec3, b: Vec3): Vec3 => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
]
const dot = (a: Vec3, b: Vec3): number => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]))
const divide = (a: Vec3, t: number): Vec3 => [f(a[0] / t), f(a[1] / t), f(a[2] / t)]
const magnitude = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const unit = (a: Vec3): Vec3 => divide(a, magnitude(a))

/** Degrees per radian: the criterion is judged in degrees wherever it is read. */
export const DEG = 180 / Math.PI
/** The dropout: beyond it, a rendered normal is no longer the rotated surface's. */
export const DROPOUT_DEG = 1e-3

/**
 * How far a rendered normal may stray from unit length without being a defect. f32 `normalize`
 * returns `v / length(v)`: each component carries at most half a relative ULP (2⁻²⁴ ≈ 6e-8), the
 * sum of the three squares accumulates about three, the square root takes half of that — a few
 * 1e-7 in all. `1e-6` leaves five times that margin, and stays far from what a zero vector (0), a
 * NaN or an unnormalised normal (here 1e8) would give: it parts rounding from defect.
 */
export const NORM_TOLERANCE = 1e-6

/** A usable direction: three finite components, and not the zero vector. */
const direction = (v: Vec3): boolean =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && magnitude(v) > 0

/**
 * The ORIENTED angle, in radians, between two directions: `atan2` of the cross product over the
 * SIGNED dot product, in f64 and unnormalised. Zero for two identical directions, π for opposite
 * ones.
 *
 * TWO TRAPS THIS WRITING AVOIDS, BOTH OF WHICH IT ONCE LET THROUGH.
 *  — An ABSOLUTE VALUE on the dot product confuses N and −N: a flipped normal — the most common
 *    inverse-transpose defect, a surface lit from behind — was declared right to zero degrees.
 *  — A ZERO or NON-FINITE vector has no direction, and `atan2(0, 0)` is zero: a normal the shader
 *    lost passed as the expected one. The result here is `NaN`, which no `< threshold` accepts.
 * `acos` of the dot product of f32-normalised vectors stays out: it amplifies the norm's rounding
 * (acos(1−ε) ≈ √(2ε), 2e-4 rad for one f32 ULP) and would report a gap between identical vectors.
 */
export function angleBetween(a: Vec3, b: Vec3): number {
  if (!direction(a) || !direction(b)) return NaN
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
}

/**
 * The CRITERION of a rendered normal, as an object rather than a number: direction, norm and
 * threshold are three requirements, and a verdict folding them into an angle lets the first two
 * through. `reason` is `null` when all hold, else it says WHAT failed — the text a failure carries.
 * `gapDeg` is `NaN` as soon as either direction does not exist: never zero, never right by default.
 */
export function normalVerdict(rendered: Vec3, expected: Vec3, dropoutDeg: number) {
  const norm = direction(rendered) ? magnitude(rendered) : NaN
  const gapDeg = angleBetween(rendered, expected) * DEG
  const reason = !direction(rendered)
    ? `rendered normal has no direction: [${rendered}]`
    : !direction(expected)
      ? `expected normal has no direction: [${expected}]`
      : Math.abs(norm - 1) > NORM_TOLERANCE
        ? `norm ${norm} instead of 1 within ${NORM_TOLERANCE}: the normal is not unit`
        : gapDeg < dropoutDeg
          ? null
          : `${gapDeg}° from [${expected}], beyond the ${dropoutDeg}° dropout`
  return { ok: reason === null, gapDeg, norm, reason }
}

/** The upper-left 3×3 of a column-major 4×4 world matrix, as three columns. */
const columns3 = (world: number[]): Mat3 => [
  [world[0], world[1], world[2]],
  [world[4], world[5], world[6]],
  [world[8], world[9], world[10]],
]

/** `mat3x3f(cross(b,c),cross(c,a),cross(a,b)) * v`, in WGSL order: the adjugate's product. */
function adjugateTimes([a, b, c]: Mat3, v: Vec3): Vec3 {
  const [x, y, z] = [cross(b, c), cross(c, a), cross(a, b)]
  return [0, 1, 2].map((k) => f(f(f(x[k] * v[0]) + f(y[k] * v[1])) + f(z[k] * v[2])))
}

/** The form from BEFORE defects 6 and 9, in f32: an absolute `abs(det)<1e-20` on the raw 3×3. */
export function inverseTransposeBefore(m: Mat3, v: Vec3): Vec3 {
  const [a, b, c] = m
  const det = dot(a, cross(b, c))
  if (Math.abs(det) < 1e-20) return v
  return divide(adjugateTimes(m, v), det)
}

/**
 * The shipped kernel, in f32: the 3×3 divided by the sum of its absolute values before the
 * determinant, then the singular convention of `inverseTransposeWgsl.ts`. A zero, infinite or NaN
 * sum: the kernel zeroes the adjugate, so the product is the zero vector. A normalised determinant
 * under the threshold with a non-zero adjugate: the adjugate ALONE, without the `1/(det·t)` that
 * would be ±∞ — the cross product of the transformed edges, to 1/t².
 */
export function inverseTransposeShipped(m: Mat3, v: Vec3): Vec3 {
  const t = m.reduce((s, column) => f(s + column.reduce((k, x) => f(k + Math.abs(x)), 0)), 0)
  if (!(t > 0) || !Number.isFinite(t)) return [0, 0, 0]
  const n = m.map((column) => divide(column, t))
  const det = dot(n[0], cross(n[1], n[2]))
  const adjugate = adjugateTimes(n, v)
  if (!(Math.abs(det) > SINGULAR_DETERMINANT)) return adjugate
  return divide(adjugate, f(det * t))
}

/** The kernel's `uniteOuZero`: `normalize(v)`, but zero for a zero or non-finite vector. */
const unitOrZero = (a: Vec3): Vec3 => (dot(a, a) > 0 ? unit(a) : [0, 0, 0])

/** The lighting shader's `xformNormal(world, n)`: the world 3×3's inverse-transpose applied to the
 *  local normal, then normalised. `world` is the column-major 4×4. */
export const xformNormalModel = (world: number[], n: Vec3): Vec3 =>
  unitOrZero(inverseTransposeShipped(columns3(world), n))

/** The same with the form from before, to say what the defect returned. */
export const xformNormalBefore = (world: number[], n: Vec3): Vec3 =>
  unit(inverseTransposeBefore(columns3(world), n))

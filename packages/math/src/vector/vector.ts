import type { NumberSink } from '../matrix/matrix4.ts'
import { hypot2, hypot3 } from '../float/hypot.ts'

/**
 * 3 and 4 vectors of the math kernel: products and transforms by a column-major 4×4
 * matrix, output passed in. The formulas are the plain closed forms of each product and transform,
 * term by term and in a fixed order, hence the same bits.
 */

/** `a · b` on three components read at `aAt` and `bAt`: one buffer plus an offset, never a view. */
export function dotVector3(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  return a[aAt] * b[bAt] + a[aAt + 1] * b[bAt + 1] + a[aAt + 2] * b[bAt + 2]
}

/** `a · (x, y, z)`, the vector read at `aAt` against three numbers: `dotVector3`'s terms and
 *  order, for a hot loop that holds the second vector in locals. */
export function dotVector3Xyz(a: ArrayLike<number>, x: number, y: number, z: number, aAt = 0) {
  return a[aAt] * x + a[aAt + 1] * y + a[aAt + 2] * z
}

/** `(ax, ay, az) · (bx, by, bz)`: `dotVector3`'s terms and order on six numbers, for a hot loop
 *  that holds both vectors in locals. */
export function dotScalar3(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  return ax * bx + ay * by + az * bz
}

/** `out[at..at + 2] = (ax, ay, az) × (bx, by, bz)`: the one home of the cross product's terms and
 *  order, for `crossVector3` and the callers that hold both vectors in locals. */
export function writeCrossVector3(
  out: NumberSink,
  at: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  out[at] = ay * bz - az * by
  out[at + 1] = az * bx - ax * bz
  out[at + 2] = ax * by - ay * bx
}

/**
 * `out[outAt..outAt + 2] = a × b`, operands read at `aAt` and `bAt`. The six components are read
 * before the first write, so `out` may be `a` or `b`.
 */
export function crossVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  outAt = 0,
  aAt = 0,
  bAt = 0,
) {
  const ax = a[aAt],
    ay = a[aAt + 1],
    az = a[aAt + 2]
  const bx = b[bAt],
    by = b[bAt + 1],
    bz = b[bAt + 2]
  writeCrossVector3(out, outAt, ax, ay, az, bx, by, bz)
  return out
}

/**
 * `out[outOffset..outOffset + 2] = M · (x, y, z, 1)`, without perspective divide: the form of an
 * affine matrix, whose last row is `(0, 0, 0, 1)`. For such a matrix and a finite
 * point, this is bit for bit the projective transform, whose `1 / w` factor is then 1.
 */
export function transformAffinePoint<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z + m[12]
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  return out
}

/**
 * `out[outOffset..outOffset + 3] = M · (x, y, z, 1)`, the four homogeneous components and without
 * divide: the point in clip space when `M` is a view-projection. The caller divides by
 * the fourth, after discarding the one that is zero or non-finite.
 */
export function transformHomogeneousPoint<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  transformAffinePoint(out, m, x, y, z, outOffset)
  out[outOffset + 3] = m[3] * x + m[7] * y + m[11] * z + m[15]
  return out
}

/** The least sum of squares the length rule roots unscaled: from 2^-969 on, the sum is a normal
 *  double whose half ulp is at least 2^-1022, above every square that underflowed, so the plain
 *  root holds the length the squares define. */
export const NORMAL_SQUARES = 2 ** -969

/**
 * Row `row` of `M · (x, y, z, 1)`, `M` column-major from `mAt`: `transformHomogeneousPoint`'s
 * component `row`, its terms and order — one coordinate of a point (a view depth, a clip w) without
 * the other three.
 */
export function transformPointRow(
  m: ArrayLike<number>,
  row: number,
  x: number,
  y: number,
  z: number,
  mAt = 0,
) {
  return m[mAt + row] * x + m[mAt + 4 + row] * y + m[mAt + 8 + row] * z + m[mAt + 12 + row]
}

/** Row `row` of `M · (x, y, z, 0)`, `M` column-major: one coordinate of a direction, the
 *  translation left out, summed as `transformPointRow` sums. */
export function transformDirectionRow(
  m: ArrayLike<number>,
  row: number,
  x: number,
  y: number,
  z: number,
) {
  return m[row] * x + m[4 + row] * y + m[8 + row] * z
}

/**
 * The length of `(x, y, z)`: `Math.sqrt` of the three squares summed left to right, the order of
 * WGSL's `length()`, when that sum is at least `NORMAL_SQUARES` and finite; otherwise — a zero
 * vector, components below about 1e-146 or past about 1e154 — `hypot3`, which scales first and
 * neither underflows nor overflows. A NaN component gives NaN. The one length rule of the engine
 * (docs/MATHS.md "Lengths"); in the normal band it differs from `Math.hypot` in the last bit on
 * many inputs.
 */
export function length3(x: number, y: number, z: number) {
  const s = x * x + y * y + z * z
  return s < NORMAL_SQUARES || s === Infinity ? hypot3(x, y, z) : Math.sqrt(s)
}

/** The plain root `Math.sqrt(x·x + y·y + z·z)`, the squares summed left to right, without
 *  `length3`'s band: past about 1e154 it overflows to Infinity, below about 1e-146 the squares
 *  underflow. The length of the Rust vectors (`length` of `packages/math/rust/src/vec3.rs`), for
 *  the TypeScript twin of a Rust function (docs/MATHS.md "Lengths"). */
export function plainLength3(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z)
}

/** The plain root `Math.sqrt(x·x + y·y)`, the two squares summed, without `length2`'s band: the
 *  length of the Rust plane vectors (`length` of `packages/math/rust/src/vec2.rs`), the twin of
 *  `plainLength3` (docs/MATHS.md "Lengths"). */
export function plainLength2(x: number, y: number) {
  return Math.sqrt(x * x + y * y)
}

/** Writes the point of angle `angle` on the circle of `radius` about the origin, `(radius·cos,
 *  radius·sin)`, to `out[at]` and `out[at + 1]`, and returns `out`. */
export function circlePoint<T extends { [index: number]: number }>(
  out: T,
  radius: number,
  angle: number,
  at = 0,
) {
  out[at] = radius * Math.cos(angle)
  out[at + 1] = radius * Math.sin(angle)
  return out
}

/** The length of `(x, y)`: the rule of `length3` in the plane, `hypot2` outside the band. */
export function length2(x: number, y: number) {
  const s = x * x + y * y
  return s < NORMAL_SQUARES || s === Infinity ? hypot2(x, y) : Math.sqrt(s)
}

/** The z of the 3D cross product of `(ax, ay, 0)` and `(bx, by, 0)`: `ax·by − ay·bx`. */
export function cross2(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

/** The squared distance from the point at `b[bAt]` to the one at `a[aAt]`: the squares of
 *  `a − b`, component by component, summed left to right. */
export function distanceSqVector3(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  const dx = a[aAt] - b[bAt],
    dy = a[aAt + 1] - b[bAt + 1],
    dz = a[aAt + 2] - b[bAt + 2]
  return dx * dx + dy * dy + dz * dz
}

/** The distance between the points at `a[aAt]` and `b[bAt]`: `length3` of `a − b`. */
export function distanceVector3(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  return length3(a[aAt] - b[bAt], a[aAt + 1] - b[bAt + 1], a[aAt + 2] - b[bAt + 2])
}

/** 2^1000: a vector shorter than 2^-1024, whose inverse length overflows, is scaled by it first —
 *  exactly, every component being a multiple of 2^-1074 — and so lands in the normal band. */
const TINY_SCALE = 2 ** 1000

/** Normalises the vector at `at` in place: each component is multiplied by `1 / (length3 || 1)`,
 *  so a zero vector stays zero; a vector shorter than 2^-1024 is first scaled exactly by 2^1000, so
 *  its inverse length does not overflow. */
export function normalizeVector3(v: NumberSink, at = 0) {
  // The rule lives in `writeNormalizedVector3`; the vector is read once into it. The scaled copy of
  // the tiny branch is exact, so holding it in locals rather than in `v` changes no bit.
  writeNormalizedVector3(v, at, v[at], v[at + 1], v[at + 2])
}

/**
 * `normalizeVector3`'s rule on three numbers, written to `out[at..at + 2]`: each multiplied by
 * `1 / (length3 || 1)`, so a zero vector stays zero; one shorter than 2^-1024 is first scaled
 * exactly by 2^1000, so its inverse length does not overflow. The numbers are read once and written
 * once: a caller holding a transformed vector in locals does not write it out to read it back.
 */
export function writeNormalizedVector3(
  out: NumberSink,
  at: number,
  x: number,
  y: number,
  z: number,
) {
  let inverse = 1 / (length3(x, y, z) || 1)
  if (inverse === Infinity) {
    x *= TINY_SCALE
    y *= TINY_SCALE
    z *= TINY_SCALE
    inverse = 1 / length3(x, y, z)
  }
  out[at] = x * inverse
  out[at + 1] = y * inverse
  out[at + 2] = z * inverse
}

/**
 * The vector at `v[vAt]` made unit into `out` at `outAt`, or zero when its squared length is below
 * `minLengthSq`: `sq = x·x + y·y + z·z`, then each component times `1 / Math.sqrt(sq)` — the bits of
 * `normalizeVector3` whenever `sq` is finite and at least both `minLengthSq` and `NORMAL_SQUARES`.
 * The three are read before the first write, so `out` may be `v`. A NaN component compares false
 * against the bound and comes out NaN.
 */
export function normalizeVector3OrZero<T extends NumberSink>(
  out: T,
  v: ArrayLike<number>,
  minLengthSq: number,
  outAt = 0,
  vAt = 0,
) {
  const x = v[vAt],
    y = v[vAt + 1],
    z = v[vAt + 2]
  const sq = x * x + y * y + z * z
  if (sq < minLengthSq) {
    out[outAt] = 0
    out[outAt + 1] = 0
    out[outAt + 2] = 0
    return out
  }
  const s = 1 / Math.sqrt(sq)
  out[outAt] = x * s
  out[outAt + 1] = y * s
  out[outAt + 2] = z * s
  return out
}

/**
 * The signed angle in radians that turns `a` onto `b` about the axis `n`, in `(−π, π]`:
 * `atan2((a × b) · n, a · b)`, the cross product in `crossVector3`'s order and the dot product
 * `dotVector3`'s. Neither vector need be unit; `n` should be, and the sign follows it.
 */
export function signedAngleVector3(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  n: ArrayLike<number>,
  aAt = 0,
  bAt = 0,
  nAt = 0,
) {
  const ax = a[aAt],
    ay = a[aAt + 1],
    az = a[aAt + 2]
  const bx = b[bAt],
    by = b[bAt + 1],
    bz = b[bAt + 2]
  const cx = ay * bz - az * by,
    cy = az * bx - ax * bz,
    cz = ax * by - ay * bx
  return Math.atan2(cx * n[nAt] + cy * n[nAt + 1] + cz * n[nAt + 2], dotVector3(a, b, aAt, bAt))
}

/** `normalizeVector3` in the plane: the two components at `at` multiplied by `1 / (length2 || 1)`,
 *  a vector shorter than 2^-1024 scaled exactly by 2^1000 first. */
export function normalizeVector2(v: NumberSink, at = 0) {
  let inverse = 1 / (length2(v[at], v[at + 1]) || 1)
  if (inverse === Infinity) {
    v[at] *= TINY_SCALE
    v[at + 1] *= TINY_SCALE
    inverse = 1 / length2(v[at], v[at + 1])
  }
  v[at] *= inverse
  v[at + 1] *= inverse
}

/** Brings the vector at `at` to unit length by division, in place and returned: each component is
 *  divided by `length`, which the caller measures. Not `normalizeVector3`'s product by the
 *  reciprocal: for the documents whose published bits hold the quotient (docs/MATHS.md "Lengths"). */
export function divideVector3<T extends NumberSink>(v: T, at: number, length: number) {
  v[at] /= length
  v[at + 1] /= length
  v[at + 2] /= length
  return v
}

/**
 * `out[outAt..outAt + 2] = M · (x, y, z, 1)` for an affine matrix stored row-major on twelve
 * numbers from `mAt` — three rows of four, the translation last in each: the layout of a skinning
 * palette or a proxy's bind map. Each row is summed left to right, then rounded once into `out`;
 * `out` must not be `m`.
 */
export function transformAffinePointRowMajor<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outAt = 0,
  mAt = 0,
) {
  out[outAt] = m[mAt] * x + m[mAt + 1] * y + m[mAt + 2] * z + m[mAt + 3]
  out[outAt + 1] = m[mAt + 4] * x + m[mAt + 5] * y + m[mAt + 6] * z + m[mAt + 7]
  out[outAt + 2] = m[mAt + 8] * x + m[mAt + 9] * y + m[mAt + 10] * z + m[mAt + 11]
  return out
}

/** The squared length of the vector read at `at`: the three squares summed in a fixed order. */
export function lengthSqVector3(v: ArrayLike<number>, at = 0) {
  return v[at] * v[at] + v[at + 1] * v[at + 1] + v[at + 2] * v[at + 2]
}

/** `out.addVectors(a, b)`: `out = a + b` component by component; `out` may be `a` or `b`. */
export function addVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  out[0] = a[0] + b[0]
  out[1] = a[1] + b[1]
  out[2] = a[2] + b[2]
  return out
}

/** `out.subVectors(a, b)`: `out = a - b` component by component; `out` may be `a` or `b`. */
export function subVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  out[0] = a[0] - b[0]
  out[1] = a[1] - b[1]
  out[2] = a[2] - b[2]
  return out
}

/** `v.multiplyScalar(s)`: the three components of `out` multiplied in place. */
export function scaleVector3<T extends NumberSink>(out: T, s: number) {
  out[0] *= s
  out[1] *= s
  out[2] *= s
  return out
}

/** `out.copy(a).multiplyScalar(s)`: `out = a · s` component by component, written at `outAt`, read at `aAt`. */
export function copyScaledVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  s: number,
  outAt = 0,
  aAt = 0,
) {
  out[outAt] = a[aAt] * s
  out[outAt + 1] = a[aAt + 1] * s
  out[outAt + 2] = a[aAt + 2] * s
  return out
}

/** `v.addScaledVector(a, s)`: `out += a · s`, component by component. */
export function addScaledVector3<T extends NumberSink>(out: T, a: ArrayLike<number>, s: number) {
  out[0] += a[0] * s
  out[1] += a[1] * s
  out[2] += a[2] * s
  return out
}

/**
 * `v.applyMatrix3(m)`: `out = M · (x, y, z)`, `m` column-major on nine numbers. The three
 * components are read as parameters, so `out` may be the input vector itself.
 */
export function applyMatrix3Vector3<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  out[0] = m[0] * x + m[3] * y + m[6] * z
  out[1] = m[1] * x + m[4] * y + m[7] * z
  out[2] = m[2] * x + m[5] * y + m[8] * z
  return out
}

/**
 * Applies the 3×3 block of an affine 4×4 matrix to a direction, then normalises it as
 * `normalizeVector3` does (a zero result stays zero). Translation is ignored, as for any direction vector.
 */
export function transformDirectionVector3<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  // A double sink holds each product exactly, so the products stay in locals and are normalised
  // there, read back from nowhere. The first two are still stored as they are made, before the
  // next row of `m` is read: an `out` sharing memory with `m` reads the same entries as before.
  // Any other sink (a `Float32Array`, an integer array) normalises what it rounded on writing.
  if (out instanceof Float64Array || Array.isArray(out)) {
    const px = m[0] * x + m[4] * y + m[8] * z
    out[outOffset] = px
    const py = m[1] * x + m[5] * y + m[9] * z
    out[outOffset + 1] = py
    writeNormalizedVector3(out, outOffset, px, py, m[2] * x + m[6] * y + m[10] * z)
    return out
  }
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z
  normalizeVector3(out, outOffset)
  return out
}

/**
 * Copies `next` over `kept` and says whether every number was already there. `Object.is`
 * decides, so `-0` and `NaN` count as what a calculation would make of them: what a memo
 * keyed on numbers needs, allocation-free.
 */
export function keepNumbers(kept: Float64Array, next: ArrayLike<number>) {
  let same = true
  for (let i = 0; i < kept.length; i++) {
    if (!Object.is(kept[i], next[i])) same = false
    kept[i] = next[i]
  }
  return same
}

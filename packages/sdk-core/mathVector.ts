import type { NumberSink } from './mathMatrix4.ts';

/**
 * 3 and 4 vectors of the math kernel: products and transforms by a column-major 4×4
 * matrix, output passed in. The formulas are those of the reference 3D
 * library, term by term and in the same order, hence the same bits.
 */

/** `a · b` on three components read at `aAt` and `bAt`: one buffer plus an offset, never a view. */
export function dotVector3(a: ArrayLike<number>, b: ArrayLike<number>, aAt = 0, bAt = 0) {
  return a[aAt] * b[bAt] + a[aAt + 1] * b[bAt + 1] + a[aAt + 2] * b[bAt + 2];
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
    az = a[aAt + 2];
  const bx = b[bAt],
    by = b[bAt + 1],
    bz = b[bAt + 2];
  out[outAt] = ay * bz - az * by;
  out[outAt + 1] = az * bx - ax * bz;
  out[outAt + 2] = ax * by - ay * bx;
  return out;
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
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
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
  transformAffinePoint(out, m, x, y, z, outOffset);
  out[outOffset + 3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

/** Reference `v.normalize()`: each component multiplied by `1 / (length || 1)`. */
export function normalizeVector3(v: NumberSink, at = 0) {
  const inverse =
    1 / (Math.sqrt(v[at] * v[at] + v[at + 1] * v[at + 1] + v[at + 2] * v[at + 2]) || 1);
  v[at] *= inverse;
  v[at + 1] *= inverse;
  v[at + 2] *= inverse;
}

/** `v.lengthSq()`: the three squares summed in the reference's order, read at `at`. */
export function lengthSqVector3(v: ArrayLike<number>, at = 0) {
  return v[at] * v[at] + v[at + 1] * v[at + 1] + v[at + 2] * v[at + 2];
}

/** `v.multiplyScalar(s)`: the three components of `out` multiplied in place. */
export function scaleVector3<T extends NumberSink>(out: T, s: number) {
  out[0] *= s;
  out[1] *= s;
  out[2] *= s;
  return out;
}

/** `out.copy(a).multiplyScalar(s)`: `out = a · s` component by component, written at `outAt`, read at `aAt`. */
export function copyScaledVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  s: number,
  outAt = 0,
  aAt = 0,
) {
  out[outAt] = a[aAt] * s;
  out[outAt + 1] = a[aAt + 1] * s;
  out[outAt + 2] = a[aAt + 2] * s;
  return out;
}

/** `v.addScaledVector(a, s)` : `out += a · s`, composante par composante. */
export function addScaledVector3<T extends NumberSink>(out: T, a: ArrayLike<number>, s: number) {
  out[0] += a[0] * s;
  out[1] += a[1] * s;
  out[2] += a[2] * s;
  return out;
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
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

/**
 * `v.transformDirection(m)`: the 3×3 block of an affine 4×4 applied to a direction, then the
 * reference normalisation. Translation is ignored, as for any direction vector.
 */
export function transformDirectionVector3<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z;
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z;
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z;
  normalizeVector3(out, outOffset);
  return out;
}

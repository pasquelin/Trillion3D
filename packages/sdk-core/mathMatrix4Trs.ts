import { determinantMatrix4, type NumberSink } from './mathMatrix4.ts';

/**
 * Position, rotation and scale of a column-major 4×4 matrix, both ways. Quaternion
 * stored `(x, y, z, w)`. Reference formulas, term by term, so the engine hierarchy
 * recomposes the same world matrices as the one it replaces.
 */

export { composeMatrix4 } from './mathMatrix4Compose.ts';

/** The nine rotation terms of the last decomposition, stored by row: read immediately. */
const rotation = new Float64Array(9);

/**
 * Quaternion of a pure rotation matrix, read from its nine terms stored by row, via the
 * largest-diagonal branch. Terms arrive already divided by their column scale.
 */
export function writeRotationQuaternion(out: NumberSink, r: Float64Array) {
  const m11 = r[0],
    m12 = r[1],
    m13 = r[2],
    m21 = r[3],
    m22 = r[4],
    m23 = r[5],
    m31 = r[6],
    m32 = r[7],
    m33 = r[8];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    out[3] = 0.25 / s;
    out[0] = (m32 - m23) * s;
    out[1] = (m13 - m31) * s;
    out[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    out[3] = (m32 - m23) / s;
    out[0] = 0.25 * s;
    out[1] = (m12 + m21) / s;
    out[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    out[3] = (m13 - m31) / s;
    out[0] = (m12 + m21) / s;
    out[1] = 0.25 * s;
    out[2] = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    out[3] = (m21 - m12) / s;
    out[0] = (m13 + m31) / s;
    out[1] = (m23 + m32) / s;
    out[2] = 0.25 * s;
  }
}

/**
 * `m = T · R · S` decomposed into `position`, `quaternion`, `scale`. A column's scale is its
 * length; a negative determinant is carried by the `x` axis alone, whichever axis was reversed at
 * the source. A sheared matrix has no such decomposition: the rotation returned is then that
 * of the column-normalised matrix, and recomposition no longer yields `m` — the bench quantifies
 * this gap, identical to the reference's.
 */
export function decomposeMatrix4(
  m: ArrayLike<number>,
  position: NumberSink,
  quaternion: NumberSink,
  scale: NumberSink,
) {
  let sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  if (determinantMatrix4(m) < 0) sx = -sx;
  position[0] = m[12];
  position[1] = m[13];
  position[2] = m[14];
  const invSX = 1 / sx,
    invSY = 1 / sy,
    invSZ = 1 / sz;
  rotation[0] = m[0] * invSX;
  rotation[1] = m[4] * invSY;
  rotation[2] = m[8] * invSZ;
  rotation[3] = m[1] * invSX;
  rotation[4] = m[5] * invSY;
  rotation[5] = m[9] * invSZ;
  rotation[6] = m[2] * invSX;
  rotation[7] = m[6] * invSY;
  rotation[8] = m[10] * invSZ;
  writeRotationQuaternion(quaternion, rotation);
  scale[0] = sx;
  scale[1] = sy;
  scale[2] = sz;
}

/**
 * `out = [u | v | n | origin]`: the three columns of a basis, then its origin — `makeBasis`
 * followed by `setPosition`. Sixteen stores, the last row `(0, 0, 0, 1)` exactly.
 */
export function basisMatrix4<T extends NumberSink>(
  out: T,
  u: ArrayLike<number>,
  v: ArrayLike<number>,
  n: ArrayLike<number>,
  origin: ArrayLike<number>,
  outAt = 0,
) {
  out[outAt] = u[0];
  out[outAt + 1] = u[1];
  out[outAt + 2] = u[2];
  out[outAt + 3] = 0;
  out[outAt + 4] = v[0];
  out[outAt + 5] = v[1];
  out[outAt + 6] = v[2];
  out[outAt + 7] = 0;
  out[outAt + 8] = n[0];
  out[outAt + 9] = n[1];
  out[outAt + 10] = n[2];
  out[outAt + 11] = 0;
  out[outAt + 12] = origin[0];
  out[outAt + 13] = origin[1];
  out[outAt + 14] = origin[2];
  out[outAt + 15] = 1;
  return out;
}

/** `out` = uniform scale `s` placed at `center` — `makeScale(s, s, s)` followed by `setPosition`.
 *  Sixteen stores, each index a constant: a zeroing loop then the diagonal cost 4% more than Three. */
export function uniformScaleMatrix4<T extends NumberSink>(
  out: T,
  s: number,
  center: ArrayLike<number>,
  outAt = 0,
) {
  out[outAt] = s;
  out[outAt + 1] = 0;
  out[outAt + 2] = 0;
  out[outAt + 3] = 0;
  out[outAt + 4] = 0;
  out[outAt + 5] = s;
  out[outAt + 6] = 0;
  out[outAt + 7] = 0;
  out[outAt + 8] = 0;
  out[outAt + 9] = 0;
  out[outAt + 10] = s;
  out[outAt + 11] = 0;
  out[outAt + 12] = center[0];
  out[outAt + 13] = center[1];
  out[outAt + 14] = center[2];
  out[outAt + 15] = 1;
  return out;
}

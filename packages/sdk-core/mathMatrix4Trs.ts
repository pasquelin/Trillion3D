import { determinantMatrix4, type NumberSink } from './mathMatrix4.ts';

/**
 * Position, rotation and scale of a column-major 4×4 matrix, both ways. Quaternion
 * stored `(x, y, z, w)`. Reference formulas, term by term, so the engine hierarchy
 * recomposes the same world matrices as the one it replaces.
 */

/**
 * `out = T · R · S`. The last row is written `(0, 0, 0, 1)` exactly; quaternion products
 * are doubled by addition (`x + x`), like the reference, never multiplied by two.
 */
export function composeMatrix4<T extends NumberSink>(
  out: T,
  position: ArrayLike<number>,
  quaternion: ArrayLike<number>,
  scale: ArrayLike<number>,
) {
  const x = quaternion[0],
    y = quaternion[1],
    z = quaternion[2],
    w = quaternion[3];
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  const sx = scale[0],
    sy = scale[1],
    sz = scale[2];
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
  return out;
}

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

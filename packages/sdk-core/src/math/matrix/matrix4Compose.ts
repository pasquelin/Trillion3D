import type { NumberSink } from './matrix4.ts';
import { MATRIX_VALUES, POSITION_VALUES, QUATERNION_VALUES } from '../batch/strides.ts';

/**
 * `out = T · R · S`, written at `at`, from a position at `pi`, a quaternion at `qi` and a scale
 * at `si`. The last row is written `(0, 0, 0, 1)` exactly; quaternion products are doubled by
 * addition (`x + x`), never multiplied by two.
 *
 * THE FORMULA LIVES HERE, once: `composeMatrix4` reads it at offset zero and
 * `composeMatrix4Batch` walks it, so the batch cannot drift from the unit function it repeats.
 * A composition runs once per node, not by the thousand like the product, so the computed index
 * `../batch/batch.ts` refuses for `multiplyMatrix4` costs nothing worth measuring here. Exported
 * for a writer that composes straight into a flat buffer of rows (the physics' drawn poses).
 */
export function composeMatrix4At(
  out: NumberSink,
  at: number,
  position: ArrayLike<number>,
  pi: number,
  quaternion: ArrayLike<number>,
  qi: number,
  scale: ArrayLike<number>,
  si: number,
) {
  // A unit quaternion (v, qw), v = (qx, qy, qz), rotates by R = I + 2·qw·[v]× + 2·[v]×²: each
  // entry carries a factor two, taken once on v by an exact addition, t = v + v. The diagonal is
  // 1 − (t_b·v_b + t_c·v_c) over the two other axes; off it, the symmetric part v_a·t_b plus or
  // minus the skew part qw·t_c.
  const qx = quaternion[qi],
    qy = quaternion[qi + 1],
    qz = quaternion[qi + 2],
    qw = quaternion[qi + 3];
  const tx = qx + qx,
    ty = qy + qy,
    tz = qz + qz;
  // Twice the squares, twice the cross products, and the skew part qw·t.
  const sqx = qx * tx,
    sqy = qy * ty,
    sqz = qz * tz;
  const cxy = qx * ty,
    cxz = qx * tz,
    cyz = qy * tz;
  const ax = qw * tx,
    ay = qw * ty,
    az = qw * tz;
  // Column j of R · S is column j of R times the scale along j.
  const s0 = scale[si],
    s1 = scale[si + 1],
    s2 = scale[si + 2];
  out[at] = (1 - (sqy + sqz)) * s0;
  out[at + 1] = (cxy + az) * s0;
  out[at + 2] = (cxz - ay) * s0;
  out[at + 3] = 0;
  out[at + 4] = (cxy - az) * s1;
  out[at + 5] = (1 - (sqx + sqz)) * s1;
  out[at + 6] = (cyz + ax) * s1;
  out[at + 7] = 0;
  out[at + 8] = (cxz + ay) * s2;
  out[at + 9] = (cyz - ax) * s2;
  out[at + 10] = (1 - (sqx + sqy)) * s2;
  out[at + 11] = 0;
  // T only adds the last column: the position, read as it is written.
  out[at + 12] = position[pi];
  out[at + 13] = position[pi + 1];
  out[at + 14] = position[pi + 2];
  out[at + 15] = 1;
}

/** `out = T · R · S`, each input read at its own start. */
export function composeMatrix4<T extends NumberSink>(
  out: T,
  position: ArrayLike<number>,
  quaternion: ArrayLike<number>,
  scale: ArrayLike<number>,
): T {
  composeMatrix4At(out, 0, position, 0, quaternion, 0, scale, 0);
  return out;
}

/**
 * Composes `n` matrices. Two forms, and only two: everything flat, or everything as `n` sub-views
 * — `../batch/batch.ts` explains why a matrix travels as a sub-view. The form is settled BEFORE the
 * loop, never inside it: a ternary per element costs 6% on two hundred thousand compositions,
 * measured by the batch matrices bench.
 *
 * Repeats `composeMatrix4`, over `n` matrices.
 */
export function composeMatrix4Batch(
  out: NumberSink,
  positions: ArrayLike<number>,
  quaternions: ArrayLike<number>,
  scales: ArrayLike<number>,
  n: number,
): void;
export function composeMatrix4Batch(
  out: readonly NumberSink[],
  positions: readonly ArrayLike<number>[],
  quaternions: readonly ArrayLike<number>[],
  scales: readonly ArrayLike<number>[],
  n: number,
): void;
export function composeMatrix4Batch(
  out: NumberSink | readonly NumberSink[],
  positions: ArrayLike<number> | readonly ArrayLike<number>[],
  quaternions: ArrayLike<number> | readonly ArrayLike<number>[],
  scales: ArrayLike<number> | readonly ArrayLike<number>[],
  n: number,
): void {
  if (Array.isArray(out) && typeof positions[0] === 'object') {
    const views = out as readonly NumberSink[],
      p = positions as readonly ArrayLike<number>[],
      q = quaternions as readonly ArrayLike<number>[],
      s = scales as readonly ArrayLike<number>[];
    for (let i = 0; i < n; i++) composeMatrix4At(views[i], 0, p[i], 0, q[i], 0, s[i], 0);
    return;
  }
  const flat = out as NumberSink,
    p = positions as ArrayLike<number>,
    q = quaternions as ArrayLike<number>,
    s = scales as ArrayLike<number>;
  // Position and scale share their stride, so one offset serves both.
  for (let i = 0; i < n; i++) {
    const three = i * POSITION_VALUES;
    composeMatrix4At(flat, i * MATRIX_VALUES, p, three, q, i * QUATERNION_VALUES, s, three);
  }
}

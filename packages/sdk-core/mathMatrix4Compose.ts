import type { NumberSink } from './mathMatrix4.ts';

/** Floats of a position or scale, and of a quaternion `(x, y, z, w)`, stored flat. */
const POSITION_STRIDE = 3;
const QUATERNION_STRIDE = 4;
const MATRIX_STRIDE = 16;

/**
 * `out = T · R · S`, written at `at`, from a position at `pi`, a quaternion at `qi` and a scale
 * at `si`. The last row is written `(0, 0, 0, 1)` exactly; quaternion products are doubled by
 * addition (`x + x`), like the reference, never multiplied by two.
 *
 * THE FORMULA LIVES HERE, once: `composeMatrix4` reads it at offset zero and
 * `composeMatrix4Batch` walks it, so the batch cannot drift from the unit function it repeats.
 * A composition runs once per node, not by the thousand like the product, so the computed index
 * `mathBatch.ts` refuses for `multiplyMatrix4` costs nothing worth measuring here.
 */
function composeAt(
  out: NumberSink,
  at: number,
  position: ArrayLike<number>,
  pi: number,
  quaternion: ArrayLike<number>,
  qi: number,
  scale: ArrayLike<number>,
  si: number,
) {
  const x = quaternion[qi],
    y = quaternion[qi + 1],
    z = quaternion[qi + 2],
    w = quaternion[qi + 3];
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
  const sx = scale[si],
    sy = scale[si + 1],
    sz = scale[si + 2];
  out[at] = (1 - (yy + zz)) * sx;
  out[at + 1] = (xy + wz) * sx;
  out[at + 2] = (xz - wy) * sx;
  out[at + 3] = 0;
  out[at + 4] = (xy - wz) * sy;
  out[at + 5] = (1 - (xx + zz)) * sy;
  out[at + 6] = (yz + wx) * sy;
  out[at + 7] = 0;
  out[at + 8] = (xz + wy) * sz;
  out[at + 9] = (yz - wx) * sz;
  out[at + 10] = (1 - (xx + yy)) * sz;
  out[at + 11] = 0;
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
  composeAt(out, 0, position, 0, quaternion, 0, scale, 0);
  return out;
}

/**
 * Composes `n` matrices. Every argument is read either as one flat buffer of `n` elements or as
 * `n` sub-views — `mathBatch.ts` explains why a matrix travels as a sub-view. The form is settled
 * BEFORE the loop, never inside it: a ternary per element costs 6% on two hundred thousand
 * compositions, measured against Three's own loop by `three-vs-core-batch-matrices.perf.mjs`.
 *
 * Repeats `composeMatrix4`; replaces Three's `for … m.compose(p, q, s)`.
 */
export function composeMatrix4Batch(
  out: NumberSink | readonly NumberSink[],
  positions: ArrayLike<number> | readonly ArrayLike<number>[],
  quaternions: ArrayLike<number> | readonly ArrayLike<number>[],
  scales: ArrayLike<number> | readonly ArrayLike<number>[],
  n: number,
): void {
  const o = Array.isArray(out) ? (out as readonly NumberSink[]) : null;
  const p = Array.isArray(positions) ? (positions as readonly ArrayLike<number>[]) : null;
  const q = Array.isArray(quaternions) ? (quaternions as readonly ArrayLike<number>[]) : null;
  const s = Array.isArray(scales) ? (scales as readonly ArrayLike<number>[]) : null;
  if (!o && !p && !q && !s) {
    const dst = out as NumberSink,
      pf = positions as ArrayLike<number>,
      qf = quaternions as ArrayLike<number>,
      sf = scales as ArrayLike<number>;
    for (let i = 0; i < n; i++) {
      const pi = i * POSITION_STRIDE;
      composeAt(dst, i * MATRIX_STRIDE, pf, pi, qf, i * QUATERNION_STRIDE, sf, pi);
    }
    return;
  }
  if (o && p && q && s) {
    for (let i = 0; i < n; i++) composeAt(o[i], 0, p[i], 0, q[i], 0, s[i], 0);
    return;
  }
  for (let i = 0; i < n; i++) {
    const pi = i * POSITION_STRIDE;
    composeAt(
      o ? o[i] : (out as NumberSink),
      o ? 0 : i * MATRIX_STRIDE,
      p ? p[i] : (positions as ArrayLike<number>),
      p ? 0 : pi,
      q ? q[i] : (quaternions as ArrayLike<number>),
      q ? 0 : i * QUATERNION_STRIDE,
      s ? s[i] : (scales as ArrayLike<number>),
      s ? 0 : pi,
    );
  }
}

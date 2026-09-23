/**
 * 4×4 matrices of the math kernel: free functions on column-major arrays (`m[column ·
 * 4 + row]`), output passed in, no allocation. Product and inverse follow term
 * by term the formulas of the reference 3D library, in the same floating-point
 * operation order: a replaced call yields the same bits. `bench/perf/browser/core-math.perf.ts`
 * proves it, and quantifies the gap where a formula in this repo differs from the reference.
 */

/** What an output accepts: `Float32Array`, `Float64Array` or a plain array. */
export type NumberSink = { [index: number]: number };

/**
 * `out = a · b`. The thirty-two inputs are read before the first write, so `out` may be
 * `a` or `b`. Each term is the sum of four products, with no initial zero: a sum started
 * at `0` would change the sign of a negative zero.
 *
 * ONE BUFFER TYPE ONLY, `Float64Array`, ON INPUT AND OUTPUT. The forty-eight accesses of this
 * body are forty-eight indexed read and write sites, shared by ALL callers:
 * a single caller that passes a `Float32Array` or a plain array makes them polymorphic, and the
 * hot loops — a hierarchy's world matrices, the batches — then pay it on every
 * element. Callers that start from a host-library matrix therefore copy it first
 * into an owned buffer: sixteen numbers copied once per root or distinct matrix, against
 * one polymorphic site for thousands of nodes. Single precision is a SEND conversion:
 * it is done by copying the result into the GPU buffer, never by writing here, and changes
 * no bit — each term is computed in double then rounded once, as before.
 *
 * The sixteen write indices are constants. An output offset as a parameter would make them
 * computed, hence payable of an add and a bounds check each: measured at 6% of the whole
 * product. A caller that composes into a large buffer passes it a subview, or composes aside then
 * copies its sixteen numbers.
 */
export function multiplyMatrix4(out: Float64Array, a: Float64Array, b: Float64Array) {
  const a11 = a[0],
    a12 = a[4],
    a13 = a[8],
    a14 = a[12];
  const a21 = a[1],
    a22 = a[5],
    a23 = a[9],
    a24 = a[13];
  const a31 = a[2],
    a32 = a[6],
    a33 = a[10],
    a34 = a[14];
  const a41 = a[3],
    a42 = a[7],
    a43 = a[11],
    a44 = a[15];
  const b11 = b[0],
    b12 = b[4],
    b13 = b[8],
    b14 = b[12];
  const b21 = b[1],
    b22 = b[5],
    b23 = b[9],
    b24 = b[13];
  const b31 = b[2],
    b32 = b[6],
    b33 = b[10],
    b34 = b[14];
  const b41 = b[3],
    b42 = b[7],
    b43 = b[11],
    b44 = b[15];
  out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return out;
}

/**
 * 4×4 determinant, expanded along the last row like the reference, parentheses and unary
 * signs included. On an affine matrix, the first three terms are `0 · cofactor`.
 */
export function determinantMatrix4(m: ArrayLike<number>) {
  const n11 = m[0],
    n12 = m[4],
    n13 = m[8],
    n14 = m[12];
  const n21 = m[1],
    n22 = m[5],
    n23 = m[9],
    n24 = m[13];
  const n31 = m[2],
    n32 = m[6],
    n33 = m[10],
    n34 = m[14];
  const n41 = m[3],
    n42 = m[7],
    n43 = m[11],
    n44 = m[15];
  return (
    n41 *
      (+n14 * n23 * n32 -
        n13 * n24 * n32 -
        n14 * n22 * n33 +
        n12 * n24 * n33 +
        n13 * n22 * n34 -
        n12 * n23 * n34) +
    n42 *
      (+n11 * n23 * n34 -
        n11 * n24 * n33 +
        n14 * n21 * n33 -
        n13 * n21 * n34 +
        n13 * n24 * n31 -
        n14 * n23 * n31) +
    n43 *
      (+n11 * n24 * n32 -
        n11 * n22 * n34 -
        n14 * n21 * n32 +
        n12 * n21 * n34 +
        n14 * n22 * n31 -
        n12 * n24 * n31) +
    n44 *
      (-n13 * n22 * n31 -
        n11 * n23 * n32 +
        n11 * n22 * n33 +
        n13 * n21 * n32 -
        n12 * n21 * n33 +
        n12 * n23 * n31)
  );
}

/**
 * Determinant of the linear part only (the 3×3 block of columns 0, 1 and 2) of a 4×4 matrix,
 * expanded along the first column. Its sign says whether the transform reverses orientation,
 * hence which face a draw must cull. This is not the expansion of `determinantMatrix4`:
 * the relative gap is a few ulps, and the sign can differ only near a singular
 * matrix, where neither rounding decides. The bench quantifies both.
 */
export function linearPartDeterminant(m: ArrayLike<number>) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/** Column-major identity, read and never written: the pose of a node or a root with no pose. */
export const IDENTITY_MATRIX4: Float64Array = new Float64Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/**
 * Copies the sixteen floats of `m` into `out`, each at its offset. A loop rather than
 * `TypedArray.prototype.set`: on a view, `set` costs a native call, and the outputs are not
 * all typed (host matrices, GPU single-precision buffers — the only conversion, here).
 */
export function copyMatrix4<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  outAt = 0,
  mAt = 0,
) {
  for (let i = 0; i < 16; i++) out[outAt + i] = m[mAt + i];
  return out;
}

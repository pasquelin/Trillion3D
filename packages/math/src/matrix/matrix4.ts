/**
 * 4×4 matrices of the math kernel: free functions on column-major arrays (`m[column ·
 * 4 + row]`), output passed in, no allocation. Product and inverse follow term
 * by term the closed-form formulas (cofactor expansion for the inverse), in a fixed floating-point
 * operation order: the same inputs always yield the same bits. `bench/perf/browser/core-math.perf.ts`
 * proves it, and quantifies the gap where a formula in this repo differs from the closed form.
 */

/** What an output accepts: `Float32Array`, `Float64Array` or a plain array. */
export type NumberSink = { [index: number]: number }

/**
 * `out = a · b`. The sixteen values of `a` are read before the first write, and each column of `b`
 * before its column of `out` is written, which reads no other column of `b`: so `out` may be `a`
 * or `b`. Each term is the sum of four products, with no initial zero: a sum started at `0` would
 * change the sign of a negative zero.
 *
 * ONE BUFFER TYPE ONLY, `Float64Array`, ON INPUT AND OUTPUT. The forty-eight accesses of this
 * body are forty-eight indexed read and write sites, shared by ALL callers:
 * a single caller that passes a `Float32Array` or a plain array makes them polymorphic, and the
 * hot loops — a hierarchy's world matrices, the batches — then pay it on every
 * element. Callers that start from a host matrix therefore copy it first
 * into an owned buffer: sixteen numbers copied once per root or distinct matrix, against
 * one polymorphic site for thousands of nodes. Single precision is a SEND conversion:
 * it is done by copying the result into the GPU buffer, never by writing here, and changes
 * no bit — each term is computed in double then rounded once.
 *
 * The sixteen write indices are constants. An output offset as a parameter would make them
 * computed, hence payable of an add and a bounds check each: measured at 6% of the whole
 * product. A caller that composes into a large buffer passes it a subview, or composes aside then
 * copies its sixteen numbers. `b` is read one column at a time into four locals, and that column of
 * `out` is written before the next is read.
 */
export function multiplyMatrix4(out: Float64Array, a: Float64Array, b: Float64Array) {
  const a11 = a[0],
    a12 = a[4],
    a13 = a[8],
    a14 = a[12]
  const a21 = a[1],
    a22 = a[5],
    a23 = a[9],
    a24 = a[13]
  const a31 = a[2],
    a32 = a[6],
    a33 = a[10],
    a34 = a[14]
  const a41 = a[3],
    a42 = a[7],
    a43 = a[11],
    a44 = a[15]
  let b0 = b[0],
    b1 = b[1],
    b2 = b[2],
    b3 = b[3]
  out[0] = a11 * b0 + a12 * b1 + a13 * b2 + a14 * b3
  out[1] = a21 * b0 + a22 * b1 + a23 * b2 + a24 * b3
  out[2] = a31 * b0 + a32 * b1 + a33 * b2 + a34 * b3
  out[3] = a41 * b0 + a42 * b1 + a43 * b2 + a44 * b3
  b0 = b[4]
  b1 = b[5]
  b2 = b[6]
  b3 = b[7]
  out[4] = a11 * b0 + a12 * b1 + a13 * b2 + a14 * b3
  out[5] = a21 * b0 + a22 * b1 + a23 * b2 + a24 * b3
  out[6] = a31 * b0 + a32 * b1 + a33 * b2 + a34 * b3
  out[7] = a41 * b0 + a42 * b1 + a43 * b2 + a44 * b3
  b0 = b[8]
  b1 = b[9]
  b2 = b[10]
  b3 = b[11]
  out[8] = a11 * b0 + a12 * b1 + a13 * b2 + a14 * b3
  out[9] = a21 * b0 + a22 * b1 + a23 * b2 + a24 * b3
  out[10] = a31 * b0 + a32 * b1 + a33 * b2 + a34 * b3
  out[11] = a41 * b0 + a42 * b1 + a43 * b2 + a44 * b3
  b0 = b[12]
  b1 = b[13]
  b2 = b[14]
  b3 = b[15]
  out[12] = a11 * b0 + a12 * b1 + a13 * b2 + a14 * b3
  out[13] = a21 * b0 + a22 * b1 + a23 * b2 + a24 * b3
  out[14] = a31 * b0 + a32 * b1 + a33 * b2 + a34 * b3
  out[15] = a41 * b0 + a42 * b1 + a43 * b2 + a44 * b3
  return out
}

/**
 * Determinant of a column-major 4×4 matrix, expanded along the last row in a fixed order of
 * terms and signs; 0 for a singular matrix. On an affine matrix, the first three terms are `0 · cofactor`.
 */
export function determinantMatrix4(m: ArrayLike<number>) {
  const n11 = m[0],
    n12 = m[4],
    n13 = m[8],
    n14 = m[12]
  const n21 = m[1],
    n22 = m[5],
    n23 = m[9],
    n24 = m[13]
  const n31 = m[2],
    n32 = m[6],
    n33 = m[10],
    n34 = m[14]
  const n41 = m[3],
    n42 = m[7],
    n43 = m[11],
    n44 = m[15]
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
  )
}

/**
 * Determinant of the linear part only (the 3×3 block of columns 0, 1 and 2) of a 4×4 matrix,
 * expanded along the first column. Its sign says whether the transform reverses orientation,
 * hence which face a draw must cull. This is not the expansion of `determinantMatrix4`:
 * the relative gap is a few ulps, and the sign can differ only near a singular
 * matrix, where neither rounding decides. The bench quantifies both.
 */
export function linearPartDeterminant(m: ArrayLike<number>) {
  // Nine reads, each once, then the same expression in the same order.
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10]
  return m0 * (m5 * m10 - m6 * m9) - m1 * (m4 * m10 - m6 * m8) + m2 * (m4 * m9 - m5 * m8)
}

/** Column-major identity, read and never written: the pose of a node or a root with no pose. */
export const IDENTITY_MATRIX4: Float64Array = new Float64Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])

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
  // The loop unrolled: each value read just before its own write, in ascending order, so a copy
  // within one buffer at overlapping offsets yields what the loop did.
  out[outAt] = m[mAt]
  out[outAt + 1] = m[mAt + 1]
  out[outAt + 2] = m[mAt + 2]
  out[outAt + 3] = m[mAt + 3]
  out[outAt + 4] = m[mAt + 4]
  out[outAt + 5] = m[mAt + 5]
  out[outAt + 6] = m[mAt + 6]
  out[outAt + 7] = m[mAt + 7]
  out[outAt + 8] = m[mAt + 8]
  out[outAt + 9] = m[mAt + 9]
  out[outAt + 10] = m[mAt + 10]
  out[outAt + 11] = m[mAt + 11]
  out[outAt + 12] = m[mAt + 12]
  out[outAt + 13] = m[mAt + 13]
  out[outAt + 14] = m[mAt + 14]
  out[outAt + 15] = m[mAt + 15]
  return out
}

/** `out = m` with column `c` negated, `m · diag(…, −1 at c, …)`: a flip of one input axis, such
 *  as a view looking down +z made from one looking down −z. `out` may be `m`; negation is exact,
 *  so a float32 `out` holds the negated float32 of each number. */
export function negateColumnMatrix4<T extends NumberSink>(out: T, m: ArrayLike<number>, c: number) {
  // One pass: the sixteen values read first, then each written once, negated if it lies in
  // column `c`. Negation is exact, so the bits are those of the copy then negate it replaces.
  // The sixteen reads `transposeMatrix4` also spells out: a shared reader would hand them back
  // through memory, not registers.
  // jscpd:ignore-start
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15]
  // jscpd:ignore-end
  const c0 = c === 0,
    c1 = c === 1,
    c2 = c === 2,
    c3 = c === 3
  out[0] = c0 ? -m0 : m0
  out[1] = c0 ? -m1 : m1
  out[2] = c0 ? -m2 : m2
  out[3] = c0 ? -m3 : m3
  out[4] = c1 ? -m4 : m4
  out[5] = c1 ? -m5 : m5
  out[6] = c1 ? -m6 : m6
  out[7] = c1 ? -m7 : m7
  out[8] = c2 ? -m8 : m8
  out[9] = c2 ? -m9 : m9
  out[10] = c2 ? -m10 : m10
  out[11] = c2 ? -m11 : m11
  out[12] = c3 ? -m12 : m12
  out[13] = c3 ? -m13 : m13
  out[14] = c3 ? -m14 : m14
  out[15] = c3 ? -m15 : m15
  return out
}

/** `out = m` with row `r` negated, `diag(…, −1 at r, …) · m`: a flip of one output axis, its four
 *  entries one per column. `out` may be `m`; negation is exact. */
export function negateRowMatrix4<T extends NumberSink>(out: T, m: ArrayLike<number>, r: number) {
  // One pass, as `negateColumnMatrix4`: each value written once, negated if it lies in row `r`.
  // The sixteen reads, as in `transposeMatrix4`.
  // jscpd:ignore-start
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15]
  // jscpd:ignore-end
  const r0 = r === 0,
    r1 = r === 1,
    r2 = r === 2,
    r3 = r === 3
  out[0] = r0 ? -m0 : m0
  out[1] = r1 ? -m1 : m1
  out[2] = r2 ? -m2 : m2
  out[3] = r3 ? -m3 : m3
  out[4] = r0 ? -m4 : m4
  out[5] = r1 ? -m5 : m5
  out[6] = r2 ? -m6 : m6
  out[7] = r3 ? -m7 : m7
  out[8] = r0 ? -m8 : m8
  out[9] = r1 ? -m9 : m9
  out[10] = r2 ? -m10 : m10
  out[11] = r3 ? -m11 : m11
  out[12] = r0 ? -m12 : m12
  out[13] = r1 ? -m13 : m13
  out[14] = r2 ? -m14 : m14
  out[15] = r3 ? -m15 : m15
  return out
}

/** `out = mᵀ`: `out[c · 4 + r] = m[r · 4 + c]`. Each mirrored pair is read before it is written,
 *  so `out` may be `m`. */
export function transposeMatrix4<T extends NumberSink>(out: T, m: ArrayLike<number>) {
  // The sixteen values read first, then sixteen writes at constant offsets. The reads are spelled
  // out as wherever the kernel holds a whole matrix in registers (`boxTransform` among them).
  // jscpd:ignore-start
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15]
  // jscpd:ignore-end
  out[0] = m0
  out[1] = m4
  out[2] = m8
  out[3] = m12
  out[4] = m1
  out[5] = m5
  out[6] = m9
  out[7] = m13
  out[8] = m2
  out[9] = m6
  out[10] = m10
  out[11] = m14
  out[12] = m3
  out[13] = m7
  out[14] = m11
  out[15] = m15
  return out
}

/**
 * A bound on how much the linear part (the upper 3×3) of the matrix at `at` stretches a vector:
 * `√(‖L‖₁ · ‖L‖∞)`, the largest absolute row sum times the largest absolute column sum, never below
 * the true norm. Read column-major, `rows` gathers `m[at + a]`, `m[at + a + 4]`, `m[at + a + 8]`
 * and `columns` `m[at + 4a]`… ; on a row-major 3×4 the two names swap and, the product commuting,
 * the bound is the same bits. The maxima start from 0.
 */
export function linearStretchBound(m: ArrayLike<number>, at = 0) {
  let rows = 0,
    columns = 0
  for (let a = 0; a < 3; a++) {
    rows = Math.max(rows, Math.abs(m[at + a]) + Math.abs(m[at + a + 4]) + Math.abs(m[at + a + 8]))
    columns = Math.max(
      columns,
      Math.abs(m[at + 4 * a]) + Math.abs(m[at + 4 * a + 1]) + Math.abs(m[at + 4 * a + 2]),
    )
  }
  return Math.sqrt(rows * columns)
}

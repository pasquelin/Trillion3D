/** A copy of the input, for an inverse written over the matrix it inverts. */
const held = /* @__PURE__ */ new Float64Array(16)

/** The products `a_x · b_y` of two rows' entries, `products[4x + y]`, for `x ≠ y`. */
const products = /* @__PURE__ */ new Float64Array(16)

/**
 * The four cofactors of three rows of `m` (the rows' first entries, `m[a + 4k]` their k-th, `c` the
 * lower), `out[at + d]` for the column `d` left out: the 3×3 minor of the other three columns
 * `i < j < k`, six terms each taking one entry from each row, the two upper ones multiplied first,
 * summed in this one fixed order — floating-point addition is not associative, so the order is part of
 * the output's bits. The rows below the first of an ordering carry one sign pattern, `lower`, the
 * others the opposite; the sign alternates with `d`.
 */
function writeCofactors(
  out: Float64Array,
  at: number,
  m: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  lower: boolean,
) {
  for (let x = 0; x < 4; x++) {
    const ax = m[a + 4 * x]
    for (let y = 0; y < 4; y++) if (y !== x) products[4 * x + y] = ax * m[b + 4 * y]
  }
  for (let d = 0; d < 4; d++) {
    const i = d === 0 ? 1 : 0
    const j = d <= 1 ? 2 : 1
    const k = d === 3 ? 2 : 3
    const u = lower === (d % 2 === 0) ? 1 : -1
    const ci = m[c + 4 * i],
      cj = m[c + 4 * j],
      ck = m[c + 4 * k]
    let v = u * (products[4 * j + k] * ci) - u * (products[4 * k + j] * ci)
    v += u * (products[4 * k + i] * cj)
    v -= u * (products[4 * i + k] * cj)
    v -= u * (products[4 * j + i] * ck)
    v += u * (products[4 * i + j] * ck)
    out[at + d] = v
  }
}

/**
 * `out = m⁻¹` by cofactors. An exactly zero determinant yields the zero matrix: the caller that
 * must distinguish this case tests the determinant, never the output. It is an exact zero
 * determinant that sets this threshold, not the engine singularity rule (`singular.ts`), which only
 * applies where a normal is transported. The sixteen inputs are read before the first write, so
 * `out` may be `m`.
 *
 * The output is an owned `Float64Array`, like that of the product: an inverse is an input to a
 * product, and both must write into the same buffer type. The input remains an arbitrary read — a
 * host matrix is inverted once per frame, where the product runs by the thousand.
 */
export function invertMatrix4(out: Float64Array, input: ArrayLike<number>) {
  // The cofactors are read after the first entries are written: an `out` that is the input reads a copy.
  let m = input
  if (out === input || (ArrayBuffer.isView(input) && input.buffer === out.buffer)) {
    held.set(input)
    m = held
  }
  // Entry (row i, column j) of the inverse is the cofactor of entry (row j, column i) of `m` over
  // the determinant: the 3×3 minor left by deleting row j and column i, signed + where i + j is
  // even. Rows x, y, z, w of `m`; the digit is the column: `m[4 · column + row]`. The cofactors are
  // written whole, then scaled by the determinant's inverse, read from the four of column 0; an
  // exactly singular matrix gives zeros.
  writeCofactors(out, 0, m, 1, 2, 3, true)
  writeCofactors(out, 4, m, 0, 2, 3, false)
  writeCofactors(out, 8, m, 0, 1, 3, true)
  writeCofactors(out, 12, m, 0, 1, 2, false)
  const determinant = m[0] * out[0] + m[1] * out[4] + m[2] * out[8] + m[3] * out[12]
  if (determinant === 0) return out.fill(0, 0, 16)
  const r = 1 / determinant
  for (let n = 0; n < 16; n++) out[n] *= r
  return out
}

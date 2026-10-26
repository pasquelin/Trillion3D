/** A copy of the input, for an inverse written over the matrix it inverts. */
const held = /* @__PURE__ */ new Float64Array(16)

function cofactorX(m: ArrayLike<number>) {
  const y1 = m[5],
    y2 = m[9],
    y3 = m[13],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15]
  const yz12 = y1 * z2
  const yz13 = y1 * z3
  const yz21 = y2 * z1
  const yz23 = y2 * z3
  const yz31 = y3 * z1
  const yz32 = y3 * z2
  return yz23 * w1 - yz32 * w1 + yz31 * w2 - yz13 * w2 - yz21 * w3 + yz12 * w3
}

function cofactorY(m: ArrayLike<number>) {
  const x1 = m[4],
    x2 = m[8],
    x3 = m[12],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15]
  const xz12 = x1 * z2
  const xz13 = x1 * z3
  const xz21 = x2 * z1
  const xz23 = x2 * z3
  const xz31 = x3 * z1
  const xz32 = x3 * z2
  return xz32 * w1 - xz23 * w1 - xz31 * w2 + xz13 * w2 + xz21 * w3 - xz12 * w3
}

function cofactorZ(m: ArrayLike<number>) {
  const x1 = m[4],
    x2 = m[8],
    x3 = m[12],
    y1 = m[5],
    y2 = m[9],
    y3 = m[13],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15]
  const xy12 = x1 * y2
  const xy13 = x1 * y3
  const xy21 = x2 * y1
  const xy23 = x2 * y3
  const xy31 = x3 * y1
  const xy32 = x3 * y2
  return xy23 * w1 - xy32 * w1 + xy31 * w2 - xy13 * w2 - xy21 * w3 + xy12 * w3
}

function cofactorW(m: ArrayLike<number>) {
  const x1 = m[4],
    x2 = m[8],
    x3 = m[12],
    y1 = m[5],
    y2 = m[9],
    y3 = m[13],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14]
  const xy12 = x1 * y2
  const xy13 = x1 * y3
  const xy21 = x2 * y1
  const xy23 = x2 * y3
  const xy31 = x3 * y1
  const xy32 = x3 * y2
  return xy32 * z1 - xy23 * z1 - xy31 * z2 + xy13 * z2 + xy21 * z3 - xy12 * z3
}

/**
 * Three entries of the inverse, `out[at]` to `out[at + 2]`: the minors of two rows `a` and `b` of `m`
 * (the rows' first entries, `m[a + 4k]` their k-th) against a third, `c`. The minors of the rows below
 * the first of an ordering carry one sign pattern, `lower`, the others the opposite (entries 1 to 3 and
 * 9 to 11 are of the first kind, 5 to 7 and 13 to 15 of the second).
 */
function writeMinors(
  out: Float64Array,
  at: number,
  m: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  r: number,
  lower: boolean,
) {
  const a0 = m[a],
    a1 = m[a + 4],
    a2 = m[a + 8],
    a3 = m[a + 12],
    b0 = m[b],
    b1 = m[b + 4],
    b2 = m[b + 8],
    b3 = m[b + 12],
    c0 = m[c],
    c1 = m[c + 4],
    c2 = m[c + 8],
    c3 = m[c + 12]
  const ab12 = a1 * b2
  const ab13 = a1 * b3
  const ab21 = a2 * b1
  const ab23 = a2 * b3
  const ab31 = a3 * b1
  const ab32 = a3 * b2
  const ab01 = a0 * b1
  const ab02 = a0 * b2
  const ab03 = a0 * b3
  const ab10 = a1 * b0
  const ab20 = a2 * b0
  const ab30 = a3 * b0
  if (lower) {
    out[at] = (ab32 * c0 - ab23 * c0 - ab30 * c2 + ab03 * c2 + ab20 * c3 - ab02 * c3) * r
    out[at + 1] = (ab13 * c0 - ab31 * c0 + ab30 * c1 - ab03 * c1 - ab10 * c3 + ab01 * c3) * r
    out[at + 2] = (ab21 * c0 - ab12 * c0 - ab20 * c1 + ab02 * c1 + ab10 * c2 - ab01 * c2) * r
  } else {
    out[at] = (ab23 * c0 - ab32 * c0 + ab30 * c2 - ab03 * c2 - ab20 * c3 + ab02 * c3) * r
    out[at + 1] = (ab31 * c0 - ab13 * c0 - ab30 * c1 + ab03 * c1 + ab10 * c3 - ab01 * c3) * r
    out[at + 2] = (ab12 * c0 - ab21 * c0 + ab20 * c1 - ab02 * c1 - ab10 * c2 + ab01 * c2) * r
  }
}

/** Entries 1 to 3 of the inverse: the minors of rows y and z, lower row w. */
function writeColumnsYz(out: Float64Array, m: ArrayLike<number>, r: number) {
  writeMinors(out, 1, m, 1, 2, 3, r, true)
}

/** Entries 5 to 7 of the inverse: the minors of rows x and z, lower row w. */
function writeColumnsXz(out: Float64Array, m: ArrayLike<number>, r: number) {
  writeMinors(out, 5, m, 0, 2, 3, r, false)
}

/** Entries 9 to 11 (lower row w) and 13 to 15 (lower row z) of the inverse: the minors of rows x
 *  and y. */
function writeColumnsXy(out: Float64Array, m: ArrayLike<number>, r: number) {
  writeMinors(out, 9, m, 0, 1, 3, r, true)
  writeMinors(out, 13, m, 0, 1, 2, r, false)
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
  // even. Each of its six terms takes one entry from each of the minor's three rows, multiplies
  // the two upper ones first, then the lower one. The six terms of a cofactor are summed in a
  // fixed order, one per checkerboard sign: floating-point addition is not associative, and that
  // order is part of the output's bits. Rows x, y, z, w of `m`; the digit is the column:
  // `m[4 · column + row]`. The four cofactors of column 0 first: all the determinant needs, and an
  // exactly singular matrix stops there.
  const cx = cofactorX(m)
  const cy = cofactorY(m)
  const cz = cofactorZ(m)
  const cw = cofactorW(m)
  const determinant = m[0] * cx + m[1] * cy + m[2] * cz + m[3] * cw
  if (determinant === 0) return out.fill(0, 0, 16)
  const r = 1 / determinant
  out[0] = cx * r
  out[4] = cy * r
  out[8] = cz * r
  out[12] = cw * r
  writeColumnsYz(out, m, r)
  writeColumnsXz(out, m, r)
  writeColumnsXy(out, m, r)
  return out
}

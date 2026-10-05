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
export function invertMatrix4(out: Float64Array, m: ArrayLike<number>) {
  // Entry (row i, column j) of the inverse is the cofactor of entry (row j, column i) of `m` over
  // the determinant: the 3×3 minor left by deleting row j and column i, signed + where i + j is
  // even. Each of its six terms takes one entry from each of the minor's three rows, multiplies
  // the two upper ones first, then the lower one. A product of two upper entries depends only on
  // their rows and columns, so it is computed once for every minor that keeps those two rows: 36
  // shared products, then one multiplication per term, 96 terms. The six terms of a cofactor are
  // summed in a fixed order, one per checkerboard sign: floating-point addition is not
  // associative, and that order is part of the output's bits.
  // Rows x, y, z, w of `m`; the digit is the column: `m[4 · column + row]`.
  const x0 = m[0],
    y0 = m[1],
    z0 = m[2],
    w0 = m[3];
  const x1 = m[4],
    y1 = m[5],
    z1 = m[6],
    w1 = m[7];
  const x2 = m[8],
    y2 = m[9],
    z2 = m[10],
    w2 = m[11];
  const x3 = m[12],
    y3 = m[13],
    z3 = m[14],
    w3 = m[15];
  // `yz12` is y1 · z2: rows y and z, columns 1 and 2. The products between columns 1, 2 and 3
  // come first: they are all the determinant needs, and an exactly singular matrix stops there.
  const yz12 = y1 * z2;
  const yz13 = y1 * z3;
  const yz21 = y2 * z1;
  const yz23 = y2 * z3;
  const yz31 = y3 * z1;
  const yz32 = y3 * z2;
  const xz12 = x1 * z2;
  const xz13 = x1 * z3;
  const xz21 = x2 * z1;
  const xz23 = x2 * z3;
  const xz31 = x3 * z1;
  const xz32 = x3 * z2;
  const xy12 = x1 * y2;
  const xy13 = x1 * y3;
  const xy21 = x2 * y1;
  const xy23 = x2 * y3;
  const xy31 = x3 * y1;
  const xy32 = x3 * y2;
  // Cofactors of column 0's four entries, then the determinant expanded along that column.
  const cx = yz23 * w1 - yz32 * w1 + yz31 * w2 - yz13 * w2 - yz21 * w3 + yz12 * w3;
  const cy = xz32 * w1 - xz23 * w1 - xz31 * w2 + xz13 * w2 + xz21 * w3 - xz12 * w3;
  const cz = xy23 * w1 - xy32 * w1 + xy31 * w2 - xy13 * w2 - xy21 * w3 + xy12 * w3;
  const cw = xy32 * z1 - xy23 * z1 - xy31 * z2 + xy13 * z2 + xy21 * z3 - xy12 * z3;
  const determinant = x0 * cx + y0 * cy + z0 * cz + w0 * cw;
  if (determinant === 0) return out.fill(0, 0, 16);
  const yz01 = y0 * z1;
  const yz02 = y0 * z2;
  const yz03 = y0 * z3;
  const yz10 = y1 * z0;
  const yz20 = y2 * z0;
  const yz30 = y3 * z0;
  const xz01 = x0 * z1;
  const xz02 = x0 * z2;
  const xz03 = x0 * z3;
  const xz10 = x1 * z0;
  const xz20 = x2 * z0;
  const xz30 = x3 * z0;
  const xy01 = x0 * y1;
  const xy02 = x0 * y2;
  const xy03 = x0 * y3;
  const xy10 = x1 * y0;
  const xy20 = x2 * y0;
  const xy30 = x3 * y0;
  const r = 1 / determinant;
  // Column j of the inverse: the minors without row j of `m`, lower row w, then z for j = 3.
  out[0] = cx * r;
  out[1] = (yz32 * w0 - yz23 * w0 - yz30 * w2 + yz03 * w2 + yz20 * w3 - yz02 * w3) * r;
  out[2] = (yz13 * w0 - yz31 * w0 + yz30 * w1 - yz03 * w1 - yz10 * w3 + yz01 * w3) * r;
  out[3] = (yz21 * w0 - yz12 * w0 - yz20 * w1 + yz02 * w1 + yz10 * w2 - yz01 * w2) * r;
  out[4] = cy * r;
  out[5] = (xz23 * w0 - xz32 * w0 + xz30 * w2 - xz03 * w2 - xz20 * w3 + xz02 * w3) * r;
  out[6] = (xz31 * w0 - xz13 * w0 - xz30 * w1 + xz03 * w1 + xz10 * w3 - xz01 * w3) * r;
  out[7] = (xz12 * w0 - xz21 * w0 + xz20 * w1 - xz02 * w1 - xz10 * w2 + xz01 * w2) * r;
  out[8] = cz * r;
  out[9] = (xy32 * w0 - xy23 * w0 - xy30 * w2 + xy03 * w2 + xy20 * w3 - xy02 * w3) * r;
  out[10] = (xy13 * w0 - xy31 * w0 + xy30 * w1 - xy03 * w1 - xy10 * w3 + xy01 * w3) * r;
  out[11] = (xy21 * w0 - xy12 * w0 - xy20 * w1 + xy02 * w1 + xy10 * w2 - xy01 * w2) * r;
  out[12] = cw * r;
  out[13] = (xy23 * z0 - xy32 * z0 + xy30 * z2 - xy03 * z2 - xy20 * z3 + xy02 * z3) * r;
  out[14] = (xy31 * z0 - xy13 * z0 - xy30 * z1 + xy03 * z1 + xy10 * z3 - xy01 * z3) * r;
  out[15] = (xy12 * z0 - xy21 * z0 + xy20 * z1 - xy02 * z1 - xy10 * z2 + xy01 * z2) * r;
  return out;
}

/** 4×4 and 3×3 matrices, and the singularity rule the normal matrix follows. */
const M4 = { section: 'matrices', kind: 'Function', module: 'packages/sdk-core/mathMatrix4.ts' };
const TRS = {
  section: 'matrices',
  kind: 'Function',
  module: 'packages/sdk-core/mathMatrix4Trs.ts',
};
const SING = { section: 'matrices', kind: 'Function', module: 'packages/sdk-core/mathSingular.ts' };

export const MATRICES = [
  {
    ...M4,
    id: 'multiplyMatrix4',
    exports: ['multiplyMatrix4'],
    title: 'multiplyMatrix4()',
    signature: 'multiplyMatrix4(out: Float64Array, a: Float64Array, b: Float64Array)',
    description:
      '`out = a · b`. The thirty-two inputs are read before the first write, so `out` may be `a` or `b`. Each term is the sum of four products with no initial zero — a sum started at `0` would change the sign of a negative zero. **One buffer type only, `Float64Array`, in and out**: a single caller passing a plain array would make the forty-eight access sites polymorphic and every hot loop would pay it, so a caller starting from a host matrix copies it first.',
    replaces: 'Matrix4.multiplyMatrices',
    proof: 'bench Matrix4.multiplyMatrices (×1.2)',
    example: `const out = new Float64Array(16);
multiplyMatrix4(out, projection, view); // out may alias projection or view`,
  },
  {
    ...M4,
    id: 'invertMatrix4',
    exports: ['invertMatrix4'],
    title: 'invertMatrix4()',
    module: 'packages/sdk-core/mathMatrix4Inverse.ts',
    signature: 'invertMatrix4(out: Float64Array, m: ArrayLike<number>)',
    description:
      '`out = m⁻¹` by cofactors. An exactly zero determinant yields the zero matrix, like the reference — a caller that must distinguish this case tests the determinant, never the output. That threshold is parity with the reference, not the engine singularity rule, which applies only where a normal is transported. The sixteen inputs are read before the first write, so `out` may be `m`.',
    replaces: 'Matrix4.invert',
    proof: 'bench Matrix4.invert (×1.3)',
  },
  {
    ...TRS,
    id: 'composeMatrix4',
    exports: ['composeMatrix4'],
    title: 'composeMatrix4()',
    signature: 'composeMatrix4(out, position, quaternion, scale)',
    description:
      '`out = T · R · S`, the quaternion ordered `(x, y, z, w)`. The last row is written `(0, 0, 0, 1)` exactly; quaternion products are doubled by addition (`x + x`), like the reference, never multiplied by two.',
    replaces: 'Matrix4.compose',
    proof: 'bench Matrix4.compose (×1.4)',
    example: `composeMatrix4(model, [0, 0, -3], [0, 0, 0, 1], [1, 1, 1]);`,
  },
  {
    ...TRS,
    id: 'decomposeMatrix4',
    exports: ['decomposeMatrix4'],
    title: 'decomposeMatrix4()',
    signature: 'decomposeMatrix4(m, position, quaternion, scale)',
    description:
      "The reverse: a column's scale is its length, and a negative determinant is carried by the `x` axis alone, whichever axis was reversed at the source. A sheared matrix has no such decomposition — the rotation returned is then that of the column-normalised matrix and recomposition no longer yields `m`, a gap identical to the reference's and quantified by the bench.",
    replaces: 'Matrix4.decompose',
    proof: 'bench Matrix4.decompose (×1.1)',
  },
  {
    ...M4,
    id: 'copyMatrix4',
    exports: ['copyMatrix4'],
    title: 'copyMatrix4()',
    signature: 'copyMatrix4(out: NumberSink, m: ArrayLike<number>, outAt = 0, mAt = 0)',
    description:
      'Copies the sixteen numbers of `m` into `out`, each at its offset. A loop rather than `TypedArray.set`: on a view `set` costs a native call, and the outputs are not all typed — a host matrix, a GPU single-precision buffer, which is the only conversion.',
    replaces: 'Matrix4.copy, fromArray, toArray',
    proof: 'a pure copy; bit equality on every bench line',
  },
  {
    ...M4,
    id: 'determinantMatrix4',
    exports: ['determinantMatrix4', 'linearPartDeterminant'],
    title: 'determinantMatrix4() · linearPartDeterminant()',
    signature:
      'determinantMatrix4(m: ArrayLike<number>)\nlinearPartDeterminant(m: ArrayLike<number>)',
    description:
      'The 4×4 determinant, expanded along the last row like the reference, and that of the linear part alone (the 3×3 block), expanded along the first column. The sign of the second says whether the transform reverses orientation, hence which face a draw must cull. The second is not the expansion of the first: the relative gap is a few ulps, and the signs can differ only near a singular matrix, where neither rounding decides.',
    replaces: 'Matrix4.determinant',
    proof: 'mathMatrix4.test.ts',
  },
  {
    ...M4,
    id: 'normalMatrix3',
    exports: ['normalMatrix3'],
    title: 'normalMatrix3()',
    module: 'packages/sdk-core/mathMatrix3.ts',
    signature: 'normalMatrix3(out, m: ArrayLike<number>)',
    description:
      "`out = transpose(inverse(3×3 block of m))` on nine numbers, column-major: the matrix that carries the normals of a surface transformed by `m`, shear and non-uniform scale included. The inverse is the reference one, cofactors and product order included, then transposed with no floating-point operation. **On a singular matrix it writes the adjugate, undivided**, not the reference's zero matrix: a singular pose does not erase a surface, it flattens it onto a plane, and the adjugate applied to a local normal *is* the cross product of the transformed edges, sign included — every consumer then normalises. Only a zero, infinite or NaN scale is written apart, as nine zeros.",
    replaces: 'Matrix3.getNormalMatrix',
    proof: 'the same rule as the WGSL kernel in packages/sdk-browser/inverseTransposeWgsl.ts',
  },
  {
    ...SING,
    id: 'linearPartScale',
    exports: [
      'linearPartScale',
      'normalizedLinearDeterminant',
      'adjugateFactor',
      'SINGULAR_DETERMINANT',
      'SINGULAR_DETERMINANT_WGSL',
    ],
    title: 'linearPartScale() · normalizedLinearDeterminant() · adjugateFactor()',
    signature:
      'linearPartScale(m)\nnormalizedLinearDeterminant(m)\nadjugateFactor(m, determinant)\nSINGULAR_DETERMINANT = 1e-20',
    description:
      "The engine's one singularity rule, in the form of the WGSL kernel. The scale is the sum of the absolute values of the nine terms of the linear part; the determinant is taken on the columns **divided by that scale before the product**, never on the raw determinant divided by its cube — `t³` overflows past 1e103 and vanishes under 1e-103, exactly where the rule is meant to decide. `adjugateFactor` then returns `1 / determinant` for a regular matrix (the reference bits), `1` for a singular one (the adjugate as-is), and `null` when the scale is not finite and strictly positive, where the adjugate itself must be replaced by zero. `SINGULAR_DETERMINANT_WGSL` is the same threshold as the shader writes it: one number, two languages.",
  },
  {
    ...TRS,
    id: 'basisMatrix4',
    exports: ['basisMatrix4', 'uniformScaleMatrix4'],
    title: 'basisMatrix4() · uniformScaleMatrix4()',
    signature:
      'basisMatrix4(out, u, v, n, origin, outAt = 0)\nuniformScaleMatrix4(out, s, center, outAt = 0)',
    description:
      'The columns `u`, `v`, `n` then the origin, last row `(0, 0, 0, 1)`; and a uniform scale `s` placed at `center`. Both replace a two-call sequence of the host library with one write.',
    replaces: 'Matrix4.makeBasis + setPosition; Matrix4.makeScale + setPosition',
    proof: 'bench Matrix4.makeBasis (×1.7), Matrix4.makeScale (×2.3)',
  },
];

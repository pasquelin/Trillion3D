/** Vectors and colours: every read at an offset, every write into a caller's buffer. */
const V = { section: 'vectors', kind: 'Function', module: 'packages/sdk-core/mathVector.ts' };
const C = { section: 'colors', kind: 'Function', module: 'packages/sdk-core/mathColor.ts' };

export const VECTORS = [
  {
    ...V,
    id: 'dotVector3',
    exports: ['dotVector3'],
    title: 'dotVector3()',
    signature: 'dotVector3(a, b, aAt = 0, bAt = 0): number',
    description:
      '`a · b` on three components read at `aAt` and `bAt`: one buffer plus an offset, never a view — that is what makes it cheap inside a loop over thousands of vectors.',
    replaces: 'Vector3.dot',
    proof: 'bench Vector3.dot (×3.9)',
  },
  {
    ...V,
    id: 'crossVector3',
    exports: ['crossVector3'],
    title: 'crossVector3()',
    signature: 'crossVector3(out, a, b, outAt = 0, aAt = 0, bAt = 0)',
    description:
      '`out = a × b`. The six components are read before the first write, so `out` may be `a` or `b`.',
    replaces: 'Vector3.crossVectors',
    proof: 'bench Vector3.crossVectors (×5.0)',
  },
  {
    ...V,
    id: 'lengthSqVector3',
    exports: ['lengthSqVector3'],
    title: 'lengthSqVector3()',
    signature: 'lengthSqVector3(v, at = 0): number',
    description:
      "`x² + y² + z²`, the three squares summed in the reference's order. `Math.sqrt` of it is the reference's `length()` bit for bit.",
    replaces: 'Vector3.lengthSq, Vector3.length',
    proof: 'bench Vector3.length (×1.7)',
  },
  {
    ...V,
    id: 'normalizeVector3',
    exports: ['normalizeVector3'],
    title: 'normalizeVector3()',
    signature: 'normalizeVector3(v: NumberSink)',
    description:
      '`v / ‖v‖` in place — each component multiplied by `1 / (length || 1)`, so a zero vector is left unchanged.',
    replaces: 'Vector3.normalize',
    proof: 'mathVector.test.ts',
  },
  {
    ...V,
    id: 'scaleVector3',
    exports: ['scaleVector3', 'copyScaledVector3', 'addScaledVector3'],
    title: 'scaleVector3() · copyScaledVector3() · addScaledVector3()',
    signature:
      'scaleVector3(out, s)\ncopyScaledVector3(out, a, s, outAt = 0, aAt = 0)\naddScaledVector3(out, a, s)',
    description:
      'The three components multiplied in place; `out = a · s` written at an offset; and `out += a · s`.',
    replaces: 'Vector3.multiplyScalar, copy().multiplyScalar, addScaledVector',
    proof: 'bench Vector3.multiplyScalar (×4.3)',
  },
  {
    ...V,
    id: 'transformAffinePoint',
    exports: ['transformAffinePoint'],
    title: 'transformAffinePoint()',
    signature: 'transformAffinePoint(out, m, x, y, z, outOffset = 0)',
    description:
      '`M · (x, y, z, 1)` without perspective divide — the form of an affine matrix, whose last row is `(0, 0, 0, 1)`. For such a matrix and a finite point this is bit for bit the projective transform, whose `1 / w` factor is then 1. The coordinates arrive as parameters, so `out` may be the input vector.',
    replaces: 'Vector3.applyMatrix4',
    proof: 'bench Vector3.applyMatrix4 (×2.4)',
  },
  {
    ...V,
    id: 'transformHomogeneousPoint',
    exports: ['transformHomogeneousPoint'],
    title: 'transformHomogeneousPoint()',
    signature: 'transformHomogeneousPoint(out, m, x, y, z, outOffset = 0)',
    description:
      'The four homogeneous components, no divide: the point in clip space when `M` is a view-projection. The caller divides by the fourth, after discarding the one that is zero or non-finite.',
  },
  {
    ...V,
    id: 'transformDirectionVector3',
    exports: ['transformDirectionVector3', 'applyMatrix3Vector3'],
    title: 'transformDirectionVector3() · applyMatrix3Vector3()',
    signature: 'transformDirectionVector3(out, m, x, y, z)\napplyMatrix3Vector3(out, m, x, y, z)',
    description:
      'The 3×3 block of an affine 4×4 applied to a direction, then the reference normalisation — translation ignored, as for any direction. And `M · (x, y, z)` for a 3×3 matrix stored column-major on nine numbers.',
    replaces: 'Vector3.transformDirection, Vector3.applyMatrix3',
  },
];

export const COLORS = [
  {
    ...C,
    id: 'srgbToLinear',
    exports: ['srgbToLinear', 'linearToSrgb'],
    title: 'srgbToLinear() · linearToSrgb()',
    signature: 'srgbToLinear(c: number): number\nlinearToSrgb(c: number): number',
    description:
      'The exact sRGB curve — `c / 12.92` below 0.04045, `((c + 0.055) / 1.055)^2.4` above — and its inverse, negatives clamped to zero before the exponent.',
    replaces: 'Color.convertSRGBToLinear, convertLinearToSRGB, new Color(hex)',
    proof:
      'bench Color.convertSRGBToLinear (×1.0) — declared exception: the reference multiplies by rounded constants, the engine writes the curve; gap ≤ 1e-11 per channel, invisible at 8 bits',
  },
  {
    ...C,
    id: 'hslToLinearRgb',
    exports: ['hslToLinearRgb'],
    title: 'hslToLinearRgb()',
    signature: 'hslToLinearRgb(out: NumberSink, o: number, h, s, l)',
    description:
      'Hue, saturation and lightness to three linear components written at `out[o..o+2]`. The reference `setHSL` term by term: wrapped hue, saturation and lightness clamped to `[0, 1]`, zero saturation returned as grey, then the piecewise ramp. No transfer curve is applied — the reference workspace is already linear.',
    replaces: 'Color.setHSL',
    proof: 'bench Color.setHSL (×1.3)',
  },
];

import type { EntryNote } from '../model.ts';

/** Vectors and colours: every read at an offset, every write into a caller's buffer. */

export const VECTORS: EntryNote[] = [
  {
    id: 'dotVector3',
    description:
      '`a · b` on three components read at `aAt` and `bAt`: one buffer plus an offset, never a view — that is what makes it cheap inside a loop over thousands of vectors.',
    replaces: 'Vector3.dot',
    proof: 'bench Vector3.dot (×3.9)',
  },
  {
    id: 'crossVector3',
    description:
      '`out = a × b`. The six components are read before the first write, so `out` may be `a` or `b`.',
    replaces: 'Vector3.crossVectors',
    proof: 'bench Vector3.crossVectors (×5.0)',
  },
  {
    id: 'lengthSqVector3',
    description:
      "`x² + y² + z²`, the three squares summed in the reference's order. `Math.sqrt` of it is the reference's `length()` bit for bit.",
    replaces: 'Vector3.lengthSq, Vector3.length',
    proof: 'bench Vector3.length (×1.7)',
  },
  {
    id: 'normalizeVector3',
    description:
      '`v / ‖v‖` in place — each component multiplied by `1 / (length || 1)`, so a zero vector is left unchanged.',
    replaces: 'Vector3.normalize',
    proof: 'packages/sdk-core/src/math/primitives/vector.test.ts',
  },
  {
    id: 'scaleVector3',
    description:
      'The three components multiplied in place; `out = a · s` written at an offset; and `out += a · s`.',
    replaces: 'Vector3.multiplyScalar, copy().multiplyScalar, addScaledVector',
    proof: 'bench Vector3.multiplyScalar (×4.3)',
  },
  {
    id: 'transformAffinePoint',
    description:
      '`M · (x, y, z, 1)` without perspective divide — the form of an affine matrix, whose last row is `(0, 0, 0, 1)`. For such a matrix and a finite point this is bit for bit the projective transform, whose `1 / w` factor is then 1. The coordinates arrive as parameters, so `out` may be the input vector.',
    replaces: 'Vector3.applyMatrix4',
    proof: 'bench Vector3.applyMatrix4 (×2.4)',
  },
  {
    id: 'transformHomogeneousPoint',
    description:
      'The four homogeneous components, no divide: the point in clip space when `M` is a view-projection. The caller divides by the fourth, after discarding the one that is zero or non-finite.',
  },
  {
    id: 'transformDirectionVector3',
    description:
      'The 3×3 block of an affine 4×4 applied to a direction, then the reference normalisation — translation ignored, as for any direction. And `M · (x, y, z)` for a 3×3 matrix stored column-major on nine numbers.',
    replaces: 'Vector3.transformDirection, Vector3.applyMatrix3',
  },
];

export const COLORS: EntryNote[] = [
  {
    id: 'srgbToLinear',
    description:
      'The exact sRGB curve — `c / 12.92` below 0.04045, `((c + 0.055) / 1.055)^2.4` above — and its inverse, negatives clamped to zero before the exponent.',
    replaces: 'Color.convertSRGBToLinear, convertLinearToSRGB, new Color(hex)',
    proof:
      'bench Color.convertSRGBToLinear (×1.0) — declared exception: the reference multiplies by rounded constants, the engine writes the curve; gap ≤ 1e-11 per channel, invisible at 8 bits',
  },
  {
    id: 'hslToLinearRgb',
    description:
      'Hue, saturation and lightness to three linear components written at `out[o..o+2]`. The reference `setHSL` term by term: wrapped hue, saturation and lightness clamped to `[0, 1]`, zero saturation returned as grey, then the piecewise ramp. No transfer curve is applied — the reference workspace is already linear.',
    replaces: 'Color.setHSL',
    proof: 'bench Color.setHSL (×1.3)',
  },
];

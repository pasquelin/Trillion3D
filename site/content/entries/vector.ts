import type { EntryNote } from '../model.ts';

/** Vectors and colours: every read at an offset, every write into a caller's buffer. */

export const VECTORS: EntryNote[] = [
  {
    id: 'dotVector3',
    replaces: 'Vector3.dot',
    proof: 'bench Vector3.dot (×3.9)',
  },
  {
    id: 'crossVector3',
    replaces: 'Vector3.crossVectors',
    proof: 'bench Vector3.crossVectors (×5.0)',
  },
  {
    id: 'lengthSqVector3',
    replaces: 'Vector3.lengthSq, Vector3.length',
    proof: 'bench Vector3.length (×1.7)',
  },
  {
    id: 'normalizeVector3',
    replaces: 'Vector3.normalize',
    proof: 'packages/sdk-core/src/math/primitives/vector.test.ts',
  },
  {
    id: 'scaleVector3',
    replaces: 'Vector3.multiplyScalar, copy().multiplyScalar, addScaledVector',
    proof: 'bench Vector3.multiplyScalar (×4.3)',
  },
  {
    id: 'transformAffinePoint',
    replaces: 'Vector3.applyMatrix4',
    proof: 'bench Vector3.applyMatrix4 (×2.4)',
  },
  {
    id: 'transformHomogeneousPoint',
  },
  {
    id: 'transformDirectionVector3',
    replaces: 'Vector3.transformDirection, Vector3.applyMatrix3',
  },
];

export const COLORS: EntryNote[] = [
  {
    id: 'srgbToLinear',
    replaces: 'Color.convertSRGBToLinear, convertLinearToSRGB, new Color(hex)',
    proof:
      'bench Color.convertSRGBToLinear (×1.0) — declared exception: the reference multiplies by rounded constants, the engine writes the curve; gap ≤ 1e-11 per channel, invisible at 8 bits',
  },
  {
    id: 'hslToLinearRgb',
    replaces: 'Color.setHSL',
    proof: 'bench Color.setHSL (×1.3)',
  },
];

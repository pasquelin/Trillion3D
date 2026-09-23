import type { EntryNote } from '../model.ts';

/** 4×4 and 3×3 matrices, and the singularity rule the normal matrix follows. */

export const MATRICES: EntryNote[] = [
  {
    id: 'multiplyMatrix4',
    replaces: 'Matrix4.multiplyMatrices',
    proof: 'bench Matrix4.multiplyMatrices (×1.2)',
    example: `const out = new Float64Array(16);
multiplyMatrix4(out, projection, view); // out may alias projection or view`,
  },
  {
    id: 'invertMatrix4',
    replaces: 'Matrix4.invert',
    proof: 'bench Matrix4.invert (×1.3)',
  },
  {
    id: 'composeMatrix4',
    replaces: 'Matrix4.compose',
    proof: 'bench Matrix4.compose (×1.4)',
    example: 'composeMatrix4(model, [0, 0, -3], [0, 0, 0, 1], [1, 1, 1]);',
  },
  {
    id: 'decomposeMatrix4',
    replaces: 'Matrix4.decompose',
    proof: 'bench Matrix4.decompose (×1.1)',
  },
  {
    id: 'copyMatrix4',
    replaces: 'Matrix4.copy, fromArray, toArray',
    proof: 'a pure copy; bit equality on every bench line',
  },
  {
    id: 'determinantMatrix4',
    replaces: 'Matrix4.determinant',
    proof: 'packages/sdk-core/src/math/matrix/matrix4.test.ts',
  },
  {
    id: 'normalMatrix3',
    replaces: 'Matrix3.getNormalMatrix',
    proof:
      'the same rule as the WGSL kernel in packages/sdk-browser/src/math/inverseTransposeWgsl.ts',
  },
  {
    id: 'linearPartScale',
  },
  {
    id: 'basisMatrix4',
    replaces: 'Matrix4.makeBasis + setPosition; Matrix4.makeScale + setPosition',
    proof: 'bench Matrix4.makeBasis (×1.7), Matrix4.makeScale (×2.3)',
  },
];

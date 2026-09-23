import type { EntryNote } from '../model.ts';

/** Batch math: `n` elements per call on flat buffers, the governor that arbitrates the paths. */

export const BATCHES: EntryNote[] = [
  {
    id: 'multiplyMatrix4Batch',
    replaces: 'a loop of Matrix4.multiplyMatrices',
  },
  {
    id: 'boxTransformBatch',
    replaces: 'a loop of Box3.applyMatrix4',
  },
  {
    id: 'hierarchyUpdateBatch',
    replaces: 'Object3D.updateMatrixWorld over a whole scene',
  },
  {
    id: 'createPathGovernor',
  },
  {
    id: 'frustumKeepsBoxBatch',
    replaces: 'a loop of Frustum.intersectsBox, of Box3.getBoundingSphere',
  },
  {
    id: 'boxUnionBatch',
    replaces: 'a loop of Box3.union, Box3.setFromObject',
  },
  {
    id: 'invertMatrix4Batch',
    replaces: 'a loop of Matrix4.invert, getNormalMatrix, compose, decompose',
  },
  {
    id: 'transformPointsBatch',
    replaces: 'a loop of Vector3.applyMatrix4, of Vector3.transformDirection',
  },
  {
    id: 'srgbToLinearBatch',
    replaces: 'a loop of Color.convertSRGBToLinear, convertLinearToSRGB',
  },
];

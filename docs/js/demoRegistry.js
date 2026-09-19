/**
 * Which demo belongs to which entry. An entry with no demo simply has no live section;
 * `test/integration/portail-documentation.test.mjs` checks that every id named here is an
 * entry of the portal, so a renamed page cannot leave an orphan demo behind.
 */
import { MATRIX_DEMOS } from './demosMatrix.js';
import { MATRIX_MORE_DEMOS } from './demosMatrixMore.js';
import { VECTOR_DEMOS } from './demosVector.js';
import { VECTOR_TRANSFORM_DEMOS } from './demosVectorTransform.js';
import { COLOR_DEMOS } from './demosColor.js';
import { BOUNDS_DEMOS } from './demosBounds.js';
import { BOX_DEMOS } from './demosBoxes.js';
import { TREE_DEMOS } from './demosTree.js';
import { BATCH_DEMOS } from './demosBatch.js';
import { CAMERA_DEMOS } from './demosCamera.js';
import { TABLE_DEMOS } from './demosTables.js';

export const DEMOS = {
  ...MATRIX_DEMOS,
  ...MATRIX_MORE_DEMOS,
  ...VECTOR_DEMOS,
  ...VECTOR_TRANSFORM_DEMOS,
  ...COLOR_DEMOS,
  ...BOUNDS_DEMOS,
  ...BOX_DEMOS,
  ...TREE_DEMOS,
  ...BATCH_DEMOS,
  ...CAMERA_DEMOS,
  ...TABLE_DEMOS,
};

export function demoFor(entryId) {
  return DEMOS[entryId] ?? null;
}

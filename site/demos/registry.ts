/**
 * Which demo belongs to which entry. An entry with no demo simply has no live section;
 * `tests/integration/documentation-portal.test.ts` checks that every id named here is an
 * entry of the portal, so a renamed page cannot leave an orphan demo behind.
 */
import { MATRIX_DEMOS } from './matrix.ts';
import { MATRIX_MORE_DEMOS } from './matrixMore.ts';
import { VECTOR_DEMOS } from './vector.ts';
import { VECTOR_TRANSFORM_DEMOS } from './vectorTransform.ts';
import { COLOR_DEMOS } from './color.ts';
import { BOUNDS_DEMOS } from './bounds.ts';
import { BOX_DEMOS } from './boxes.ts';
import { TREE_DEMOS } from './tree.ts';
import { BATCH_DEMOS } from './batch.ts';
import { CAMERA_DEMOS } from './camera.ts';
import { TABLE_DEMOS } from './tables.ts';
import type { DemoDef } from './kit.ts';

export const DEMOS: Record<string, DemoDef> = {
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

export function demoFor(entryId: string) {
  return DEMOS[entryId] ?? null;
}

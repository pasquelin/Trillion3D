import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPARISON_LIBRARIES } from './competitors.ts';

test('competitor inventory never claims unintegrated libraries as covered', () => {
  const status = (id: string) => COMPARISON_LIBRARIES.find((row) => row.id === id)?.status;
  assert.equal(status('three-webgl-reference'), 'integrated');
  assert.equal(status('three-lod'), 'integrated');
  assert.ok(COMPARISON_LIBRARIES.some((row) => row.status === 'not-comparable'));
  assert.ok(COMPARISON_LIBRARIES.some((row) => row.status === 'abandoned'));
  assert.equal(status('made-up'), undefined);
});

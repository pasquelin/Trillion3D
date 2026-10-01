import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuPassBlockOf, gpuPassBlockTotals, gpuPassStageOf } from './gpuPasses.ts';
import * as passTable from '../gpu/core/passBlocks.ts';
import { families } from '../host/families.ts';
import { SHADOW_PASS } from '../stage/passLabels.ts';

test('the public pass mapping reads the debug code: unknown, unmeasured until it arrives', async () => {
  const sample = {
    frame: 1,
    totalMs: 3,
    truncated: false,
    passes: [
      { name: 'Trillion3D DAG selection', gpuMs: 1 },
      { name: SHADOW_PASS, gpuMs: 2 },
    ],
  };
  assert.equal(gpuPassBlockOf('Trillion3D DAG selection'), 'other');
  assert.equal(gpuPassStageOf(SHADOW_PASS), 'geometry');
  assert.deepEqual(gpuPassBlockTotals(sample), {
    visibilityMs: null,
    materialsMs: null,
    otherMs: null,
  });
  await families.measurement.load();
  assert.equal(gpuPassBlockOf('Trillion3D DAG selection'), 'visibility');
  assert.equal(gpuPassStageOf(SHADOW_PASS), 'shadows');
  assert.deepEqual(gpuPassBlockTotals(sample), passTable.gpuPassBlockTotals(sample));
  assert.deepEqual(gpuPassBlockTotals(sample), { visibilityMs: 1, materialsMs: null, otherMs: 2 });
});

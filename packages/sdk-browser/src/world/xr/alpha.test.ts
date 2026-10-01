import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredView, ZERO_DIRECT } from '../../lighting/deferred/view.ts';
import { gpuHarness } from '../../lighting/deferred/contractLighting.fixture.ts';

test('AR makes only the uncovered background transparent and restores the ordinary clear on exit', () => {
  const h = gpuHarness(),
    view = createDeferredView(h.device);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  view.write(matrix, [1, 2, 3], 800, 600, 0xff0000, false, ZERO_DIRECT, 0);
  view.write(matrix, [1, 2, 3], 800, 600, 0xff0000, false, ZERO_DIRECT, 0, true);
  view.write(matrix, [1, 2, 3], 800, 600, 0xff0000, false, ZERO_DIRECT, 0);
  assert.deepEqual([...h.writes[0].slice(24, 28)], [1, 0, 0, 1]);
  assert.deepEqual([...h.writes[1].slice(24, 28)], [0, 0, 0, 0]);
  assert.deepEqual([...h.writes[2]], [...h.writes[0]]);
  assert.deepEqual([...h.writes[1].slice(0, 24)], [...h.writes[0].slice(0, 24)]);
  assert.deepEqual([...h.writes[1].slice(28)], [...h.writes[0].slice(28)]);
  view.dispose();
});

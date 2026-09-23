import assert from 'node:assert/strict';
import test from 'node:test';
import { shadowCountersPerFrame } from './measurePage.ts';

test('the shadow counters are summarised over the frames that published them', () => {
  const counters = shadowCountersPerFrame();
  for (let frame = 1; frame <= 20; frame++)
    counters.push({ shadowPagesDrawn: frame % 2 ? frame : null, shadowPagesRequested: 7 });
  const summary = counters.summary();
  assert.deepEqual(summary.shadowPagesDrawn, { mean: 10, p95: 19, max: 19 });
  assert.deepEqual(summary.shadowPagesRequested, { mean: 7, p95: 7, max: 7 });
  assert.equal(summary.shadowLightCuts, null, 'a counter the dist never published stays null');
});

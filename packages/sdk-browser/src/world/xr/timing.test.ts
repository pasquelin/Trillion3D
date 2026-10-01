import test from 'node:test';
import assert from 'node:assert/strict';
import { createXrTiming } from './timing.ts';

test('missed headset frames do not enlarge the declared budget or disguise CPU time as GPU latency', () => {
  const timing = createXrTiming();
  timing.end(timing.start(0, 120));
  timing.end(timing.start(25, 120));
  assert.equal(timing.current.budgetMs, 1000 / 120);
  assert.equal(timing.current.intervalMs, 25);
  assert.equal(timing.current.renderScale, 1);
  assert.equal(timing.current.gpuMs, null);
  timing.end(timing.start(50));
  assert.equal(timing.current.intervalMs, 25);
  assert.equal(
    timing.current.budgetMs,
    null,
    'observed spacing is not a native refresh-rate measurement',
  );
  assert.equal(timing.current.cpuOverBudget, null);
});

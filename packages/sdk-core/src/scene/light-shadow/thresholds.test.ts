import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

// A threshold that moves and comes back before the camera rests leaves every page as rest would
// draw it: none is staled. A page drawn at another threshold than the one at rest is.
test('at rest, only the pages drawn at another threshold than the current one go stale', () => {
  const store = createSceneLightStore();
  store.add(SUN);
  const plan = createShadowPlan(24, 32);
  plan.setThreshold(1);
  planFrame(plan, store, 0);
  const read = sunPages(plan, store.sliceOf(0), 0, [
    [0, 0],
    [1, 0],
  ]);
  let frame = 1;
  for (; frame < 8; frame++) cycle(plan, store, frame, () => read);
  assert.equal(plan.pool.used, 2);
  plan.setThreshold(8);
  plan.setThreshold(1);
  cycle(plan, store, frame++, () => read);
  assert.equal(plan.counts.invalidatedPages, 0, 'back where the pages were drawn');
  assert.equal(plan.deferredChanges, false);
  plan.setThreshold(8);
  assert.equal(plan.deferredChanges, true, 'waits for the camera to rest');
  cycle(plan, store, frame, () => read);
  assert.equal(plan.counts.invalidatedPages, 2, 'drawn at another threshold: redrawn');
});

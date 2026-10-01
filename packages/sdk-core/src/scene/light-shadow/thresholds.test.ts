import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

/** A sun whose two pages the shading reads are drawn at threshold 1, from `eye` when given. */
function drawnSun(eye?: number[]) {
  const store = createSceneLightStore();
  store.add(SUN);
  const plan = createShadowPlan(32);
  plan.setThreshold(1, eye);
  planFrame(plan, store, 0);
  const read = sunPages(plan, store.sliceOf(0), 0, [
    [0, 0],
    [1, 0],
  ]);
  let frame = 1;
  for (; frame < 8; frame++) cycle(plan, store, frame, () => read);
  return { store, plan, read, frame };
}

// A threshold that moves and comes back before the camera rests leaves every page as rest would
// draw it: none is staled. A page drawn at another threshold than the one at rest is.
test('at rest, only the pages drawn at another threshold than the current one go stale', () => {
  const { store, plan, read, frame: drawn } = drawnSun();
  let frame = drawn;
  // The two pages read, and the four floor pages the view reached at the sun's first frame.
  assert.equal(plan.pool.used(), 2 + 4);
  plan.setThreshold(8);
  plan.setThreshold(1);
  cycle(plan, store, frame++, () => read);
  assert.equal(plan.counts.invalidatedPages, 0, 'back where the pages were drawn');
  assert.equal(plan.deferredChanges, false);
  plan.setThreshold(8);
  assert.equal(plan.deferredChanges, true, 'waits for the camera to rest');
  cycle(plan, store, frame, () => read);
  assert.equal(plan.counts.invalidatedPages, 2 + 4, 'drawn at another threshold: redrawn');
});

// #1016: the light cuts run in the eye's render frame, and a cluster at the edge of the threshold
// rounds another way from another eye: pages drawn while the camera moved kept the casters of
// their path, and two runs through the same rest pose drew two shadows. At rest, the pages drawn
// from another origin go stale; an origin that moved and came back stales none.
test('at rest, only the pages drawn from another render origin than the current one go stale', () => {
  const { store, plan, read, frame: drawn } = drawnSun([0, 0, 0]);
  let frame = drawn;
  plan.setThreshold(1, [0.25, 0, 0]);
  plan.setThreshold(1, [0, 0, 0]);
  cycle(plan, store, frame++, () => read);
  assert.equal(plan.counts.invalidatedPages, 0, 'back where the pages were drawn from');
  plan.setThreshold(1, [0, 0, 1e-7]);
  assert.equal(plan.deferredChanges, true, 'waits for the camera to rest');
  cycle(plan, store, frame, () => read);
  assert.equal(plan.counts.invalidatedPages, 2 + 4, 'drawn from another eye: redrawn');
});

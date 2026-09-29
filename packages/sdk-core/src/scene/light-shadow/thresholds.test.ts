import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, cycle, nudged, planFrame, sunPages } from './lightShadow.fixture.ts';

// A threshold that moves and comes back before the camera rests leaves every page as rest would
// draw it: none is staled. A page drawn at another threshold than the one at rest is.
test('at rest, only the pages drawn at another threshold than the current one go stale', () => {
  const store = createSceneLightStore();
  store.add(SUN);
  const plan = createShadowPlan(32);
  plan.setThreshold(1);
  planFrame(plan, store, 0);
  const read = sunPages(plan, store.sliceOf(0), 0, [
    [0, 0],
    [1, 0],
  ]);
  let frame = 1;
  for (; frame < 8; frame++) cycle(plan, store, frame, () => read);
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
  const store = createSceneLightStore();
  store.add(SUN);
  const plan = createShadowPlan(32);
  plan.setThreshold(1, [0, 0, 0]);
  planFrame(plan, store, 0);
  const read = sunPages(plan, store.sliceOf(0), 0, [
    [0, 0],
    [1, 0],
  ]);
  let frame = 1;
  for (; frame < 8; frame++) cycle(plan, store, frame, () => read);
  plan.setThreshold(1, [0.25, 0, 0]);
  plan.setThreshold(1, [0, 0, 0]);
  cycle(plan, store, frame++, () => read);
  assert.equal(plan.counts.invalidatedPages, 0, 'back where the pages were drawn from');
  plan.setThreshold(1, [0, 0, 1e-7]);
  assert.equal(plan.deferredChanges, true, 'waits for the camera to rest');
  cycle(plan, store, frame, () => read);
  assert.equal(plan.counts.invalidatedPages, 2 + 4, 'drawn from another eye: redrawn');
});

// A resize moves the pages (#1208): each keeps the origin it was drawn from, so at rest only the
// pages drawn from another origin go stale, wherever the resize put them.
test('a resized pool keeps the render origin each page was drawn from', () => {
  const store = createSceneLightStore();
  store.add(SUN);
  const plan = createShadowPlan(4);
  plan.setThreshold(1, [1, 2, 3]);
  cycle(plan, store, 0, () => []);
  const slice = store.sliceOf(0),
    grid = Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3)]);
  const read = sunPages(plan, slice, plan.sun.finest[slice] + 4, grid);
  let frame = 1;
  for (; frame < 5; frame++) cycle(plan, store, frame, () => read.slice(0, 6));
  // The eye moves: the three last pages are drawn from where it goes, the others stay from before.
  plan.setThreshold(1, [4, 5, 6]);
  for (let step = 1; step < 5; step++)
    cycle(plan, store, frame++, () => read.slice(6), nudged(step));
  // The smaller pool keeps the four floors, one page from before and the three last, packed.
  const moved = plan.resize(2, 2);
  assert.deepEqual([...moved.slice(10, 13)], [5, 6, 7], 'the last pages moved down');
  cycle(plan, store, frame, () => [...plan.pool.owner].filter((e) => e >= 0), nudged(4));
  assert.equal(plan.counts.invalidatedPages, 4 + 1, 'only the pages drawn from before go stale');
});

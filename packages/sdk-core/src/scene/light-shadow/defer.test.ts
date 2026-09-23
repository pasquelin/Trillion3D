// A representation change — level of detail, residency, colour tile — waits for the camera to
// rest before it stales shadow pages; a world change stales them at once. Under a moving camera
// the cut churns every frame, and each churn would restale every page it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';
import { VIEW, SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

const BOX_MIN = [-1e3, 0, -1e3],
  BOX_MAX = [1e3, 2, 1e3];

/** A sun whose pages around the eye are all mapped and drawn. */
function settled() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = () => sunPages(plan, slice, plan.sun.finest[slice] + 6, [[0, 0]]);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read);
  assert.equal(plan.counts.pendingPages, 0);
  return { store, plan, frame };
}

/** A view moved by a hair: no extent moves by a page, the cut alone churns. */
const nudged = (step: number): ShadowViewpoint => ({
  ...VIEW,
  position: [VIEW.position[0] + step * 1e-6, VIEW.position[1], VIEW.position[2]],
});

test('a representation change under a moving camera stales nothing until the camera rests', () => {
  const { store, plan, frame } = settled();
  for (let i = 0; i < 4; i++) {
    plan.representationChanged(BOX_MIN, BOX_MAX);
    planFrame(plan, store, frame + i, nudged(i + 1));
    assert.equal(plan.counts.invalidatedPages, 0, `frame ${i}: the change waits`);
    assert.equal(plan.deferredChanges, true);
  }
  // The same view twice: the camera rests, and the union of what changed enters the list.
  planFrame(plan, store, frame + 4, nudged(4));
  assert.ok(plan.counts.invalidatedPages > 0, 'the deferred box stales its pages');
  assert.equal(plan.deferredChanges, false);
});

test('a world change stales its pages at once, camera moving or not', () => {
  const { store, plan, frame } = settled();
  plan.worldChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame, nudged(1));
  assert.ok(plan.counts.invalidatedPages > 0);
});

test('a representation change under a still camera stales its pages on the next frame', () => {
  const { store, plan, frame } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame);
  assert.ok(plan.counts.invalidatedPages > 0);
  assert.equal(plan.deferredChanges, false);
});

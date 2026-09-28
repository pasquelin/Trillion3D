// A representation change — level of detail, residency, colour tile — waits for the camera to
// rest before it stales shadow pages; a world change stales them at once. Under a moving camera
// the cut churns every frame, and each churn would restale every page it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, cycle, nudged, planFrame, sunPages } from './lightShadow.fixture.ts';
import { STALE_DYNAMIC, STALE_FULL } from './pool.ts';

const BOX_MIN = [-1e3, 0, -1e3],
  BOX_MAX = [1e3, 2, 1e3];

/** A sun whose pages around the eye are all mapped and drawn. */
function settled() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = () => sunPages(plan, slice, plan.sun.finest[slice] + 6, [[0, 0]]);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read);
  assert.equal(plan.counts.pendingPages, 0);
  return { store, plan, frame, page: plan.table.words[read()[0]] & 0xffff };
}

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

// #993: the static layer never held an object already moving; its change of detail keeps that layer.
test('a representation change of objects already moving waits too, then stales their moving casters alone', () => {
  const { store, plan, frame, page } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX, true);
  planFrame(plan, store, frame, nudged(1));
  assert.equal(plan.counts.invalidatedPages, 0, 'the change waits');
  planFrame(plan, store, frame + 1, nudged(1));
  assert.equal(plan.pool.dirty[page], STALE_DYNAMIC, 'released at rest, the static layer kept');
  plan.representationChanged(BOX_MIN, BOX_MAX, true);
  plan.representationChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame + 2, nudged(1));
  assert.equal(plan.pool.dirty[page], STALE_FULL, 'a still object beside raises it to full');
});

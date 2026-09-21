// A representation change — level of detail, residency, colour tile — waits for the camera to
// rest before it stales shadow pages; a world change stales them at once. Under a moving camera
// the cut churns every frame, and each churn used to restale the far cascades whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import { createShadowPlan } from './sceneLightShadowPlan.ts';
import type { ShadowViewpoint } from './sceneLightContracts.ts';
import { VIEW, SUN } from './sceneLightShadowFixture.ts';

const BOX_MIN = [-1, 0, -1],
  BOX_MAX = [1, 2, 1];

function settled() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  let frame = 0;
  for (; frame < 8 && (frame === 0 || plan.counts.pendingPages > 0); frame++)
    plan.plan(store, VIEW, frame, frame * 16);
  assert.equal(plan.counts.pendingPages, 0);
  return { store, plan, frame };
}

/** A view moved by less than a page of the nearest cascade: no strip enters, the cut alone churns. */
const nudged = (step: number): ShadowViewpoint => ({
  ...VIEW,
  position: [VIEW.position[0] + step * 1e-3, VIEW.position[1], VIEW.position[2]],
});

test('a representation change under a moving camera stales nothing until the camera rests', () => {
  const { store, plan, frame } = settled();
  for (let i = 0; i < 4; i++) {
    plan.representationChanged(BOX_MIN, BOX_MAX);
    plan.plan(store, nudged(i + 1), frame + i, (frame + i) * 16);
    assert.equal(plan.counts.invalidatedPages, 0, `frame ${i}: the change waits`);
    assert.equal(plan.deferredChanges, true);
  }
  // The same view twice: the camera rests, and the union of what changed enters the queue.
  plan.plan(store, nudged(4), frame + 4, (frame + 4) * 16);
  assert.ok(plan.counts.invalidatedPages > 0, 'the deferred box stales its pages');
  assert.equal(plan.deferredChanges, false);
});

test('a world change stales its pages at once, camera moving or not', () => {
  const { store, plan, frame } = settled();
  plan.worldChanged(BOX_MIN, BOX_MAX);
  plan.plan(store, nudged(1), frame, frame * 16);
  assert.ok(plan.counts.invalidatedPages > 0);
});

test('a representation change under a still camera stales its pages on the next frame', () => {
  const { store, plan, frame } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX);
  plan.plan(store, VIEW, frame, frame * 16);
  assert.ok(plan.counts.invalidatedPages > 0);
  assert.equal(plan.deferredChanges, false);
});

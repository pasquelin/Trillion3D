// Issue #25: 8 lights + sun, two identical runs. The pose barrier drains the shadow
// queue; the 1 ms budget is for the measured loop. A GPU timestamp arriving during
// the drain — and a tile that invalidates every map, like `shadowsFollowTextures` —
// left pages pending and made the A/A witness diverge (0 / 1,392 / 6,278 px).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import { createShadowPlan } from './sceneLightShadowPlan.ts';
import type { SceneLight, ShadowViewpoint } from './sceneLightContracts.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.6,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
};
const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];
/** Region cap of one frame, matching the engine's buffers. */
const REGIONS = 24;
/** Frames the barrier spends at most draining (`SHADOW_DRAIN_LIMIT`). */
const DRAIN = 64;

const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0.1, -0.9, 0.4],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

function pointLight(id: string, castsShadow: boolean): SceneLight {
  return {
    id,
    kind: 'point',
    position: [0, 2, -4],
    color: [1, 1, 1],
    intensity: 1,
    range: 8,
    castsShadow,
  };
}

function scene(points: number, sun: boolean, shadows: boolean) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(REGIONS);
  if (sun) store.add({ ...SUN, castsShadow: shadows });
  for (let i = 0; i < points; i++) store.add(pointLight(`l${i}`, shadows));
  return { store, plan };
}

/** One drain frame: optional world invalidation, then `plan()`. */
function step(
  plan: ReturnType<typeof createShadowPlan>,
  store: ReturnType<typeof createSceneLightStore>,
  frame: number,
  invalidate: boolean,
) {
  if (invalidate) plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
  plan.plan(store, VIEW, frame, frame * 16);
}

function drain(
  plan: ReturnType<typeof createShadowPlan>,
  store: ReturnType<typeof createSceneLightStore>,
  invalidateEvery: number,
) {
  for (let frame = 0; frame < DRAIN; frame++) {
    step(plan, store, frame, invalidateEvery > 0 && frame > 0 && frame % invalidateEvery === 0);
    if (plan.counts.pendingPages === 0) return frame + 1;
  }
  return null;
}

test('no lights: the shadow queue stays empty', () => {
  const { store, plan } = scene(0, false, true);
  plan.plan(store, VIEW, 0, 0);
  assert.equal(plan.counts.pendingPages, 0);
});

test('sun only: the queue drains even after an expensive GPU sample', () => {
  const { store, plan } = scene(0, true, true);
  plan.plan(store, VIEW, 0, 0);
  plan.budget.observe(1, 1);
  const frames = drain(plan, store, 0);
  assert.notEqual(frames, null);
  assert.equal(plan.counts.pendingPages, 0);
});

test('8 lights with shadows off: nothing to drain', () => {
  const { store, plan } = scene(8, true, false);
  plan.plan(store, VIEW, 0, 0);
  assert.equal(plan.counts.pendingPages, 0);
});

test('8 lights + sun, tight budget and a tile that invalidates everything: pages remain after 64 frames', () => {
  const { store, plan } = scene(8, true, true);
  plan.plan(store, VIEW, 0, 0);
  plan.budget.observe(1, 1);
  assert.equal(
    drain(plan, store, 8),
    null,
    'one region per frame cannot catch up with 52 re-invalidated faces',
  );
  assert.ok(plan.counts.pendingPages > 0);
});

test('same scene, budget suspended: the queue drains despite invalidations', () => {
  const { store, plan } = scene(8, true, true);
  plan.plan(store, VIEW, 0, 0);
  plan.budget.observe(1, 1);
  plan.budget.suspend();
  const frames = drain(plan, store, 8);
  plan.budget.resume();
  assert.notEqual(frames, null);
  assert.equal(plan.counts.pendingPages, 0);
  assert.ok((frames as number) < DRAIN);
});

test('two different GPU samples, budget suspended: the queue drains in both cases', () => {
  const leftover = [];
  for (const cost of [1, 8]) {
    const { store, plan } = scene(8, true, true);
    plan.plan(store, VIEW, 0, 0);
    plan.budget.observe(cost, 1);
    plan.budget.suspend();
    leftover.push(drain(plan, store, 8) === null ? plan.counts.pendingPages : 0);
    plan.budget.resume();
  }
  assert.deepEqual(leftover, [0, 0]);
});

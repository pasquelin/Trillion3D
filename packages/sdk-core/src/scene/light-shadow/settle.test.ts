// Issue #25: 8 lights + sun, two identical runs. The pose barrier drains the shadow queue; the
// 1 ms budget is for the measured loop. A GPU timestamp arriving during the drain — and a tile
// that invalidates every page, like `shadowsFollowTextures` — left pages pending and made the A/A
// witness diverge (0 / 1,392 / 6,278 px).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import type { SceneLight } from '../light/contracts.ts';
import { SUN, cycle, lampPages, planFrame, sunPages } from './lightShadow.fixture.ts';

const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];
/** Frames the barrier spends at most draining (`SHADOW_DRAIN_LIMIT`). */
const DRAIN = 64;

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
  const plan = createShadowPlan(24, 32);
  if (sun) store.add({ ...SUN, castsShadow: shadows });
  for (let i = 0; i < points; i++) store.add(pointLight(`l${i}`, shadows));
  planFrame(plan, store, 0);
  // What the shading reads: the coarsest mip of every lamp face, and one page of the sun.
  const read = () => {
    const entries: number[] = [];
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0) continue;
      if (store.light(store.ids[slot])?.kind === 'directional')
        entries.push(...sunPages(plan, slice, plan.sun.finest[slice] + 6, [[0, 0]]));
      else for (let face = 0; face < 6; face++) entries.push(...lampPages(plan, slice, face, 5));
    }
    return entries;
  };
  return { store, plan, read };
}

/** Frames until nothing waits, invalidating everything every `every` frames; null past the limit. */
function drain({ store, plan, read }: ReturnType<typeof scene>, every: number) {
  for (let frame = 1; frame < DRAIN; frame++) {
    if (every > 0 && frame > 2 && frame % every === 0)
      plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
    cycle(plan, store, frame, read);
    if (frame > 1 && plan.counts.pendingPages === 0 && plan.settled(store)) return frame;
  }
  return null;
}

test('no lights: the shadow queue stays empty', () => {
  const { plan } = scene(0, false, true);
  assert.equal(plan.counts.pendingPages, 0);
});

test('sun only: the queue drains even after an expensive GPU sample', () => {
  const setup = scene(0, true, true);
  setup.plan.budget.observe(1, 1);
  assert.notEqual(drain(setup, 0), null);
});

test('8 lights with shadows off: nothing to drain', () => {
  const setup = scene(8, true, false);
  assert.equal(setup.plan.pool.used, 0);
  assert.equal(setup.plan.counts.pendingPages, 0);
});

test('8 lights + sun, tight budget and a tile that invalidates everything: pages remain', () => {
  const setup = scene(8, true, true);
  setup.plan.budget.observe(1, 1);
  assert.equal(drain(setup, 8), null, 'one page per frame cannot catch up with 49 restaled ones');
  assert.ok(setup.plan.counts.pendingPages > 0);
});

test('same scene, budget suspended: the queue drains despite invalidations', () => {
  const setup = scene(8, true, true);
  setup.plan.budget.observe(1, 1);
  setup.plan.budget.suspend();
  const frames = drain(setup, 8);
  assert.notEqual(frames, null);
  assert.ok((frames as number) < DRAIN);
});

test('two different GPU samples, budget suspended: the queue drains in both cases', () => {
  const leftover = [];
  for (const cost of [1, 8]) {
    const setup = scene(8, true, true);
    setup.plan.budget.observe(cost, 1);
    setup.plan.budget.suspend();
    leftover.push(drain(setup, 8) === null ? setup.plan.counts.pendingPages : 0);
  }
  assert.deepEqual(leftover, [0, 0]);
});

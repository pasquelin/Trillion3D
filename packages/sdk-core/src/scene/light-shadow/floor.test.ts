// Never no shadow: over budget, the floor under every page the shading reads — a sun's last level,
// a lamp face's one-page mip — is current every frame, so a reader that falls back past a withdrawn
// page never reaches the far ray of a sun or the unshadowed answer of a lamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_VALID } from './virtual.ts';
import {
  SUN,
  cycle,
  lampFloor,
  lampPages,
  planFrame,
  sunFloor,
  sunPages,
} from './lightShadow.fixture.ts';

const EVERYWHERE_MIN = [-1e6, -1e6, -1e6],
  EVERYWHERE_MAX = [1e6, 1e6, 1e6];

test('over budget, the floor under the sun pages read is current every frame', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = sunPages(plan, slice, plan.sun.finest[slice] + 4, [
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
  cycle(plan, store, 1, () => read);
  // A page costs the whole budget, and a static caster moves across every page, every frame.
  plan.observeCost(plan.budget.budgetMs, 1);
  for (let frame = 2; frame < 10; frame++) {
    plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
    cycle(plan, store, frame, () => read);
    assert.ok(plan.table.words[sunFloor(plan, slice)] & PAGE_VALID, `frame ${frame}`);
  }
  assert.ok(plan.counts.pendingPages > 0, 'the finer pages wait on the budget');
});

test('over budget, a lamp that moves every frame keeps the floor of each face read current', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = [...lampPages(plan, slice, 0, 3), ...lampPages(plan, slice, 1, 3)];
  cycle(plan, store, 1, () => read);
  plan.observeCost(plan.budget.budgetMs, 1);
  for (let frame = 2; frame < 10; frame++) {
    store.set('lamp', { position: [0, 3 + frame / 10, 0] });
    cycle(plan, store, frame, () => read);
    for (const face of [0, 1])
      assert.ok(plan.table.words[lampFloor(plan, slice, face)] & PAGE_VALID, `face ${face}`);
  }
  assert.ok(plan.counts.pendingPages > 0, 'the finer pages wait on the budget');
});

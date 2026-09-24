// A light that moves every frame (#344): the frame draws the pages it reads at the light's new
// pose, coarse first within the budget; the floor every reader falls back to is current wherever
// the view can read it; and no page drawn at a past pose is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_VALID, SUN_LEVELS, sunEntry } from './virtual.ts';
import {
  SUN,
  VIEW,
  cycle,
  lampFloor,
  lampPages,
  planFrame,
  report,
  sunPages,
} from './lightShadow.fixture.ts';

const valid = (plan: ReturnType<typeof createShadowPlan>, entry: number) =>
  (plan.table.words[entry] & PAGE_VALID) !== 0;

test('a lamp that moves keeps the floor of every face current, not only the faces last read', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  // The receivers the reports saw lie in face 0 only; as the lamp moves, others enter its faces.
  const read = lampPages(plan, slice, 0, 3);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  plan.observeCost(plan.budget.budgetMs, 1);
  for (let frame = 4; frame < 12; frame++) {
    store.set('lamp', { position: [frame / 10, 3, 0] });
    cycle(plan, store, frame, () => read);
    for (let face = 0; face < 6; face++)
      assert.ok(valid(plan, lampFloor(plan, slice, face)), `face ${face} at frame ${frame}`);
  }
});

test('a sun that turns every frame keeps every floor page its view reaches current', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = () =>
    sunPages(plan, slice, plan.sun.finest[slice] + 4, [
      [0, 0],
      [1, 0],
    ]);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, read);
  plan.observeCost(plan.budget.budgetMs, 1);
  const reach = new Int32Array(4);
  for (let frame = 4; frame < 12; frame++) {
    const t = frame / 20;
    store.set('sun', { direction: [Math.sin(t), -Math.cos(t), 0] });
    cycle(plan, store, frame, read);
    const level = plan.sun.finest[slice] + SUN_LEVELS - 1;
    plan.sun.floorReach(slice, VIEW, reach);
    for (let y = reach[1]; y <= reach[3]; y++)
      for (let x = reach[0]; x <= reach[2]; x++) {
        const entry = plan.table.baseOf(slice) + sunEntry(level, x, y);
        assert.ok(valid(plan, entry), `floor page ${x},${y} at frame ${frame}`);
      }
  }
});

test('a light moved every frame draws coarse first: no finer page overtakes by its wait', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  const torch = { position: [0, 3, 0], direction: [0, -1, 0], coneAngle: 0.8, range: 20 };
  store.add({ ...SUN, ...torch, id: 'torch', kind: 'spot' } as typeof SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const coarse = lampPages(plan, slice, 0, 4),
    fine = lampPages(plan, slice, 0, 3),
    read = [...coarse, ...fine];
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  // Six pages fit the budget: the floor, the four coarse pages, and one fine page.
  plan.observeCost(plan.budget.budgetMs / 6.5, 1);
  for (let frame = 4; frame < 20; frame++) {
    store.set('torch', { position: [frame / 10, 3, 0] });
    cycle(plan, store, frame, () => read);
    assert.ok(
      coarse.every((entry) => valid(plan, entry)),
      `every coarse page drawn at frame ${frame}`,
    );
  }
  // Guard, green on develop too: once the light stops, the finer pages come as the budget allows.
  for (let frame = 20; frame < 30; frame++) cycle(plan, store, frame, () => read);
  assert.ok(
    read.every((entry) => valid(plan, entry)),
    'every page drawn once it stops',
  );
});

test('guard: after a move, every page read was drawn in that frame, at the new pose', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = [...lampPages(plan, slice, 0, 4), ...lampPages(plan, slice, 0, 3)];
  for (let frame = 1; frame < 6; frame++) cycle(plan, store, frame, () => read);
  plan.observeCost(plan.budget.budgetMs / 4.5, 1);
  for (let frame = 6; frame < 14; frame++) {
    store.set('lamp', { position: [0, 3 + frame / 10, 0] });
    planFrame(plan, store, frame);
    const drawn = new Set(plan.admission.list.subarray(0, plan.admission.count));
    plan.commit();
    report(plan, store, frame, read);
    for (let page = 0; page < plan.pool.pages; page++)
      if (plan.pool.owner[page] >= 0 && plan.pool.slice[page] === slice && plan.pool.valid[page])
        assert.ok(drawn.has(page), `page ${page} read at frame ${frame} was not drawn in it`);
  }
});

// A light that moves every frame (#344): the frame draws the pages it reads at the light's new
// pose, floors first, then coarse first within the budget; no page drawn at a past pose is read, and
// a face whose floor the frame cannot draw reads no shadow until its turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_VALID, SUN_LEVELS, sunEntry } from './virtual.ts';
import {
  SUN,
  VIEW,
  cycle,
  cycleDrawn,
  lampScene,
  lampFloor,
  lampPages,
  planFrame,
  readPages,
  sunPages,
} from './lightShadow.fixture.ts';

const valid = (plan: ReturnType<typeof createShadowPlan>, entry: number) =>
  (plan.table.words[entry] & PAGE_VALID) !== 0;
/** The physical page of lamp `face`'s floor. */
const floorPage = (plan: ReturnType<typeof createShadowPlan>, slice: number, face: number) =>
  plan.table.words[lampFloor(plan, slice, face)] & PAGE_INDEX_MASK;

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

test('after a move, no page drawn at a past pose is read, and each face floor takes its turn', () => {
  const { store, plan, slice } = lampScene();
  const read = [...lampPages(plan, slice, 0, 4), ...lampPages(plan, slice, 0, 3)];
  for (let face = 1; face < 6; face++) read.push(lampFloor(plan, slice, face));
  for (let frame = 1; frame < 6; frame++) cycle(plan, store, frame, () => read);
  // One view a frame: six face floors, one drawn per frame, and the finer pages wait.
  plan.admission.setViewLimit(1);
  const floorDrawn = new Int32Array(6).fill(5);
  for (let frame = 6; frame < 30; frame++) {
    store.set('lamp', { position: [0, 3 + frame / 10, 0] });
    const drawn = cycleDrawn(plan, store, frame, () => read);
    for (const page of readPages(plan, slice))
      assert.ok(drawn.has(page), `page ${page} read at frame ${frame} was drawn at a past pose`);
    for (let face = 0; face < 6; face++) {
      if (drawn.has(floorPage(plan, slice, face))) floorDrawn[face] = frame;
      assert.ok(frame - floorDrawn[face] < 6, `face ${face} floor waits past frame ${frame}`);
    }
  }
});

test('one lamp moving under the page cap draws the floor of every face read in the frame', () => {
  const { store, plan, slice } = lampScene();
  const read = [...lampPages(plan, slice, 0, 3), ...lampPages(plan, slice, 1, 3)];
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  // One page a frame: the withdrawn finer pages would take it, were the floors not first.
  plan.observeCost(plan.budget.budgetMs, 1);
  for (let frame = 4; frame < 12; frame++) {
    store.set('lamp', { position: [frame / 10, 3, 0] });
    const drawn = cycleDrawn(plan, store, frame, () => read);
    for (const face of [0, 1]) {
      const entry = lampFloor(plan, slice, face);
      assert.ok(valid(plan, entry), `face ${face} floor read at frame ${frame}`);
      assert.ok(drawn.has(floorPage(plan, slice, face)), `face ${face} drawn at frame ${frame}`);
    }
  }
});

test('a light whose intensity or colour changes neither re-poses nor withdraws a page', () => {
  const { store, plan, slice } = lampScene();
  const read = [...lampPages(plan, slice, 0, 4), ...lampPages(plan, slice, 0, 3)];
  for (let frame = 1; frame < 6; frame++) cycle(plan, store, frame, () => read);
  for (let frame = 6; frame < 12; frame++) {
    store.set('lamp', { intensity: frame, color: [1, frame / 12, 1] });
    assert.equal(
      cycle(plan, store, frame, () => read),
      0,
      `nothing drawn at frame ${frame}`,
    );
    assert.ok(
      read.every((entry) => valid(plan, entry)),
      `every page still read at frame ${frame}`,
    );
  }
});

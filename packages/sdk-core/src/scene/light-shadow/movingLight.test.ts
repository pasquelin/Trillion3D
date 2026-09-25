// A light that moves every frame (#344, #489): the frame draws every page it reads at the light's
// new pose, floors included, in that frame; no page drawn at a past pose is ever read.
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
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = () =>
    sunPages(plan, slice, plan.sun.finest[slice] + 4, [
      [0, 0],
      [1, 0],
    ]);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, read);
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

test('a light moved every frame draws every page it reads, and every face floor, in the frame', () => {
  const { store, plan, slice } = lampScene();
  const read = [...lampPages(plan, slice, 0, 4), ...lampPages(plan, slice, 0, 3)];
  for (let frame = 1; frame < 6; frame++) cycle(plan, store, frame, () => read);
  for (let frame = 6; frame < 30; frame++) {
    store.set('lamp', { position: [0, 3 + frame / 10, 0] });
    const drawn = cycleDrawn(plan, store, frame, () => read);
    for (const page of readPages(plan, slice))
      assert.ok(drawn.has(page), `page ${page} read at frame ${frame} was drawn at a past pose`);
    assert.ok(
      read.every((entry) => valid(plan, entry)),
      `every page read at frame ${frame}`,
    );
    for (let face = 0; face < 6; face++)
      assert.ok(drawn.has(floorPage(plan, slice, face)), `face ${face} floor at frame ${frame}`);
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

// Never no shadow: over budget, the floor under every page the shading reads — a sun's last level,
// a lamp face's one-page mip — is current every frame, so a reader that falls back past a withdrawn
// page never reaches the far ray of a sun or the unshadowed answer of a lamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_VALID, sunEntry, sunFloorLevel, sunPageMetres } from './virtual.ts';
import {
  SUN,
  VIEW,
  cycle,
  lampScene,
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
  const { store, plan, slice } = lampScene();
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

test('a new light reads its floor from its first frame, before any report comes back', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  plan.commit();
  const sun = store.sliceOf(0),
    lamp = store.sliceOf(1);
  assert.ok(plan.table.words[sunFloor(plan, sun)] & PAGE_VALID, 'the sun floor');
  for (let face = 0; face < 6; face++)
    assert.ok(plan.table.words[lampFloor(plan, lamp, face)] & PAGE_VALID, `lamp face ${face}`);
});

/** Every face floor of each lamp in `slices` is read: none answers 1.0 for want of a floor. */
function assertFloors(plan: ReturnType<typeof createShadowPlan>, slices: number[], frame: number) {
  for (const slice of slices)
    for (let face = 0; face < 6; face++)
      assert.ok(
        plan.table.words[lampFloor(plan, slice, face)] & PAGE_VALID,
        `slice ${slice} face ${face} at frame ${frame}`,
      );
}

/** `count` point lamps, ten units apart, planned once: their slices. */
function lamps(store: ReturnType<typeof createSceneLightStore>, count: number) {
  for (let k = 0; k < count; k++)
    store.add({ ...SUN, id: `lamp${k}`, kind: 'point', position: [k * 10, 3, 0], range: 20 });
  return Array.from({ length: count }, (_, k) => k);
}

test('past the view limit, every face of lamps that all keep moving has a floor every frame', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  const ids = lamps(store, 3);
  planFrame(plan, store, 0);
  const slices = ids.map((k) => store.sliceOf(k));
  const read = slices.flatMap((slice) => lampPages(plan, slice, 0, 3));
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  plan.admission.setViewLimit(1);
  for (let frame = 4; frame < 40; frame++) {
    for (const k of ids) store.set(`lamp${k}`, { position: [k * 10, 3 + frame / 10, 0] });
    cycle(plan, store, frame, () => read);
    assertFloors(plan, slices, frame);
  }
});

test('five lamps moving every frame, thirty floors past the page cap, keep a floor on every face', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  const ids = lamps(store, 5);
  planFrame(plan, store, 0);
  plan.commit();
  const slices = ids.map((k) => store.sliceOf(k));
  const read = slices.flatMap((slice) => lampPages(plan, slice, 0, 3));
  for (let frame = 1; frame < 30; frame++) {
    for (const k of ids) store.set(`lamp${k}`, { position: [k * 10, 3 + frame / 10, 0] });
    cycle(plan, store, frame, () => read);
    // Twenty-four floors a frame: the thirty are all drawn once by the second.
    if (frame > 1) assertFloors(plan, slices, frame);
  }
});

test('a camera that moves brings in the sun floor pages its view reaches, drawn in the frame', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = sunPages(plan, slice, plan.sun.finest[slice] + 4, [[0, 0]]);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  const level = sunFloorLevel(plan.sun.finest[slice]),
    reach = new Int32Array(4);
  for (let frame = 4; frame < 12; frame++) {
    // The sun holds still; the camera walks a floor page a frame, so no report names them yet.
    const view = { ...VIEW, position: [(frame - 3) * sunPageMetres(level), 5, 0] as const };
    cycle(plan, store, frame, () => read, view);
    plan.sun.floorReach(slice, view, reach);
    for (let y = reach[1]; y <= reach[3]; y++)
      for (let x = reach[0]; x <= reach[2]; x++) {
        const entry = plan.table.baseOf(slice) + sunEntry(level, x, y);
        assert.ok(plan.table.words[entry] & PAGE_VALID, `floor page ${x},${y} at frame ${frame}`);
      }
  }
});

test('past the page cap, the sun floor pages a walking camera brings in outrank the stale lamp floors', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  const ids = lamps(store, 5);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slices = ids.map((k) => store.sliceOf(k)),
    sun = store.sliceOf(ids.length);
  const read = slices.flatMap((slice) => lampPages(plan, slice, 0, 3));
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  const level = sunFloorLevel(plan.sun.finest[sun]),
    reach = new Int32Array(4);
  for (let frame = 4; frame < 20; frame++) {
    // Thirty lamp floors stale at a past pose, and new sun floor pages no one has drawn yet.
    for (const k of ids) store.set(`lamp${k}`, { position: [k * 10, 3 + frame / 10, 0] });
    const view = { ...VIEW, position: [(frame - 3) * sunPageMetres(level), 5, 0] as const };
    cycle(plan, store, frame, () => read, view);
    assertFloors(plan, slices, frame);
    plan.sun.floorReach(sun, view, reach);
    for (let y = reach[1]; y <= reach[3]; y++)
      for (let x = reach[0]; x <= reach[2]; x++) {
        const entry = plan.table.baseOf(sun) + sunEntry(level, x, y);
        assert.ok(plan.table.words[entry] & PAGE_VALID, `floor page ${x},${y} at frame ${frame}`);
      }
  }
});

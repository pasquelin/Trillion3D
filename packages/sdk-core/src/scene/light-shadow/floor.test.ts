// The floor under every page the shading reads — a sun's last level, a lamp face's one-page mip — is
// drawn first, over budget, so a reader that falls back past a withdrawn page reads a current floor.
// Past the page cap, a face whose floor waits its turn reads no shadow, never one at a past pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_VALID, sunEntry, sunFloorLevel, sunPageMetres } from './virtual.ts';
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

/** `count` point lamps, ten units apart, planned once: their slices. */
function lamps(store: ReturnType<typeof createSceneLightStore>, count: number) {
  for (let k = 0; k < count; k++)
    store.add({ ...SUN, id: `lamp${k}`, kind: 'point', position: [k * 10, 3, 0], range: 20 });
  return Array.from({ length: count }, (_, k) => k);
}

test('five lamps moving over the page cap: a face not drawn reads nothing stale, and waits one frame', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  const ids = lamps(store, 5);
  store.add(SUN);
  planFrame(plan, store, 0);
  plan.commit();
  const slices = ids.map((k) => store.sliceOf(k)),
    sun = store.sliceOf(ids.length);
  const read = slices.flatMap((slice) => lampPages(plan, slice, 0, 3));
  const level = sunFloorLevel(plan.sun.finest[sun]),
    reach = new Int32Array(4),
    drewFloor = new Int32Array(ids.length * 6);
  for (let frame = 1; frame < 20; frame++) {
    // Thirty lamp floors past the cap of twenty-four, and the sun floor pages a walking camera
    // brings in beside them.
    for (const k of ids) store.set(`lamp${k}`, { position: [k * 10, 3 + frame / 10, 0] });
    const view = { ...VIEW, position: [frame * sunPageMetres(level), 5, 0] as const };
    const drawn = cycleDrawn(plan, store, frame, () => read, view);
    for (const [k, slice] of slices.entries()) {
      for (const page of readPages(plan, slice))
        assert.ok(drawn.has(page), `slice ${slice} page ${page} read stale at frame ${frame}`);
      for (let face = 0; face < 6; face++) {
        const page = plan.table.words[lampFloor(plan, slice, face)] & PAGE_INDEX_MASK;
        if (drawn.has(page)) drewFloor[k * 6 + face] = frame;
        assert.ok(frame - drewFloor[k * 6 + face] < 2, `slice ${slice} face ${face} at ${frame}`);
      }
    }
    // The sun holds still: the floor pages its last view reached were drawn by now.
    if (frame > 1)
      for (let y = reach[1]; y <= reach[3]; y++)
        for (let x = reach[0]; x <= reach[2]; x++) {
          const entry = plan.table.baseOf(sun) + sunEntry(level, x, y);
          assert.ok(plan.table.words[entry] & PAGE_VALID, `floor page ${x},${y} at ${frame}`);
        }
    plan.sun.floorReach(sun, view, reach);
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

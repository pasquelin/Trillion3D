// A moved point lamp asks for the floor of every face it reaches, and the frame draws them all
// (#489): a face a receiver enters has a floor the frame it is read, and the faces read keep a
// current floor every frame, beside the still lights' pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import {
  SUN,
  cycleDrawn,
  lampFloor,
  lampPages,
  planFrame,
  sunPages,
} from './lightShadow.fixture.ts';

const LAMP = { ...SUN, kind: 'point' as const, range: 20 };
const valid = (plan: ShadowPlan, entry: number) => (plan.table.words[entry] & PAGE_VALID) !== 0;
/** The physical page `entry` maps to, or −1. */
const pageOf = (plan: ShadowPlan, entry: number) => {
  const word = plan.table.words[entry];
  return word & PAGE_MAPPED ? word & PAGE_INDEX_MASK : -1;
};

/** Point lamps named `ids`, ten units apart, planned once: the store, the plan and their slices. */
function lampsScene(...ids: string[]) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  ids.forEach((id, k) => store.add({ ...LAMP, id, position: [k * 10, 3, 0] }));
  planFrame(plan, store, 0);
  plan.commit();
  return { store, plan, slices: ids.map((_, k) => store.sliceOf(k)) };
}

test('a receiver entering a new face of a moving lamp reads its floor the frame it enters', () => {
  const {
    store,
    plan,
    slices: [slice],
  } = lampsScene('lamp');
  // Face 0 is read until frame 6, then face 2: no report has named face 2 yet.
  const read = (frame: number) => [lampFloor(plan, slice, frame < 6 ? 0 : 2)];
  for (let frame = 1; frame < 12; frame++) {
    store.set('lamp', { position: [frame / 10, 3, 0] });
    cycleDrawn(plan, store, frame, () => read(frame));
    for (const entry of read(frame)) assert.ok(valid(plan, entry), `frame ${frame}`);
  }
});

test('while the lamp moves, the two faces read keep a current floor every frame', () => {
  const {
    store,
    plan,
    slices: [slice],
  } = lampsScene('lamp');
  const read = [...lampPages(plan, slice, 0, 3), ...lampPages(plan, slice, 1, 3)];
  cycleDrawn(plan, store, 1, () => read);
  for (let frame = 2; frame < 20; frame++) {
    store.set('lamp', { position: [0, 3 + frame / 10, 0] });
    const drawn = cycleDrawn(plan, store, frame, () => read);
    for (const face of [0, 1]) {
      const floor = lampFloor(plan, slice, face);
      assert.ok(valid(plan, floor), `face ${face} floor read at frame ${frame}`);
      assert.ok(drawn.has(pageOf(plan, floor)), `face ${face} floor drawn at frame ${frame}`);
    }
  }
});

test('a moving lamp the latest report did not read has a floor the frame it starts being read', () => {
  const {
    store,
    plan,
    slices: [read0, unread],
  } = lampsScene('lamp0', 'lamp1');
  // Lamp 0 is read on face 0 throughout; lamp 1 from frame 6 on, on face 3.
  const read = (frame: number) => [
    lampFloor(plan, read0, 0),
    ...(frame < 6 ? [] : [lampFloor(plan, unread, 3)]),
  ];
  for (let frame = 1; frame < 12; frame++) {
    for (const [k, id] of ['lamp0', 'lamp1'].entries())
      store.set(id, { position: [k * 10 + frame / 10, 3, 0] });
    cycleDrawn(plan, store, frame, () => read(frame));
    for (const entry of read(frame)) assert.ok(valid(plan, entry), `entry ${entry}, ${frame}`);
  }
});

test('the still lights stay current while a lamp moves beside them', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  store.add({ ...LAMP, id: 'lamp0', position: [0, 3, 0] });
  store.add({ ...LAMP, id: 'lamp1', position: [10, 3, 0] });
  planFrame(plan, store, 0);
  plan.commit();
  const [sun, lamp0, lamp1] = [0, 1, 2].map((slot) => store.sliceOf(slot));
  const read = () => [
    lampFloor(plan, lamp0, 0),
    ...sunPages(plan, sun, plan.sun.finest[sun] + 4, [
      [0, 0],
      [1, 0],
    ]),
    ...lampPages(plan, lamp1, 2, 3),
  ];
  cycleDrawn(plan, store, 1, read);
  for (let frame = 2; frame < 20; frame++) {
    store.set('lamp0', { position: [frame / 10, 3, 0] });
    cycleDrawn(plan, store, frame, read);
    assert.ok(
      read().every((entry) => valid(plan, entry)),
      `every page read is drawn at frame ${frame}`,
    );
    assert.equal(plan.counts.pendingPages, 0, 'nothing pending');
  }
});

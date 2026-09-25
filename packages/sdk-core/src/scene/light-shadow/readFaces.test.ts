// A moved point lamp asks for the floors of the faces its receivers read, not all six (#489): a
// face nobody reads costs no light view, so the read faces keep a current floor within the view
// limit. A lamp no report has read yet asks for every face's floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import { viewKeyOf } from './admit.ts';
import {
  SUN,
  cycleDrawn,
  lampFloor,
  lampPages,
  planFrame,
  report,
  sunPages,
} from './lightShadow.fixture.ts';

const LAMP = { ...SUN, kind: 'point' as const, range: 20 };
const valid = (plan: ShadowPlan, entry: number) => (plan.table.words[entry] & PAGE_VALID) !== 0;
/** The physical page `entry` maps to, or −1. */
const pageOf = (plan: ShadowPlan, entry: number) => {
  const word = plan.table.words[entry];
  return word & PAGE_MAPPED ? word & PAGE_INDEX_MASK : -1;
};
/** The light views of `slice` the frame drew in. */
const viewsOf = (plan: ShadowPlan, drawn: Set<number>, slice: number) =>
  new Set(
    [...drawn].filter((p) => plan.pool.slice[p] === slice).map((p) => viewKeyOf(plan.pool, p)),
  );
/** The faces of lamp `slice` whose floor the frame drew. */
const floorsDrawn = (plan: ShadowPlan, drawn: Set<number>, slice: number) =>
  [0, 1, 2, 3, 4, 5].filter((face) => drawn.has(pageOf(plan, lampFloor(plan, slice, face))));

test('a moving lamp read on one face draws one view a frame; the still lights converge', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  store.add({ ...LAMP, id: 'lamp0', position: [0, 3, 0] });
  store.add({ ...LAMP, id: 'lamp1', position: [10, 3, 0] });
  planFrame(plan, store, 0);
  plan.commit();
  const [sun, lamp0, lamp1] = [0, 1, 2].map((slot) => store.sliceOf(slot));
  const still = [
    ...sunPages(plan, sun, plan.sun.finest[sun] + 4, [
      [0, 0],
      [1, 0],
    ]),
    ...lampPages(plan, lamp1, 2, 3),
  ];
  const read = () => [lampFloor(plan, lamp0, 0), ...still];
  for (let frame = 1; frame < 20; frame++) {
    store.set('lamp0', { position: [frame / 10, 3, 0] });
    const drawn = cycleDrawn(plan, store, frame, read);
    if (frame < 2) continue;
    assert.equal(viewsOf(plan, drawn, lamp0).size, 1, `lamp 0 views at frame ${frame}`);
    assert.deepEqual(floorsDrawn(plan, drawn, lamp0), [0], `lamp 0 floors at frame ${frame}`);
  }
  for (let frame = 20; frame < 24; frame++) cycleDrawn(plan, store, frame, read);
  assert.ok(
    read().every((entry) => valid(plan, entry)),
    'every page read is drawn',
  );
  assert.equal(plan.counts.pendingPages, 0, 'nothing pending once the lamp stops');
});

test('at a view limit of three, the two faces read keep a current floor every frame', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...LAMP, id: 'lamp', position: [0, 3, 0] });
  planFrame(plan, store, 0);
  plan.commit();
  const slice = store.sliceOf(0);
  const read = [...lampPages(plan, slice, 0, 3), ...lampPages(plan, slice, 1, 3)];
  cycleDrawn(plan, store, 1, () => read);
  plan.admission.setViewLimit(3);
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

test('a new lamp draws all six floors until a report reads it, then only the faces read', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...LAMP, id: 'old', position: [0, 3, 0] });
  planFrame(plan, store, 0);
  plan.commit();
  const old = store.sliceOf(0);
  // The old lamp is read on face 2 only, then leaves; the new one takes its slice.
  for (let frame = 1; frame < 4; frame++)
    cycleDrawn(plan, store, frame, () => [lampFloor(plan, old, 2)]);
  store.remove('old');
  store.add({ ...LAMP, id: 'new', position: [5, 3, 0] });
  for (let frame = 4; frame < 6; frame++) {
    // Moving from birth, and no report back yet.
    store.set('new', { position: [5 + frame / 10, 3, 0] });
    planFrame(plan, store, frame);
    const slice = store.sliceOf(0),
      drawn = new Set(plan.admission.list.subarray(0, plan.admission.count));
    plan.commit();
    assert.equal(slice, old, 'the new lamp reuses the slice');
    assert.deepEqual(floorsDrawn(plan, drawn, slice), [0, 1, 2, 3, 4, 5], `frame ${frame}`);
  }
  report(plan, store, 5, [lampFloor(plan, old, 0)]);
  for (let frame = 6; frame < 10; frame++) {
    store.set('new', { position: [5 + frame / 10, 3, 0] });
    const drawn = cycleDrawn(plan, store, frame, () => [lampFloor(plan, old, 0)]);
    assert.deepEqual(floorsDrawn(plan, drawn, old), [0], `frame ${frame}`);
  }
});

// A light removed from the store must return its shadow slice and its atlas cells at the next
// `plan()` — never before, never after. `createShadowRelease` (sceneLightShadowRelease.ts) is
// the only release path: these tests go through it by the only public path, `plan()`, without
// ever calling it directly, exactly as the engine does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import { createShadowPlan } from './sceneLightShadowPlan.ts';
import { RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { MAX_SHADOW_SLICES, type SceneLight, type ShadowViewpoint } from './sceneLightContracts.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.9,
  aspect: 1,
  near: 0.1,
  far: 100,
};

/** A shadowed point light, all identical: same screen coverage, same requested slice. */
function pointLight(id: string): SceneLight {
  return {
    id,
    kind: 'point',
    position: [0, 0, -5],
    color: [1, 1, 1],
    intensity: 1,
    range: 5,
    castsShadow: true,
  };
}

function freeSlices(plan: ReturnType<typeof createShadowPlan>) {
  let free = 0;
  for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) if (!plan.slices.taken[slice]) free++;
  return free;
}

test('removing a shadowed light returns its slice and atlas cells at the next plan()', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  store.add(pointLight('l0'));
  plan.plan(store, VIEW, 0, 0);

  const slice = store.sliceOf(store.slotOf('l0'));
  assert.ok(slice >= 0, 'the light did get a slice on the first frame');
  assert.equal(plan.slices.taken[slice], 1);
  assert.ok(plan.slices.atlas.occupancy().used > 0, 'atlas cells are taken');

  store.remove('l0');
  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.taken[slice], 0, 'the slice is released');
  assert.equal(plan.slices.atlas.occupancy().used, 0, 'the atlas cells are released');
  assert.equal(freeSlices(plan), MAX_SHADOW_SLICES, 'the 64 slices are free again');
});

test('a removal in the middle of the list leaves the moved light its own slice and atlas rectangle', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  for (const id of ['a', 'b', 'c']) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);

  const sliceA = store.sliceOf(store.slotOf('a'));
  const sliceB = store.sliceOf(store.slotOf('b'));
  const sliceC = store.sliceOf(store.slotOf('c'));
  const rectCBefore = Array.from(
    plan.slices.rects.subarray(sliceC * RECTS_PER_SLICE, (sliceC + 1) * RECTS_PER_SLICE),
  );

  // The store removes by swap: 'c', last in the list, takes the slot of 'a'.
  store.remove('a');
  assert.equal(store.slotOf('c'), 0, 'the store moved c to the slot freed by a');
  assert.equal(store.sliceOf(0), sliceC, 'c kept its own slice during the move');

  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.taken[sliceA], 0, "the removed light's slice is released");
  assert.equal(plan.slices.taken[sliceC], 1, 'c still keeps its slice, the same as before');
  assert.equal(plan.slices.taken[sliceB], 1, 'b, never moved, is not affected');
  const rectCAfter = Array.from(
    plan.slices.rects.subarray(sliceC * RECTS_PER_SLICE, (sliceC + 1) * RECTS_PER_SLICE),
  );
  assert.deepEqual(rectCAfter, rectCBefore, "c's atlas rectangle has not moved");
});

test('removing every light brings atlas occupancy to zero and the 64 slices to free', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  const ids = Array.from({ length: 5 }, (_, i) => `l${i}`);
  for (const id of ids) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);
  assert.ok(plan.slices.atlas.occupancy().used > 0, 'the atlas does carry the five lights');

  for (const id of ids) store.remove(id);
  plan.plan(store, VIEW, 1, 16);

  assert.equal(plan.slices.atlas.occupancy().used, 0, 'not a single occupied cell left');
  assert.equal(freeSlices(plan), MAX_SHADOW_SLICES, 'the 64 slices are free');
});

test('removing a light while regions are queued leaves neither a waiting page nor an occupied cell for it', () => {
  const store = createSceneLightStore();
  // Capacity of six regions: exactly one point light (six faces). The second light does not
  // make it this frame and its six faces stay waiting, as with a too-tight budget.
  const plan = createShadowPlan(6);
  store.add(pointLight('l0'));
  store.add(pointLight('l1'));
  plan.plan(store, VIEW, 0, 0);

  const slice1 = store.sliceOf(store.slotOf('l1'));
  assert.ok(slice1 >= 0, 'l1 still got a slice, just not its pages drawn');
  let pending = false;
  for (let face = 0; face < 6; face++) if (plan.slices.dirty.isDirty(slice1, face)) pending = true;
  assert.ok(pending, "l1 has waiting pages, for lack of room in this frame's regions");

  store.remove('l1');
  plan.plan(store, VIEW, 1, 16);

  for (let face = 0; face < 6; face++)
    assert.equal(
      plan.slices.dirty.isDirty(slice1, face),
      false,
      'no waiting page on a released slice',
    );
  assert.equal(plan.slices.taken[slice1], 0, 'and the slice itself is released');
});

test('three remove/re-add cycles of 21 shadowed lights give occupancy identical to the first cycle and zero denials', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(256);
  const ids = Array.from({ length: 21 }, (_, i) => `l${i}`);
  for (const id of ids) store.add(pointLight(id));
  plan.plan(store, VIEW, 0, 0);

  const baselineUsed = plan.slices.atlas.occupancy().used;
  const baselineFree = freeSlices(plan);
  // Figures from commit e99326a2 for this same scene (21 point lights, same settings): 43 slices
  // free out of 64, 504 atlas cells taken.
  assert.equal(baselineFree, MAX_SHADOW_SLICES - 21);
  assert.equal(baselineUsed, 504);
  assert.equal(plan.counts.denied, 0, 'all 21 lights fit in the 64 slices');

  let frame = 1;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const id of ids) store.remove(id);
    plan.plan(store, VIEW, frame++, frame * 16);
    assert.equal(plan.slices.atlas.occupancy().used, 0, `cycle ${cycle}: atlas emptied on removal`);
    assert.equal(freeSlices(plan), MAX_SHADOW_SLICES, `cycle ${cycle}: the 64 slices are free`);

    for (const id of ids) store.add(pointLight(id));
    plan.plan(store, VIEW, frame++, frame * 16);
    assert.equal(
      plan.slices.atlas.occupancy().used,
      baselineUsed,
      `cycle ${cycle}: atlas occupancy identical to the first cycle`,
    );
    assert.equal(
      freeSlices(plan),
      baselineFree,
      `cycle ${cycle}: free slices identical to the first cycle`,
    );
    // The original defect: without the release, removed slices stayed taken and, after
    // three cycles, the 64 were saturated — 21 denials instead of 21 slices released.
    assert.equal(plan.counts.denied, 0, `cycle ${cycle}: zero denials, unlike the original defect`);
  }
});

// #26 (perspective lamp pages, saturated pool): a still scene whose TAA-jittered reports name a
// slightly different page set each frame must not evict and refetch those pages every frame. The
// pool keeps every page the still cycle named, so once its pages fill the pool the resident set
// reaches a fixed state and the rest is refused — the A/A of a ring of shadowed lamps holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, lampPages, planFrame, report } from './lightShadow.fixture.ts';

/** A point lamp over a 4 × 4 pool, planned once: 16 pages, fewer than the pages the fine mip has. */
function saturatedLamp() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(4);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0),
    fine = lampPages(plan, slice, 0, 2),
    even = fine.filter((_, i) => i % 2 === 0),
    odd = fine.filter((_, i) => i % 2 === 1);
  return { store, plan, even, odd };
}

test('a saturated still pool keeps its cycle: a jittering report refetches nothing', () => {
  const { store, plan, even, odd } = saturatedLamp();
  let frame = 1;
  for (; frame <= 8; frame++) {
    report(plan, store, frame - 1, frame % 2 ? even : odd);
    planFrame(plan, store, frame);
    plan.commit();
  }
  const refetched = plan.pool.refetched,
    used = plan.pool.used();
  for (; frame <= 16; frame++) {
    report(plan, store, frame - 1, frame % 2 ? even : odd);
    planFrame(plan, store, frame);
    plan.commit();
  }
  assert.equal(plan.pool.used(), used, 'the resident set stops changing');
  assert.equal(plan.pool.refetched, refetched, 'no page is fetched again once the cycle holds');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLightStore } from '../light/store.ts';
import { SUN, VIEW } from './lightShadow.fixture.ts';
import { createShadowPlan } from './plan.ts';

test('reusing a readback slot for another view never overwrites a pending report', () => {
  const plan = createShadowPlan(8),
    store = createSceneLightStore();
  store.add(SUN);
  const draw = (key: unknown, frame: number) => {
    plan.useView(key);
    plan.plan(store, VIEW, [-20, 0, -20], [20, 10, 20], frame, 0);
    plan.commit();
  };
  draw(undefined, 0);
  draw('side', 1);
  draw(undefined, 2);
  const main = plan.receiver();
  draw('side', 3);
  const side = plan.receiver();
  const report = {
    frame: 3,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: 0,
    count: 0,
    entries: new Uint32Array(2),
    pool: {
      owner: plan.pool.owner.slice(),
      requested: plan.pool.requested.slice(),
      allocated: 0,
      refused: 0,
      drawn: 0,
      listings: 0,
    },
  };
  const owner = report.pool.owner.slice();
  plan.gpu.set(true, 0);
  main(report);
  // The same readback slot is submitted again and refilled while the main view is inactive.
  report.frame = 4;
  report.pool.owner.fill(-1);
  side(report);
  draw(undefined, 5);
  assert.equal(plan.requests.latest, 3);
  assert.deepEqual(plan.pool.owner, owner);
  draw('side', 6);
  assert.equal(plan.requests.latest, 4);
});

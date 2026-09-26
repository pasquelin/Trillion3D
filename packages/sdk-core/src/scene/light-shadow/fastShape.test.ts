// A moving frame reads the pool, the table and the slices page by page and entry by entry: those
// objects stay in V8's fast mode. One accessor in an object literal puts it in dictionary mode,
// and every read of its arrays in those loops then costs a hash lookup (#26).
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, VIEW, cycle, lampPages } from './lightShadow.fixture.ts';

v8.setFlagsFromString('--allow-natives-syntax');
const fastProperties = new Function('o', 'return %HasFastProperties(o)') as (o: object) => boolean;

test('the objects a moving frame reads page by page keep fast properties and true counts', () => {
  const store = createSceneLightStore(),
    plan = createShadowPlan(16);
  store.add(SUN);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  for (let frame = 0; frame < 8; frame++) {
    const view = { ...VIEW, position: [frame * 3, 5, 0] as [number, number, number] };
    cycle(plan, store, frame, () => lampPages(plan, store.sliceOf(1), 0, frame % 3), view);
  }
  for (const name of ['pool', 'table', 'records', 'admission', 'counts', 'sun'] as const)
    assert.ok(fastProperties(plan[name]), `${name} is read without a hash lookup`);
  const { pool } = plan;
  const mapped = pool.owner.filter((entry) => entry >= 0).length;
  assert.ok(mapped > 0, 'the frames mapped pages');
  assert.equal(pool.used, mapped, 'the pages mapped, counted as they are taken and released');
  assert.equal(plan.records.count, 2, 'one slice a shadow light');
  store.remove('lamp');
  cycle(plan, store, 8, () => []);
  assert.equal(plan.records.count, 1, 'a light gone gives its slice back');
  plan.reset();
  assert.equal(plan.records.count, 0);
  assert.equal(pool.used, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, VIEW, LAMP } from './lightShadow.fixture.ts';
import { PAGE_VALID } from './virtual.ts';

function scene(side = 32) {
  const store = createSceneLightStore(),
    plan = createShadowPlan(side);
  store.add(SUN);
  let frame = 0;
  const draw = (key: unknown, x = 0) => {
    plan.useView(key);
    const count = plan.plan(
      store,
      { ...VIEW, position: [x, 5, 0] },
      [-1000, 0, -1000],
      [1000, 10, 1000],
      frame++,
      0,
    );
    const slice = store.sliceOf(0);
    plan.commit();
    return { slice, count };
  };
  const pages = (slice: number) =>
    [...plan.pool.owner].flatMap((entry, page) =>
      entry >= 0 && plan.pool.slice[page] === slice ? [[page, entry]] : [],
    );
  return { store, plan, draw, pages };
}

test('alternating views keep distinct sun origins and pages, then each rests independently', () => {
  const { store, plan, draw, pages } = scene();
  const a = draw(undefined),
    heldA = pages(a.slice);
  assert.ok(heldA.length);
  const originA = [...plan.sun.frame],
    b = draw('right', 500);
  assert.notEqual(a.slice, b.slice);
  assert.deepEqual(pages(a.slice), heldA);
  assert.deepEqual(
    [...plan.sun.frame].slice(a.slice * 9, a.slice * 9 + 9),
    originA.slice(a.slice * 9, a.slice * 9 + 9),
  );
  const transport = store.transportEpoch;
  draw(undefined);
  assert.equal(plan.resting, true);
  draw('right', 500);
  assert.equal(plan.resting, true);
  assert.equal(
    store.transportEpoch,
    transport,
    'switching existing views changes no transported light',
  );
  draw('right', 501);
  assert.equal(plan.resting, false);
  draw(undefined);
  assert.equal(plan.resting, true, 'moving the other camera does not reset this view');
  for (const [, entry] of heldA) assert.ok(plan.table.words[entry] & PAGE_VALID);
});

test('a world change reaches both views even after the first plan consumes its changes', () => {
  const { plan, draw } = scene();
  draw(undefined);
  draw('right', 500);
  draw(undefined);
  draw('right', 500);
  plan.worldChanged([-10000, -10000, -10000], [10000, 10000, 10000]);
  draw(undefined);
  assert.ok(plan.counts.invalidatedPages > 0);
  draw('right', 500);
  assert.ok(plan.counts.invalidatedPages > 0, 'the second view consumes its own pending change');
});

test('removing one view releases only its sun pages and drops its late readback', () => {
  const { store, plan, draw, pages } = scene();
  store.add(LAMP);
  const a = draw(undefined),
    lamp = store.sliceOf(1),
    b = draw('right', 500);
  assert.equal(store.sliceOf(1), lamp, 'lamps share a projection');
  const receive = plan.receiver(),
    heldA = pages(a.slice);
  plan.removeView('right');
  assert.equal(plan.records.taken[b.slice], 0);
  assert.equal(pages(b.slice).length, 0);
  assert.deepEqual(pages(a.slice), heldA);
  assert.equal(plan.records.taken[lamp], 1);
  receive({
    frame: 999,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: 0,
    count: 0,
    entries: new Uint32Array(),
  });
  draw('right', 500);
  assert.equal(plan.requests.latest, -1, 'recreated view receives none of its predecessor reports');
});

test('the fixed slice ceiling refuses a view before stealing another view slice', () => {
  const { store, plan, draw } = scene();
  for (let i = 1; i < 4; i++) store.add({ ...SUN, id: `sun${i}` });
  const original = draw(undefined).slice;
  for (let i = 1; i < 16; i++) draw(i);
  assert.equal(plan.records.count, 64);
  assert.throws(() => plan.registerView('overflow', store), /SHADOW_VIEW_CAPACITY_EXCEEDED/);
  assert.equal(plan.records.count, 64);
  assert.equal(plan.records.taken[original], 1);
  draw(undefined);
  assert.equal(store.sliceOf(0), original);
  assert.equal(plan.counts.unslicedCasters, 0);
});

test('view admission reserves the shared pool and removal returns its reservation', () => {
  const { store, plan } = scene(2);
  for (const key of ['a', 'b', 'c']) plan.registerView(key, store);
  assert.throws(() => plan.registerView('d', store), /SHADOW_VIEW_POOL_EXCEEDED/);
  plan.removeView('b');
  assert.doesNotThrow(() => plan.registerView('d', store));
  assert.equal(plan.pool.pages, 4, 'admission never resizes the shared atlas');
});

test('a pool without room for the next actual floor refuses drawing and keeps the first view', () => {
  const { store, plan, draw, pages } = scene(2);
  const first = draw(undefined),
    held = pages(first.slice);
  assert.equal(held.length, 4);
  plan.registerView('side', store);
  assert.throws(() => draw('side', 500), /SHADOW_VIEW_POOL_EXCEEDED/);
  assert.deepEqual(pages(first.slice), held);
  assert.equal(plan.pool.pages, 4);
  draw(undefined);
  assert.equal(store.sliceOf(0), first.slice);
});

test('same-frame readbacks arriving backwards cannot roll back the shared GPU pool', () => {
  const { plan, draw } = scene();
  draw(undefined);
  draw('side', 500);
  draw(undefined);
  const earlier = plan.receiver();
  draw('side', 500);
  const later = plan.receiver(),
    owner = plan.pool.owner.slice(),
    requested = plan.pool.requested.slice();
  const report = (empty: boolean) => ({
    frame: 10,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: 0,
    count: 0,
    entries: new Uint32Array(),
    pool: {
      owner: empty ? new Int32Array(owner.length).fill(-1) : owner,
      requested,
      allocated: 0,
      refused: 0,
      drawn: empty ? 0 : 3,
      listings: empty ? 0 : 9,
    },
  });
  plan.gpu.set(true, 0);
  later(report(false));
  draw('side', 500);
  earlier(report(true));
  draw(undefined);
  assert.deepEqual(plan.pool.owner, owner);
  assert.equal(plan.gpu.listed, 3, 'late counts cannot overwrite a newer submission either');
});

test('a late readback from a retained view cannot resurrect slices removed since submission', () => {
  const { plan, draw } = scene();
  draw(undefined);
  draw('side', 500);
  draw(undefined);
  const receive = plan.receiver();
  plan.removeView('side');
  receive({
    frame: 99,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: 0,
    count: 0,
    entries: new Uint32Array(),
  });
  draw(undefined);
  assert.equal(plan.requests.latest, -1);
  plan.reset();
  assert.equal(plan.keptFrom(100), 100, 'reset forgets every view retention frame');
});

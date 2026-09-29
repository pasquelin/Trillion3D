// #1208: the shadow pool follows a canvas resize. Every page it still has room for keeps its entry,
// its state and — on the GPU — its depth, so nothing is drawn again; the lists the pool sizes follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { shadowPoolHostBytes } from './pool.ts';
import { SUN, cycle, sunFloor, sunPages } from './lightShadow.fixture.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID } from './virtual.ts';

/** A sun over a pool of `side²` pages, `read` pages drawn and read again until nothing is due. */
function settled(side: number, around: number) {
  const store = createSceneLightStore(),
    plan = createShadowPlan(side);
  store.add(SUN);
  cycle(plan, store, 0, () => []);
  const slice = store.sliceOf(0),
    grid = Array.from({ length: around * around }, (_, i) => [i % around, Math.floor(i / around)]);
  const read = () => [
    ...sunPages(plan, slice, plan.sun.finest[slice] + 4, grid),
    sunFloor(plan, slice),
  ];
  let frame = 1;
  for (; frame < 5; frame++) cycle(plan, store, frame, read);
  return { store, plan, slice, read, next: () => frame++ };
}

/** Each mapped entry, what its word says and the state of the page it maps to. */
function held(plan: ShadowPlan) {
  const { pool, table } = plan,
    state = new Map<number, number[]>();
  for (let page = 0; page < pool.pages; page++) {
    const entry = pool.owner[page];
    if (entry < 0) continue;
    const word = table.words[entry];
    assert.equal(word & PAGE_INDEX_MASK, page, 'the table maps the entry to its page');
    const fields = [pool.slice, pool.view, pool.x, pool.y, pool.rank, pool.requested, pool.dirty];
    state.set(entry, [word & ~PAGE_INDEX_MASK, ...[...fields, pool.valid].map((a) => a[page])]);
  }
  return state;
}

test('a pool resized larger then smaller keeps what it holds and draws nothing again', () => {
  const s = settled(4, 3);
  const before = held(s.plan);
  assert.ok(before.size >= 10 && before.size <= 16, 'nine pages and the floors, in a full pool');
  assert.ok([...before.values()].every(([word]) => word === (PAGE_MAPPED | PAGE_VALID)));
  const moved = s.plan.resize(8, 2);
  assert.deepEqual([s.plan.pool.side, s.plan.pool.layers, s.plan.pool.pages], [8, 2, 128]);
  assert.deepEqual(held(s.plan), before, 'every entry, its word and its state, kept');
  assert.equal(moved.filter((to) => to >= 0).length, before.size, 'every mapped page moved once');
  assert.equal(s.plan.pool.hostBytes, shadowPoolHostBytes(128), 'the host arrays follow');
  assert.equal(s.plan.admission.list.length, 128, 'the admission lists the new pool');
  assert.equal(cycle(s.plan, s.store, s.next(), s.read), 0, 'nothing drawn again');
  assert.equal(cycle(s.plan, s.store, s.next(), s.read), 0);
  // Smaller than what it holds: the floor and the most recently asked stay, the rest is released.
  const floor = sunFloor(s.plan, s.slice),
    grown = held(s.plan);
  s.plan.resize(2, 1);
  const kept = held(s.plan);
  assert.equal(kept.size, 4);
  assert.ok(kept.has(floor), 'the floor, what every page falls back to, is kept');
  for (const [entry, state] of kept) assert.deepEqual(state, grown.get(entry));
  for (const entry of before.keys())
    if (!kept.has(entry)) assert.equal(s.plan.table.words[entry], 0, 'released: reads nothing');
  assert.equal(s.plan.pool.used(), 4);
});

test('the requests a report may name follow the pool past their floor', () => {
  const store = createSceneLightStore(),
    plan = createShadowPlan(4);
  store.add(SUN);
  cycle(plan, store, 0, () => []);
  const slice = store.sliceOf(0),
    around = Array.from({ length: 2500 }, (_, i) => [(i % 50) - 25, Math.floor(i / 50) - 25]);
  const level = (step: number) => sunPages(plan, slice, plan.sun.finest[slice] + step, around);
  const read = () => [...level(5), ...level(6)];
  cycle(plan, store, 1, read);
  cycle(plan, store, 2, read);
  assert.equal(plan.requests.counts.requested, 4096, 'a 16-page pool reads the floor of the list');
  plan.resize(72, 1);
  assert.equal(plan.requests.counts.requested, 4096, 'the counts go on where they stopped');
  cycle(plan, store, 3, read);
  cycle(plan, store, 4, read);
  assert.equal(plan.requests.counts.requested, 5000, 'a 5 184-page pool reads the whole report');
  assert.equal(plan.requests.counts.unlisted, 0);
  assert.equal(plan.requests.counts.refused, 0, 'every page named mapped');
});

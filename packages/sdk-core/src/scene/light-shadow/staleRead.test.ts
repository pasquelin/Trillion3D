// What a frame reads of pages that wait to be drawn again: a page whose depth is wrong is withdrawn
// — the one flag the shading reads —, a page whose static casters still hold stays read, the pages
// pending drain at the budget's rate whatever the light cut bounds, and a camera that only moves
// redraws none of the pages whose casters and light stayed where they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import * as virtual from './virtual.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import { STALE_DYNAMIC } from './pool.ts';
import { SUN, VIEW, cycle, planFrame, sunFloor, sunPages } from './lightShadow.fixture.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';

/** A sun whose level `finest + 4` the shading reads at `pages`, drawn and settled. */
function drawnSun(pages: number[][]) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0),
    level = plan.sun.finest[slice] + 4;
  const entries = sunPages(plan, slice, level, pages);
  let frame = 1;
  while (cycle(plan, store, frame, () => entries) || frame < 3) frame++;
  return { store, plan, entries, level };
}

/** A word the shading reads: its page, mapped and valid, and no other state beside. */
const current = (word: number) => (word & ~(PAGE_INDEX_MASK | PAGE_MAPPED)) === PAGE_VALID;

const row = (count: number) => Array.from({ length: count }, (_, x) => [x, 0]);

test('a page whose depth is wrong is withdrawn until its draw lands, by one flag alone', () => {
  const { store, plan, entries } = drawnSun(row(3));
  assert.ok(
    entries.every((entry) => current(plan.table.words[entry])),
    'drawn: all current',
  );
  // One page a frame, the floor paid first — the four floor pages the view reaches —: the three
  // wait, and the shading falls back to it.
  plan.observeCost(plan.budget.budgetMs, 1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  let frame = 10;
  assert.equal(planFrame(plan, store, frame), 4, 'the floor alone');
  plan.commit();
  const readable = () => entries.filter((entry) => current(plan.table.words[entry])).length;
  assert.equal(readable(), 0, 'none of the three is read before it is drawn');
  // One mechanism: the valid bit the shading tests is the one the scheduler clears.
  assert.equal('PAGE_STALE' in virtual, false, 'no second flag in the table word');
  assert.equal('hideStale' in plan.pool, false, 'no second way to hide a page');
  while (readable() < entries.length) cycle(plan, store, ++frame, () => entries);
  assert.equal(frame, 13, 'each current once drawn, one a frame');
});

test('a static shadow stays read while a caster near it moves', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // One page a frame; an object already moving crosses every page, frame after frame.
  plan.observeCost(plan.budget.budgetMs, 1);
  for (let frame = 60; frame < 66; frame++) {
    plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], true);
    cycle(plan, store, frame, () => entries);
    const waiting = entries.filter(
      (entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK] === STALE_DYNAMIC,
    );
    assert.ok(waiting.length > 0, 'the budget leaves pages waiting');
    assert.ok(
      entries.every((entry) => current(plan.table.words[entry])),
      'their static layer holds: every page still read',
    );
  }
});

test('a floor still read waits its turn: a caster that keeps moving never starves the finer pages', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // One page a frame; an object already moving crosses every page, the floor too, every frame.
  plan.observeCost(plan.budget.budgetMs, 1);
  const redrawn = new Set<number>();
  for (let frame = 70; frame < 90; frame++) {
    plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], true);
    cycle(plan, store, frame, () => entries);
    for (const entry of entries)
      if (!plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK]) redrawn.add(entry);
  }
  assert.equal(redrawn.size, entries.length, 'every finer page redrawn while the caster moves');
});

test('pages pending drain in N / limit frames at the fixed budget, whatever the cut dropped', () => {
  const { store, plan, entries } = drawnSun(row(12));
  // A page costs a quarter of the budget: four a frame. The cut dropped down to one view.
  plan.observeCost(plan.budget.budgetMs / 4, 1);
  plan.admission.setViewLimit(1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  let frame = 20,
    drawn = 0;
  for (let i = 0; i < 1 + 12 / 4; i++) drawn += cycle(plan, store, frame++, () => entries);
  // The four floor pages the view reaches, then twelve pages of one view drained in three frames.
  assert.equal(drawn, 4 + 12, 'the floor, then twelve pages of one view drained in three frames');
  assert.equal(plan.counts.pendingPages, 0);
});

test('a pure camera translation redraws no page whose casters and light are static', () => {
  const { store, plan, entries, level } = drawnSun(row(3));
  const step = 128 * 2 ** level;
  let frame = 30;
  for (let i = 1; i <= 4; i++) {
    const view: ShadowViewpoint = {
      ...VIEW,
      position: [VIEW.position[0] + (i * step) / 2, 5, 1.5 * i],
    };
    assert.equal(
      cycle(plan, store, frame++, () => entries, view),
      0,
      `step ${i}: nothing drawn`,
    );
  }
  assert.equal(plan.counts.invalidatedPages, 0);
  // The three pages still in the clipmap, and the four floor pages of the sun's first frame.
  assert.equal(plan.pool.used, 3 + 4, 'stay mapped');
  assert.ok(entries.every((entry) => current(plan.table.words[entry])));
});

test('a page restaled for detail stays readable until it is redrawn', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // One page a frame. The representation changed everywhere: the camera rests, the pages go stale,
  // but their depth is the same world at another precision.
  plan.observeCost(plan.budget.budgetMs, 1);
  plan.representationChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  let frame = 40;
  assert.equal(
    cycle(plan, store, frame, () => entries),
    1,
  );
  const stale = () =>
    entries.filter((entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK]);
  assert.equal(stale().length, 3, 'the floor drawn first, three pages wait to be redrawn');
  while (stale().length) {
    assert.ok(
      entries.every((entry) => current(plan.table.words[entry])),
      'stale for detail: still read, never hidden',
    );
    cycle(plan, store, ++frame, () => entries);
  }
  // Each redrawn, one a frame, with the three floor pages more the view reaches.
  assert.equal(frame, 40 + 3 + 3, 'each redrawn, one a frame');
});

test('the floor a withdrawn page falls back to is current', () => {
  const { store, plan, entries } = drawnSun(row(3));
  plan.observeCost(plan.budget.budgetMs, 1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  cycle(plan, store, 50, () => entries);
  assert.ok(current(plan.table.words[sunFloor(plan, store.sliceOf(0))]));
});

test('a page restaled for another cut threshold stays readable until it is redrawn', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // Drawn again at a first threshold, then one page a frame and the cut's threshold moves.
  plan.setThreshold(1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  for (let frame = 50; cycle(plan, store, frame, () => entries); frame++);
  plan.observeCost(plan.budget.budgetMs, 1);
  plan.setThreshold(8);
  assert.equal(
    cycle(plan, store, 60, () => entries),
    1,
  );
  const stale = entries.filter(
    (entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK],
  );
  assert.equal(stale.length, 3, 'the floor drawn first, three pages wait to be redrawn');
  assert.ok(
    entries.every((entry) => current(plan.table.words[entry])),
    'coarser casters, not wrong ones: still read',
  );
});

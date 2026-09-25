// What a frame reads of pages it draws again (#489: every one of them, in the frame): until the draw
// lands, a page whose depth is wrong is withdrawn — the one flag the shading reads —, a page whose
// static casters still hold stays read; and a camera that only moves redraws none of the pages
// whose casters and light stayed where they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import * as virtual from './virtual.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import { STALE_DYNAMIC } from './pool.ts';
import { SUN, VIEW, cycle, planFrame, report, sunFloor, sunPages } from './lightShadow.fixture.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';

/** A sun whose level `finest + 4` the shading reads at `pages`, drawn and settled. */
function drawnSun(pages: number[][]) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
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
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  // The three pages and the four floor pages the view reaches, all in the frame.
  assert.equal(planFrame(plan, store, 10), 3 + 4, 'every page read');
  const readable = () => entries.filter((entry) => current(plan.table.words[entry])).length;
  assert.equal(readable(), 0, 'none of the three is read before its draw lands');
  // One mechanism: the valid bit the shading tests is the one the scheduler clears.
  assert.equal('PAGE_STALE' in virtual, false, 'no second flag in the table word');
  assert.equal('hideStale' in plan.pool, false, 'no second way to hide a page');
  plan.commit();
  assert.equal(readable(), entries.length, 'each current once drawn');
});

test('a static shadow stays read while a caster near it moves', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // An object already moving crosses every page, frame after frame.
  for (let frame = 60; frame < 66; frame++) {
    plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], true);
    planFrame(plan, store, frame);
    const waiting = entries.filter(
      (entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK] === STALE_DYNAMIC,
    );
    assert.equal(waiting.length, entries.length, 'its moving casters stale every page');
    assert.ok(
      entries.every((entry) => current(plan.table.words[entry])),
      'their static layer holds: every page still read until drawn',
    );
    plan.commit();
    report(plan, store, frame, entries);
  }
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
  // The representation changed everywhere: the camera rests, the pages go stale, but their depth is
  // the same world at another precision.
  plan.representationChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  planFrame(plan, store, 40);
  const stale = () =>
    entries.filter((entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK]);
  assert.equal(stale().length, 3, 'three pages to redraw');
  assert.ok(
    entries.every((entry) => current(plan.table.words[entry])),
    'stale for detail: still read, never hidden',
  );
  plan.commit();
  assert.equal(stale().length, 0, 'each redrawn in the frame');
});

test('the floor a withdrawn page falls back to is current', () => {
  const { store, plan, entries } = drawnSun(row(3));
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  cycle(plan, store, 50, () => entries);
  assert.ok(current(plan.table.words[sunFloor(plan, store.sliceOf(0))]));
});

test('a page restaled for another cut threshold stays readable until it is redrawn', () => {
  const { store, plan, entries } = drawnSun(row(3));
  // Drawn again at a first threshold, then the cut's threshold moves.
  plan.setThreshold(1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  for (let frame = 50; cycle(plan, store, frame, () => entries); frame++);
  plan.setThreshold(8);
  planFrame(plan, store, 60);
  const stale = entries.filter(
    (entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK],
  );
  assert.equal(stale.length, 3, 'three pages to redraw');
  assert.ok(
    entries.every((entry) => current(plan.table.words[entry])),
    'coarser casters, not wrong ones: still read',
  );
});

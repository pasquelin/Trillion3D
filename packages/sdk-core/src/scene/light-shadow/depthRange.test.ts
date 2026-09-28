// #991: a sun's depth range that changes — a walker whose box crosses a line of its power-of-two
// grid — redraws only the pages the walker's box covers, each in the new range; every other page
// stays read in the range it was drawn in. A turn of the sun still redraws them all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { createSunDepthRanges } from './sunDepth.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_RANGE_MASK,
  PAGE_RANGE_SHIFT,
  PAGE_VALID,
  SUN_DEPTH_RANGES,
} from './virtual.ts';
import { SUN, VIEW, readPages, report, sunPages } from './lightShadow.fixture.ts';

/** The ground, ten metres deep under a sun straight overhead: the range `[−16, 0]` along it. */
const GROUND_MIN = [-50, 0, -50],
  GROUND_MAX = [50, 10, 50];
/** A walker half a metre wide at the origin, its head at `top` metres. */
const walker = (top: number) => ({ min: [-0.25, top - 1.8, -0.25], max: [0.25, top, 0.25] });
const GRID = Array.from({ length: 144 }, (_, i) => [(i % 12) - 6, Math.floor(i / 12) - 6]);

type Store = ReturnType<typeof createSceneLightStore>;

/** One frame over a scene from `bottom` to `top` metres up: plan, commit, then report `read`. */
function frameOver(
  plan: ShadowPlan,
  store: Store,
  frame: number,
  read: number[],
  top = 10,
  bottom = 0,
) {
  plan.plan(store, VIEW, [-50, bottom, -50], [50, top, 50], frame, frame * 16);
  plan.commit();
  report(plan, store, frame, read);
}

/** The sun over the ground, every page of a level of two-metre pages over the origin drawn. */
function settled() {
  const store = createSceneLightStore(),
    plan = createShadowPlan(32);
  store.add(SUN);
  plan.plan(store, VIEW, GROUND_MIN, GROUND_MAX, 0, 0);
  plan.commit();
  const slice = store.sliceOf(0),
    read = sunPages(plan, slice, plan.sun.finest[slice] + 7, GRID);
  let frame = 1;
  for (; frame < 4; frame++) frameOver(plan, store, frame, read);
  return { store, plan, slice, read, frame };
}

/** Table entries of the stale pages. */
function staleEntries(plan: ShadowPlan) {
  const { pool } = plan,
    entries: number[] = [];
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.dirty[page]) entries.push(pool.owner[page]);
  return entries.sort((a, b) => a - b);
}

const slotOf = (word: number) => (word >>> PAGE_RANGE_SHIFT) & PAGE_RANGE_MASK;

test('a walker crossing a line of the depth grid stales only the pages its box covers', () => {
  const staled = (top: number) => {
    const { store, plan, slice, frame } = settled();
    const before = plan.sun.ranges.current[slice],
      box = walker(top);
    plan.worldChanged(box.min, box.max);
    plan.plan(store, VIEW, GROUND_MIN, [50, Math.max(10, top), 50], frame, frame * 16);
    return {
      entries: staleEntries(plan),
      moved: plan.sun.ranges.current[slice] !== before,
      used: plan.pool.used(),
      invalidated: plan.counts.invalidatedPages,
    };
  };
  // Its head at 9 m keeps the range; at 17 m the range is `[−32, 0]`.
  const inside = staled(9),
    across = staled(17);
  assert.equal(inside.moved, false);
  assert.equal(across.moved, true, 'the range changed');
  assert.deepEqual(across.entries, inside.entries, 'no page more than its box covers');
  assert.equal(across.invalidated, inside.invalidated);
  assert.ok(across.invalidated < across.used / 2, `${across.invalidated} of ${across.used}`);
});

test('the pages the walker covers are drawn in the new range; every other page stays read', () => {
  const { store, plan, slice, frame, read } = settled();
  const box = walker(17);
  plan.worldChanged(box.min, box.max);
  plan.plan(store, VIEW, GROUND_MIN, [50, 17, 50], frame, frame * 16);
  const covered = new Set(staleEntries(plan)),
    now = plan.sun.ranges.current[slice];
  assert.ok(covered.size > 0);
  plan.commit();
  for (const entry of read) {
    const word = plan.table.words[entry];
    assert.ok(word & PAGE_VALID, `page ${entry} is read`);
    assert.equal(slotOf(word), covered.has(entry) ? now : 0, `page ${entry}'s range`);
  }
  // The shading decodes each page with the pair its slot holds: the old range and the new.
  const pairs = plan.sun.ranges.pairs,
    first = slice * SUN_DEPTH_RANGES * 2;
  assert.deepEqual([...pairs.subarray(first, first + 2)], [-16, 0]);
  assert.deepEqual([...pairs.subarray(first + now * 2, first + now * 2 + 2)], [-32, 0]);
  assert.deepEqual([...plan.sun.depth.subarray(slice * 2, slice * 2 + 2)], [-32, 0]);
});

test('a turn of the sun still withdraws every page', () => {
  const { store, plan, slice, frame } = settled();
  assert.ok(readPages(plan, slice).length > 0);
  store.set('sun', { direction: [Math.sin(0.1), -Math.cos(0.1), 0] });
  plan.plan(store, VIEW, GROUND_MIN, GROUND_MAX, frame, frame * 16);
  assert.deepEqual(readPages(plan, slice), [], 'none read until redrawn');
});

test('a range met again takes its slot back; a new one past every slot withdraws its pages', () => {
  const { store, plan, slice, frame, read } = settled();
  const held = readPages(plan, slice).length;
  let at = frame;
  // The ground raised by 16 m, then back: a second slot, then the first again.
  frameOver(plan, store, at++, read, 26, 16);
  assert.equal(plan.sun.ranges.current[slice], 1);
  frameOver(plan, store, at++, read);
  assert.equal(plan.sun.ranges.current[slice], 0, 'the ground again: its slot back');
  // Raised by 16 m a frame, `[−16(k + 1), −16k]`: a new range each frame until the slots are spent.
  for (let k = 1; k < SUN_DEPTH_RANGES; k++) {
    frameOver(plan, store, at++, read, 16 * k + 10, 16 * k);
    assert.equal(plan.counts.invalidatedPages, 0, `range ${k} stales nothing`);
    assert.equal(readPages(plan, slice).length, held);
  }
  const k = SUN_DEPTH_RANGES;
  plan.plan(store, VIEW, [-50, 16 * k, -50], [50, 16 * k + 10, 50], at, at * 16);
  assert.equal(plan.sun.ranges.recycled[slice], 0, 'the slot least recently current');
  assert.deepEqual(readPages(plan, slice), [], 'every page drawn in it is withdrawn');
});

test('a turn of the sun frees every slot, and a slot lies past the page index in a word', () => {
  const ranges = createSunDepthRanges();
  ranges.take(0, -16, 0, 1);
  ranges.forget(0);
  ranges.take(0, -32, 0, 2);
  assert.equal(ranges.recycled[0], -1, 'a new frame holds no page in an old range');
  assert.ok(PAGE_INDEX_MASK < 1 << PAGE_RANGE_SHIFT, 'the slot lies past the page index');
});

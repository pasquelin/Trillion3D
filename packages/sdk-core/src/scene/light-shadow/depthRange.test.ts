// #991: a sun's depth range that changes — a walker whose box crosses a line of its power-of-two
// grid — redraws only the pages the walker's box covers, each in the new range; every other page
// stays read in the range it was drawn in, until nothing moves: then it is drawn again in the new
// one, so a scene at rest shows the image one range draws. A turn of the sun still redraws them all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_BY } from './counts.ts';
import { createSunDepthRanges } from './sunDepth.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  PAGE_RANGE_MASK,
  PAGE_RANGE_SHIFT,
  PAGE_VALID,
  SUN_DEPTH_RANGES,
} from './virtual.ts';
import {
  SUN_GRID,
  VIEW,
  cycle,
  nudged,
  planFrame,
  readPages,
  staleEntries,
  sunPages,
  sunScene,
} from './lightShadow.fixture.ts';

/** A walker half a metre wide at the origin, its head at `top` metres. */
const walker = (top: number) => ({ min: [-0.25, top - 1.8, -0.25], max: [0.25, top, 0.25] });
/** The fixture ground, ten metres deep under a sun straight overhead — the range `[−16, 0]` along
 *  it —, raised to span `bottom..top` metres. */
const ground = (top: number, bottom = 0): [number[], number[]] => [
  [-50, bottom, -50],
  [50, top, 50],
];

/** The sun over the ground, every page of a level of two-metre pages over the origin drawn. */
function settled() {
  const { store, plan, slice } = sunScene(),
    read = sunPages(plan, slice, plan.sun.finest[slice] + 7, SUN_GRID);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, () => read);
  return { store, plan, slice, read, frame };
}

const slotOf = (word: number) => (word >>> PAGE_RANGE_SHIFT) & PAGE_RANGE_MASK;

test('a walker crossing a line of the depth grid stales only the pages its box covers', () => {
  const staled = (top: number) => {
    const { store, plan, slice, frame } = settled();
    const before = plan.sun.ranges.current[slice],
      box = walker(top);
    plan.worldChanged(box.min, box.max);
    planFrame(plan, store, frame, VIEW, ...ground(Math.max(10, top)));
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
  planFrame(plan, store, frame, VIEW, ...ground(17));
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

test('once nothing moves, the pages of an older range are drawn in the current one, read meanwhile', () => {
  const { store, plan, slice, frame, read } = settled();
  const box = walker(17);
  plan.worldChanged(box.min, box.max);
  cycle(plan, store, frame, () => read, VIEW, ...ground(17));
  const now = plan.sun.ranges.current[slice],
    older = () => readPages(plan, slice).filter((page) => plan.pool.range[page] !== now),
    kept = older();
  assert.ok(kept.length > 0, 'the motion leaves pages in the old range');
  // The next frame nothing moves: those pages turn stale, and stay read until redrawn.
  planFrame(plan, store, frame + 1, VIEW, ...ground(17));
  assert.equal(plan.counts.invalidatedPages, kept.length);
  assert.equal(plan.counts.staledBy[STALE_BY.range], kept.length, 'counted as a depth range');
  for (const entry of read)
    assert.ok(plan.table.words[entry] & PAGE_VALID, `page ${entry} is read`);
  plan.commit();
  assert.deepEqual(older(), [], 'every page drawn in the current range');
});

test('a turn of the sun still withdraws every page', () => {
  const { store, plan, slice, frame } = settled();
  assert.ok(readPages(plan, slice).length > 0);
  store.set('sun', { direction: [Math.sin(0.1), -Math.cos(0.1), 0] });
  planFrame(plan, store, frame);
  assert.deepEqual(readPages(plan, slice), [], 'none read until redrawn');
});

test('a range met again takes its slot back; a new one past every slot withdraws its pages', () => {
  const { store, plan, slice, frame, read } = settled();
  const held = readPages(plan, slice).length;
  let at = frame;
  // The ground raised by 16 m, then back: a second slot, then the first again. The camera moves
  // throughout: a scene at rest would redraw the pages of the other slots.
  cycle(plan, store, at++, () => read, nudged(1), ...ground(26, 16));
  assert.equal(plan.sun.ranges.current[slice], 1);
  cycle(plan, store, at++, () => read, nudged(2));
  assert.equal(plan.sun.ranges.current[slice], 0, 'the ground again: its slot back');
  // Raised by 16 m a frame, `[−16(k + 1), −16k]`: a new range each frame until the slots are spent.
  for (let k = 1; k < SUN_DEPTH_RANGES; k++) {
    cycle(plan, store, at++, () => read, nudged(k + 2), ...ground(16 * k + 10, 16 * k));
    assert.equal(plan.counts.invalidatedPages, 0, `range ${k} stales nothing`);
    assert.equal(readPages(plan, slice).length, held);
  }
  const k = SUN_DEPTH_RANGES;
  planFrame(plan, store, at, nudged(k + 2), ...ground(16 * k + 10, 16 * k));
  assert.equal(plan.sun.ranges.recycled[slice], 0, 'the slot least recently current');
  assert.deepEqual(readPages(plan, slice), [], 'every page drawn in it is withdrawn');
});

test('a turn of the sun frees every slot, and a slot lies past the page index in a word', () => {
  const ranges = createSunDepthRanges();
  ranges.take(0, -16, 0, 1);
  ranges.forget(0);
  ranges.take(0, -32, 0, 2);
  assert.equal(ranges.recycled[0], -1, 'a new frame holds no page in an old range');
  const slotBits = PAGE_RANGE_MASK * 2 ** PAGE_RANGE_SHIFT;
  assert.equal(slotBits & (PAGE_INDEX_MASK | PAGE_MAPPED | PAGE_VALID), 0, 'the slot lies past');
  assert.ok(slotBits < 2 ** 32 && PAGE_RANGE_MASK >= SUN_DEPTH_RANGES - 1, 'every slot fits');
});

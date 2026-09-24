// What a frame reads of pages that wait to be drawn again: a stale page is never read as current,
// the pages pending drain at the budget's rate whatever the light cut bounds, and a camera that
// only moves redraws none of the pages whose casters and light stayed where they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_STALE, PAGE_VALID } from './virtual.ts';
import { SUN, VIEW, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

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

/** What the shading's lookup takes a word for: current only when valid and not stale. */
const current = (word: number) => (word & (PAGE_VALID | PAGE_STALE)) === PAGE_VALID;

const row = (count: number) => Array.from({ length: count }, (_, x) => [x, 0]);

test('a stale page is never read as current: its entry says stale until its draw lands', () => {
  const { store, plan, entries } = drawnSun(row(3));
  assert.ok(
    entries.every((entry) => current(plan.table.words[entry])),
    'drawn: all current',
  );
  // One page a frame: the two the frame does not draw wait, stale, and the shading falls back.
  plan.observeCost(plan.budget.budgetMs, 1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  let frame = 10;
  assert.equal(planFrame(plan, store, frame), 1);
  plan.commit();
  const readable = () => entries.filter((entry) => current(plan.table.words[entry])).length;
  assert.equal(readable(), 1, 'only the page drawn this frame is current');
  for (const entry of entries)
    if (!current(plan.table.words[entry]))
      assert.ok(plan.table.words[entry] & PAGE_STALE, 'the others say stale, not their old depth');
  while (readable() < entries.length) cycle(plan, store, ++frame, () => entries);
  assert.equal(frame, 12, 'each stale page current once drawn, one a frame');
});

test('pages pending drain in N / limit frames at the fixed budget, whatever the cut dropped', () => {
  const { store, plan, entries } = drawnSun(row(12));
  // A page costs a quarter of the budget: four a frame. The cut dropped down to one view.
  plan.observeCost(plan.budget.budgetMs / 4, 1);
  plan.admission.setViewLimit(1);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  let frame = 20,
    drawn = 0;
  for (let i = 0; i < 12 / 4; i++) drawn += cycle(plan, store, frame++, () => entries);
  assert.equal(drawn, 12, 'twelve pages of one view drained in three frames');
  assert.equal(plan.counts.pendingPages, 0);
});

test('a pure camera translation redraws no page whose casters and light are static', () => {
  const { store, plan, entries, level } = drawnSun(row(3));
  const step = 128 * 2 ** level;
  let frame = 30;
  for (let i = 1; i <= 4; i++) {
    const view = { ...VIEW, position: [VIEW.position[0] + (i * step) / 2, 5, 1.5 * i] };
    assert.equal(
      cycle(plan, store, frame++, () => entries, view),
      0,
      `step ${i}: nothing drawn`,
    );
  }
  assert.equal(plan.counts.invalidatedPages, 0);
  assert.equal(plan.pool.used, 3, 'the pages still in the clipmap stay mapped');
  assert.ok(entries.every((entry) => current(plan.table.words[entry])));
});

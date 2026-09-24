// A shadow-casting light that moves every frame: its shadow follows it the same frame, coarse first
// and within the fixed budget, no page drawn at a past pose is ever read as current, and a light
// that stays still keeps its image untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_STALE, PAGE_VALID } from './virtual.ts';
import { SUN, cycle, lampPages, planFrame, report, sunPages } from './lightShadow.fixture.ts';

const LAMP = { ...SUN, id: 'lamp', kind: 'point' as const, position: [0, 3, 0], range: 20 };

/** What the shading's lookup takes a word for: current only when valid and not stale. */
const current = (word: number) => (word & (PAGE_VALID | PAGE_STALE)) === PAGE_VALID;

/** A lamp whose face 0 the receivers read at its three coarsest mips, drawn and settled. */
function drawnLamp(withSun = false) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(LAMP);
  if (withSun) store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const coarsest = lampPages(plan, slice, 0, 5),
    coarse = lampPages(plan, slice, 0, 4),
    read = [...coarsest, ...coarse, ...lampPages(plan, slice, 0, 3)];
  const sun = withSun
    ? sunPages(plan, store.sliceOf(1), plan.sun.finest[store.sliceOf(1)] + 4, [[0, 0]])
    : [];
  let frame = 1;
  while (cycle(plan, store, frame, () => [...read, ...sun]) || frame < 3) frame++;
  return { store, plan, coarsest, coarse, read, sun, frame };
}

/** Plans and commits one frame; returns the physical pages it drew. */
function drawFrame(
  plan: ReturnType<typeof createShadowPlan>,
  store: ReturnType<typeof createSceneLightStore>,
  frame: number,
) {
  const count = planFrame(plan, store, frame),
    drawn = new Set(plan.admission.list.subarray(0, count));
  plan.commit();
  return drawn;
}

const moveLamp = (store: ReturnType<typeof createSceneLightStore>, frame: number) =>
  store.set('lamp', { position: [Math.cos(frame) * 4, 3, Math.sin(frame) * 4] });

test('a light moved every frame never has a page of a past pose read as current', () => {
  const { store, plan, read, frame: start } = drawnLamp();
  // Four pages a frame: far fewer than the receivers read.
  plan.observeCost(plan.budget.budgetMs / 4, 1);
  for (let frame = start + 1; frame < start + 30; frame++) {
    moveLamp(store, frame);
    const drawn = drawFrame(plan, store, frame);
    for (const entry of read) {
      const word = plan.table.words[entry];
      if (current(word))
        assert.ok(
          drawn.has(word & PAGE_INDEX_MASK),
          `frame ${frame}: read only if drawn at this pose`,
        );
    }
    report(plan, store, frame, read);
  }
});

test('the pages the receivers read of a moving light are drawn in the frame, coarse first', () => {
  const { store, plan, coarsest, coarse, read, sun, frame: start } = drawnLamp(true);
  // The sun's page goes stale for detail first: it has waited longest, and stays read meanwhile.
  plan.representationChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  // Eight pages a frame: the two coarsest mips, and three of the sixteen finer ones.
  plan.observeCost(plan.budget.budgetMs / 8, 1);
  let frame = start + 1;
  for (; frame < start + 12; frame++) {
    moveLamp(store, frame);
    drawFrame(plan, store, frame);
    for (const entry of [...coarsest, ...coarse])
      assert.ok(current(plan.table.words[entry]), `frame ${frame}: the coarse shadow follows`);
    assert.ok(current(plan.table.words[sun[0]]), 'the sun, stale for detail only, is still read');
    assert.ok(plan.pool.dirty[plan.table.words[sun[0]] & PAGE_INDEX_MASK], 'and waits behind');
    report(plan, store, frame, [...read, ...sun]);
  }
  // Still again: the finer pages and the sun's come.
  for (let settled = 0; settled < 3; frame++)
    settled = cycle(plan, store, frame, () => [...read, ...sun]) ? 0 : settled + 1;
  for (const entry of [...read, ...sun]) assert.ok(current(plan.table.words[entry]));
});

test('a page of a moving light no receiver reads is not drawn', () => {
  const { store, plan, read, frame: start } = drawnLamp();
  const offScreen = read.slice(1);
  plan.observeCost(plan.budget.budgetMs / 4, 1);
  // The receivers now read one page of it.
  report(plan, store, start + 1, read.slice(0, 1));
  for (let frame = start + 2; frame < start + 7; frame++) {
    moveLamp(store, frame);
    const drawn = drawFrame(plan, store, frame);
    for (const entry of offScreen) {
      assert.ok(!drawn.has(plan.table.words[entry] & PAGE_INDEX_MASK), 'nobody reads it');
      assert.ok(!current(plan.table.words[entry]), 'and it is never read at a past pose');
    }
    report(plan, store, frame, read.slice(0, 1));
  }
});

test('a still image of a still light is unchanged', () => {
  const { store, plan, read, frame: start } = drawnLamp();
  const words = plan.table.words.slice(),
    version = plan.table.version;
  for (let frame = start + 1; frame < start + 6; frame++)
    assert.equal(
      cycle(plan, store, frame, () => read),
      0,
      'nothing drawn',
    );
  assert.deepEqual(plan.table.words, words, 'every word as it was');
  assert.equal(plan.table.version, version);
  assert.equal(plan.counts.pendingPages, 0);
});

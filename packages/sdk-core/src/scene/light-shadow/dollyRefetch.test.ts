// #525: a camera over a small scene, with a far distance much wider than the scene, rocks back and
// forth over the pages it reads. What a frame reads fits the pool many times over, so no page may be
// evicted and asked for again. The sun's floor pages were every last-level page within the view's
// far distance, receivers or not: over empty ground they pinned most of the pool, and the pages the
// camera came back to had been evicted meanwhile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, VIEW, report, sunPages } from './lightShadow.fixture.ts';
import { sunFloorLevel, sunPageMetres } from './virtual.ts';

/** A scene twenty metres wide, under a view that sees two hundred metres around. */
const BOX_MIN = [-10, 0, -10],
  BOX_MAX = [10, 5, 10];
const near = 0.001;
const viewAt = (x: number) => ({
  ...VIEW,
  position: [x, 5, 0] as [number, number, number],
  near,
  far: 120,
  pixelNear: (near * 2 * Math.tan(VIEW.halfFovY)) / 720,
});

test('a dolly over a small scene whose reads fit the pool evicts nothing it reads again', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  let floors = 0;
  for (let frame = 0; frame < 60; frame++) {
    // The camera rocks over two metres, and reads a block of fine pages under it.
    const x = Math.abs((frame % 20) - 10) * 0.2,
      view = viewAt(x);
    plan.plan(store, view, BOX_MIN, BOX_MAX, frame, frame * 16);
    plan.commit();
    const slice = store.sliceOf(0),
      level = plan.sun.finest[slice] + 9,
      // The sun stands overhead: a page's light-plane column is `-x` over its metres.
      first = Math.floor(-x / sunPageMetres(level)) - 6,
      block: number[][] = [];
    for (let ay = -6; ay < 6; ay++)
      for (let ax = first; ax < first + 12; ax++) block.push([ax, ay]);
    report(plan, store, frame, sunPages(plan, slice, level, block));
    const floor = sunFloorLevel(plan.sun.finest[slice]);
    floors = 0;
    for (let page = 0; page < plan.pool.pages; page++)
      if (plan.pool.owner[page] >= 0 && plan.pool.view[page] === floor) floors++;
  }
  // The box's twenty metres in the floor's four-metre pages, one page around: 8 × 8, where the
  // view's reach held 880.
  assert.ok(floors <= 64, `the floor holds the scene's pages, not the view's reach: ${floors}`);
  assert.equal(plan.pool.refetched, 0, 'no page evicted and asked for again');
});

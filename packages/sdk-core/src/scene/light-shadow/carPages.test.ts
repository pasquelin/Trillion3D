// #811: the car, the motorcycle and the tank of drive-a-car, each body and wheel its own box, under
// a sun and the chase camera at 960 × 600, stale exactly the pages their boxes overlap, as when
// each moves alone: a light that examines many entries never trades that for a union of movers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';
import { createShadowPlan } from './plan.ts';
import { shadowPoolSide } from './virtual.ts';
import { SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

/** The example's chase camera, 7.5 m behind the car and 2.4 m up, at 960 × 600. */
const FOLLOW: ShadowViewpoint = {
  position: [0, 2.4, 7.5],
  forward: [0, -0.2, -1],
  halfFovY: 0.6,
  aspect: 1.6,
  near: 0.1,
  far: 400,
  pixelNear: (0.1 * 2 * Math.tan(0.6)) / 600,
};
/** A vehicle's roots — its body with every part under it, then each wheel on its own —, each box
 *  the union of where it was and where it is, a step of 20 cm on. */
const vehicle = (x: number, size: number[], wheels: number[][], radius: number) =>
  [
    [x - size[0] / 2, 0, -size[2] / 2, x + size[0] / 2, size[1], size[2] / 2],
    ...wheels.map(([wx, wz]) => [
      x + wx - 0.15,
      0,
      wz - radius,
      x + wx + 0.15,
      2 * radius,
      wz + radius,
    ]),
  ].map(([x0, y0, z0, x1, y1, z1]) => ({ min: [x0, y0, z0 - 0.2], max: [x1, y1, z1] }));
/** The car, the motorcycle and the tank of the example, settling side by side: the bodies are
 *  written first, then the wheels. */
const [car, bike, tank] = [
  vehicle(
    0,
    [1.9, 1.3, 4.6],
    [-1.35, 1.35].flatMap((z) => [-0.8, 0.8].map((x) => [x, z])),
    0.33,
  ),
  vehicle(
    -6,
    [0.5, 1.2, 2],
    [
      [0, -0.72],
      [0, 0.72],
    ],
    0.31,
  ),
  vehicle(
    9,
    [3.7, 2.9, 8],
    [-1.55, 1.55].flatMap((x) => [-3, -1.8, -0.6, 0.6, 1.8, 3].map((z) => [x, z])),
    0.42,
  ),
];
const ROOTS = [
  ...[tank, car, bike].map((roots) => roots[0]),
  ...[tank, bike, car].flatMap((roots) => roots.slice(1)),
];

/** The sun over the car, every page the follow view reads around it drawn. */
function settled() {
  const store = createSceneLightStore(),
    plan = createShadowPlan(shadowPoolSide(960, 600));
  const toward = [-40, -70, -25].map((a) => a / Math.hypot(40, 70, 25));
  store.add({ ...SUN, direction: toward as [number, number, number] });
  const view = (frame: number) => cycle(plan, store, frame, () => read, FOLLOW);
  let read: number[] = [];
  view(0);
  // Pages read around the car: finer near it, coarser farther — as a chase view reads them.
  const slice = store.sliceOf(0),
    around = (side: number) =>
      Array.from({ length: side * side }, (_, i) => [
        (i % side) - side / 2,
        Math.floor(i / side) - side / 2,
      ]);
  read = [
    [5, 24],
    [6, 16],
    [7, 16],
    [8, 8],
  ].flatMap(([step, side]) => sunPages(plan, slice, plan.sun.finest[slice] + step, around(side)));
  let frame = 1;
  for (; frame < 4; frame++) view(frame);
  return { store, plan, frame };
}

/** Table entries of the stale pages. */
function stale({ pool }: ReturnType<typeof settled>['plan']) {
  const entries = new Set<number>();
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.dirty[page]) entries.add(pool.owner[page]);
  return entries;
}

test('a car stales exactly the pages its roots overlap, as when each root moves alone', () => {
  const own = new Set<number>();
  for (const root of ROOTS) {
    const { store, plan, frame } = settled();
    assert.equal(stale(plan).size, 0, 'every page read is drawn');
    plan.worldChanged(root.min, root.max, true);
    planFrame(plan, store, frame, FOLLOW);
    for (const entry of stale(plan)) own.add(entry);
  }
  const { store, plan, frame } = settled();
  for (const root of ROOTS) plan.worldChanged(root.min, root.max, true);
  planFrame(plan, store, frame, FOLLOW);
  assert.ok(own.size > 0);
  assert.deepEqual(stale(plan), own, 'the union of each root alone, and nothing more');
  assert.equal(plan.counts.invalidatedPages, own.size);
});

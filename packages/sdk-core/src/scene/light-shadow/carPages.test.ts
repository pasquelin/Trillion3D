// #811: drive-a-car's car, motorcycle and tank, each body and wheel its own box, under a sun and
// the chase camera at 960 × 600, stale exactly the pages their boxes overlap, as each alone would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE, chaseSun } from './chaseSun.fixture.ts';
import { planFrame } from './lightShadow.fixture.ts';

const grid = (xs: number[], zs: number[]) => xs.flatMap((x) => zs.map((z) => [x, z]));
/** A vehicle's body box, then a box per wheel, each over where it was and is, 20 cm apart. */
const vehicle = (x: number, [w, h, d]: number[], wheels: number[][], r: number) =>
  [[x - w / 2, 0, -d / 2, x + w / 2, h, d / 2]]
    .concat(wheels.map(([u, z]) => [x + u - 0.15, 0, z - r, x + u + 0.15, 2 * r, z + r]))
    .map(([x0, y0, z0, x1, y1, z1]) => ({ min: [x0, y0, z0 - 0.2], max: [x1, y1, z1] }));
const car = vehicle(0, [1.9, 1.3, 4.6], grid([-0.8, 0.8], [-1.35, 1.35]), 0.33),
  bike = vehicle(-6, [0.5, 1.2, 2], grid([0], [-0.72, 0.72]), 0.31),
  tank = vehicle(9, [3.7, 2.9, 8], grid([-1.55, 1.55], [-3, -1.8, -0.6, 0.6, 1.8, 3]), 0.42);
/** Settling side by side: the bodies are written first, then the wheels. */
const ROOTS = [tank[0], car[0], bike[0], ...tank.slice(1), ...bike.slice(1), ...car.slice(1)];

/** Table entries of the stale pages. */
const stale = ({ pool }: ReturnType<typeof chaseSun>['plan']) =>
  new Set([...pool.owner].filter((owner, page) => owner >= 0 && pool.dirty[page]));

test('a car stales exactly the pages its roots overlap, as when each root moves alone', () => {
  const own = new Set<number>();
  for (const root of ROOTS) {
    const { store, plan } = chaseSun();
    assert.equal(stale(plan).size, 0, 'every page read is drawn');
    plan.worldChanged(root.min, root.max, true);
    planFrame(plan, store, 4, CHASE);
    for (const entry of stale(plan)) own.add(entry);
  }
  const { store, plan } = chaseSun();
  for (const root of ROOTS) plan.worldChanged(root.min, root.max, true);
  planFrame(plan, store, 4, CHASE);
  assert.ok(own.size > 0);
  assert.deepEqual(stale(plan), own, 'the union of each root alone, and nothing more');
  assert.equal(plan.counts.invalidatedPages, own.size);
});

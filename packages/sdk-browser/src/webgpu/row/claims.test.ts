import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowClaims, serveClaims } from './claims.ts';
import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts';
import { createFrameBudget } from '../../page/integration/frameBudget.ts';

/** A row write slower than the per-image budget: the clock always runs out after one row. */
const slowPlace = () => {
  const until = performance.now() + 3;
  while (performance.now() < until);
  return true;
};

const owed = () => {
  const claims = createWebgpuRowClaims(4);
  for (const page of [3, 1, 2, 0]) claims.add(page);
  return claims;
};

test('an image writes owed rows within its time budget and leaves the rest owed', () => {
  const claims = owed(),
    budget = createFrameBudget(2);
  budget.open();
  assert.equal(
    serveClaims(claims, () => true, slowPlace, budget),
    0,
  );
  assert.equal(claims.count, 3, 'one row goes through, three wait for the next image');
  assert.deepEqual(Array.from(claims.pages.subarray(0, claims.count)), [1, 2, 3]);
});

test('a barrier image lifts the time budget and writes every owed row', () => {
  const claims = owed(),
    placed: number[] = [];
  const denied = serveClaims(
    claims,
    () => true,
    (page) => (placed.push(page), slowPlace()),
  );
  assert.equal(denied, 0);
  assert.equal(claims.count, 0);
  assert.deepEqual(placed, [0, 1, 2, 3]);
});

test('the rows a frame writes spend what its arrivals left of its one budget, on one clock', () => {
  let now = 0;
  const budget = createFrameBudget(2, () => now);
  const arrivals = createArrivalQueue(1 << 20, 64, budget);
  const receiver = { acceptPage: () => void (now += 1) };
  for (const url of ['p0', 'p1']) arrivals.queue(receiver, url, new Uint32Array(1));
  const claims = owed();
  budget.open();
  assert.equal(arrivals.drain(), 2, 'two 1 ms arrivals spend the 2 ms frame');
  serveClaims(
    claims,
    () => true,
    () => true,
    budget,
  );
  assert.equal(claims.count, 3, 'one row goes through, three wait for the next frame');
  budget.open();
  arrivals.drain();
  serveClaims(
    claims,
    () => true,
    () => true,
    budget,
  );
  assert.equal(claims.count, 0, 'a frame with nothing to drain writes every row within it');
});

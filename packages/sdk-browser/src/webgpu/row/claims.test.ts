import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowClaims, serveClaims } from './claims.ts';
import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts';
import { createFrameBudget } from '../../page/integration/frameBudget.ts';

/** The clock the budgets read, which a row write moves: no test waits on the machine's time. */
let now = 0;
/** A row write slower than the per-image budget: the clock always runs out after one row. */
const slowPlace = () => ((now += 3), true);

const owed = () => {
  const claims = createWebgpuRowClaims(4);
  for (const page of [3, 1, 2, 0]) claims.add(page);
  return claims;
};

test('an image writes owed rows within its time budget and leaves the rest owed', () => {
  const claims = owed(),
    budget = createFrameBudget(2, () => now);
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

test('the rows a frame writes spend what its arrivals left of its one integration budget', () => {
  const budget = createFrameBudget(2, () => now);
  const arrivals = createArrivalQueue(1 << 20, 64, budget);
  const receiver = { acceptPage: () => void (now += 1) };
  for (const url of ['p0', 'p1']) arrivals.queue(receiver, url, new Uint32Array(1));
  const claims = owed();
  /** A frame as the session draws it: the drain, then 5 ms of the engine's other work. */
  const frame = () => {
    budget.open();
    arrivals.drain();
    budget.pause();
    now += 5;
    serveClaims(
      claims,
      () => true,
      () => (now += 0.5) > 0,
      budget,
    );
    return claims.count;
  };
  assert.equal(frame(), 3, 'two 1 ms arrivals spend the 2 ms: one row goes through, three wait');
  // Nothing to drain: the engine's 5 ms are not integration, the rows have the 2 ms to themselves.
  assert.equal(frame(), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowClaims, serveClaims } from './claims.ts';

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
  const claims = owed();
  assert.equal(
    serveClaims(claims, () => true, slowPlace),
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
    false,
  );
  assert.equal(denied, 0);
  assert.equal(claims.count, 0);
  assert.deepEqual(placed, [0, 1, 2, 3]);
});

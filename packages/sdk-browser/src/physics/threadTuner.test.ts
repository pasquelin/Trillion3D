import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadTuner } from './threadTuner.ts';

/** The counts a tuner of `threads` settles on over `seconds` of 60 steps, each step costing
 *  `cost(count)` milliseconds: the count of every step. */
function run(threads: number, cost: (count: number) => number, seconds: number) {
  const tuner = createThreadTuner(threads);
  const counts: number[] = [];
  let count = threads;
  for (let s = 0; s < seconds * 60; s++) {
    counts.push(count);
    count = tuner.step(cost(count));
  }
  return counts;
}

/** The share of `counts` equal to `count`. */
const share = (counts: number[], count: number) =>
  counts.filter((c) => c === count).length / counts.length;

test('threads that only contend are left idle: the count goes down to the fastest', () => {
  // Work that splits over two threads, then pays for every thread more.
  const counts = run(8, (n) => 12 / Math.min(n, 2) + n, 120);
  assert.equal(counts[0], 8, 'the budget first');
  assert.ok(share(counts.slice(20 * 60), 2) > 0.9, 'then two, but for its probes');
  assert.ok(counts.every((c) => c >= 1 && c <= 8));
});

test('threads that help are kept, and a probe that is slower goes back and holds', () => {
  const counts = run(4, (n) => 40 / n, 120);
  assert.ok(share(counts, 4) > 0.95, `four nearly throughout: ${share(counts, 4)}`);
  // Each probe is one measure at three, then half a minute at four.
  const probes = counts.filter((c, i) => c === 3 && counts[i - 1] === 4).length;
  assert.ok(probes >= 3 && probes <= 5, `${probes} probes in two minutes`);
});

test('one thread fewer is kept at the same cost; one more only when faster', () => {
  const counts = run(3, () => 5, 60);
  assert.equal(counts.at(-1), 1, 'no gain from more threads: one');
  assert.ok(share(counts.slice(10 * 60), 1) > 0.9);
});

test('a pool of one thread never moves', () => {
  assert.ok(run(1, () => 1, 10).every((c) => c === 1));
});

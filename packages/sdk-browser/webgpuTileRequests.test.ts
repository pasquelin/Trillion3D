// What a pass serves: fresh feedback in weight order, or what the previous pass deferred; fresh
// feedback replaces the backlog, since it names what the image looks at now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileRequests } from './webgpuTileRequests.ts';
import { createTileCounters } from './webgpuTileCounters.ts';

/** An atlas of `entries` streamed tiles, none resident, keyed by the feedback index it is given —
 *  a real page table subtracts its own offset first. */
const atlas = (entries: number) =>
  ({
    pages: { entries, tileOf: (index: number) => ({ slot: 1, level: 0, tx: index, ty: 0 }) },
    servedLevel: () => 2,
    touch: () => false,
  }) as never;

function requests(feedback: Array<Uint32Array | undefined>) {
  const counters = createTileCounters();
  return {
    counters,
    queue: createTileRequests({
      feedback: { take: () => feedback.shift() } as never,
      color: atlas(3),
      data: atlas(2),
      counters,
    }),
  };
}

test('fresh feedback is served heaviest first, across both atlases, and counted', () => {
  const { queue, counters } = requests([new Uint32Array([1, 0, 3, 2, 0])]);
  const wanted = queue.take(1);
  assert.deepEqual(
    wanted.map((r) => [r.weight, r.key.tx]),
    [
      [3, 2],
      [2, 3],
      [1, 0],
    ],
  );
  assert.equal(counters.requested, 3);
  assert.equal(counters.missingAverage, 2, 'each named tile is two levels coarser than asked');
});

test('a deferred remainder is offered again until fresh feedback replaces it', () => {
  const { queue } = requests([
    new Uint32Array([1, 2, 3, 0, 0]),
    undefined,
    new Uint32Array([0, 0, 0, 0, 9]),
  ]);
  const first = queue.take(1);
  queue.defer(first, 1);
  assert.equal(queue.deferred, 2);
  const second = queue.take(2);
  assert.deepEqual(
    second.map((r) => r.weight),
    [2, 1],
    'no feedback: the backlog, still in weight order',
  );
  queue.defer(second, 2);
  assert.equal(queue.deferred, 0);
  queue.defer(first, 0);
  assert.equal(queue.deferred, 3);
  const third = queue.take(3);
  assert.deepEqual(
    third.map((r) => r.weight),
    [9],
    'fresh feedback wins over the backlog',
  );
});

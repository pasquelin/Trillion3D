import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DrawRanges,
  IndexRangeAllocator,
} from '../../../../bench/witnesses/exact/batches/batches.ts';

const total = (allocator: IndexRangeAllocator) =>
  allocator.freeRanges.reduce((sum, range) => sum + range.length, 0);

test('the range allocator hands out disjoint ranges, reuses a freed range and merges neighbours', () => {
  const allocator = new IndexRangeAllocator(30);
  const a = allocator.allocate(10),
    b = allocator.allocate(5),
    c = allocator.allocate(15);
  assert.deepEqual([a, b, c], [0, 10, 15]);
  assert.equal(allocator.used, 30);
  assert.equal(allocator.allocate(1), -1, 'no room left');

  allocator.release(b, 5);
  assert.equal(allocator.used, 25);
  assert.equal(allocator.allocate(5), 10, 'the freed range is taken back as-is');

  allocator.release(0, 10);
  allocator.release(10, 5);
  assert.equal(allocator.freeRanges.length, 1, 'neighbours merge');
  assert.deepEqual({ ...allocator.freeRanges[0] }, { offset: 0, length: 15 });
  assert.equal(allocator.allocate(15), 0, 'the merged room serves a single request');
});

test('a fragmented allocator refuses a range larger than every hole, and accepts it after growth', () => {
  const allocator = new IndexRangeAllocator(10);
  const a = allocator.allocate(5),
    b = allocator.allocate(3),
    c = allocator.allocate(2);
  allocator.release(b, 3);
  allocator.release(c, 2);
  assert.equal(allocator.used, 5);
  assert.equal(allocator.allocate(6), -1, '5 free but in two non-contiguous holes');
  assert.equal(allocator.freeRanges.length, 1, 'b and c were adjacent: a single hole of 5');
  assert.equal(allocator.allocate(5), 5);
  allocator.release(a, 5);
  assert.equal(allocator.allocate(6), -1);
  allocator.grow(4);
  assert.equal(allocator.capacity, 14);
  assert.equal(
    allocator.allocate(6),
    -1,
    'growth is appended at the end, it does not fill the head hole',
  );
  assert.equal(allocator.allocate(4), 0, 'first free room: the head hole');
  assert.equal(allocator.allocate(4), 10, 'then the room added by growth');
  assert.equal(total(allocator) + allocator.used, allocator.capacity);
});

test('a randomised allocate/release sequence never overlaps and never loses space', () => {
  const allocator = new IndexRangeAllocator(256);
  const live: Array<{ offset: number; length: number }> = [];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
  for (let step = 0; step < 3000; step++) {
    if (live.length && random() < 0.5) {
      const taken = live.splice(Math.floor(random() * live.length), 1)[0];
      allocator.release(taken.offset, taken.length);
    } else {
      const length = 1 + Math.floor(random() * 16);
      const offset = allocator.allocate(length);
      if (offset < 0) continue;
      for (const other of live)
        assert.ok(
          offset + length <= other.offset || other.offset + other.length <= offset,
          'disjoint ranges',
        );
      live.push({ offset, length });
    }
    assert.equal(total(allocator) + allocator.used, allocator.capacity);
  }
});

test('a draw range list merges adjacent ranges, keeps the given order and grows without losing entries', () => {
  const ranges = new DrawRanges();
  assert.equal(ranges.push(0, 4), true);
  assert.equal(ranges.push(4, 6), false, 'adjacent range: merged');
  assert.equal(ranges.count, 1);
  assert.equal(ranges.counts[0], 10);
  assert.equal(ranges.push(20, 2), true, 'disjoint range: new sub-draw');
  assert.deepEqual([...ranges.starts.subarray(0, 2)], [0, 80]);
  assert.deepEqual([...ranges.counts.subarray(0, 2)], [10, 2]);
  for (let i = 0; i < 20; i++) ranges.push(100 + i * 10, 1);
  assert.equal(ranges.count, 22);
  assert.equal(ranges.starts[21], (100 + 19 * 10) * 4);
  ranges.reset();
  assert.equal(ranges.count, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { blendChunkWords, blendVertexShift, RUN_WORDS } from './runs.ts';
import { expandBlendPlan, itemKept } from './expandCpu.ts';
import { DRAW_UNPAGED, planEntry } from './plan.ts';

/** A plan entry: item rank, share bit, pipeline. */
const entree = (item: number, shared: boolean, pipeline = 1) => planEntry(item, pipeline, shared);

/** Minimal expansion setup: three paged items on one side, one isolated primitive. */
function decor() {
  const draws = new Uint32Array(4 * 4);
  for (let item = 0; item < 3; item++) {
    draws[item * 4] = item;
    draws[item * 4 + 1] = 4;
    draws[item * 4 + 2] = item * 4;
  }
  // The fourth carries its own indices: eighteen words, six per instance, hence three chunks.
  draws[12] = DRAW_UNPAGED;
  draws[13] = 3;
  draws[15] = 6;
  const instances = Uint32Array.from({ length: 12 }, (_, k) => 100 + k);
  return {
    draws,
    instances,
    itemCounts: Uint32Array.from([2, 3, 1]),
    keep: Uint32Array.from([0b1111]),
    expanded: new Uint32Array(64),
    args: new Uint32Array(16),
    maxVertexWords: 48,
    vertexShift: 6,
    instanceBase: 0,
    argsBase: 0,
  };
}

test('a shared run expands the instances of its entries, in plan order', () => {
  const base = decor();
  const order = Uint32Array.from([entree(2, true), entree(0, true), entree(1, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 3]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 6, 'one + two + three clusters');
  // The item that carries each instance, then the table entry compaction kept for it.
  assert.deepEqual(
    Array.from(base.expanded.subarray(0, 12)),
    [2, 108, 0, 100, 0, 101, 1, 104, 1, 105, 1, 106],
  );
  // One indirect argument: a cluster's vertices, the six instances, and the start vertex that
  // carries the rank of the first instance in its high bits.
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [48, 6, 0, 0]);
});

test('an item the frustum rejects expands no instance, and does not shift the others', () => {
  const base = decor();
  base.keep[0] = 0b1101;
  const order = Uint32Array.from([entree(0, true), entree(1, true), entree(2, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 3]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 3, 'the two clusters of rank 0 and the cluster of rank 2');
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [0, 100, 0, 101, 2, 108]);
  assert.equal(base.args[1], 3);
});

test('an unpaged primitive expands into chunks of one index stride', () => {
  const base = decor();
  const order = Uint32Array.from([entree(3, false)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 1]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 3, 'eighteen index words, six per instance');
  // Each instance says where its chunk starts; the shader takes its length from that.
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [3, 0, 3, 6, 3, 12]);
  // A run of a single unpaged item draws ITS vertices, not those of a cluster.
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [6, 3, 0, 0]);
});

test('the two passes expand into two disjoint regions, each at its base', () => {
  const base = decor();
  const order = Uint32Array.from([entree(0, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 1]);
  expandBlendPlan({ ...base, order, runs, runCount: 1, instanceBase: 5, argsBase: 8 });
  assert.deepEqual(Array.from(base.expanded.subarray(10, 14)), [0, 100, 0, 101]);
  // The start vertex carries the absolute rank of the first instance: five, shifted by the stride.
  assert.deepEqual(Array.from(base.args.subarray(8, 12)), [48, 2, 5 << 6, 0]);
});

test('the addressing stride holds the longest instance, and the chunk stays a multiple of three', () => {
  for (const mots of [3, 48, 384, 385, 4096]) {
    const shift = blendVertexShift(mots);
    assert.ok(1 << shift >= mots, `${mots} words fit in the stride`);
    const chunk = blendChunkWords(shift, 10000);
    assert.equal(chunk % 3, 0, 'a chunk never splits a triangle');
    assert.ok(chunk <= 1 << shift, 'a chunk fits in the stride');
  }
  // A primitive shorter than the stride is not split: one chunk, its exact vertices.
  assert.equal(blendChunkWords(9, 384), 384);
});

test('the frustum verdict is read bit by bit, at the item rank', () => {
  const keep = Uint32Array.from([0b1010, 0b0001]);
  assert.deepEqual(
    [0, 1, 2, 3, 32, 33].map((item) => itemKept(keep, item)),
    [false, true, false, true, true, false],
  );
});

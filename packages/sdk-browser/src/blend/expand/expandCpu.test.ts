import test from 'node:test'
import assert from 'node:assert/strict'
import { instanceItem } from '../../../../../bench/oracles/browser/instanceItem.ts'
import { blendVertexShift, RUN_WORDS } from '../plan/planLayout.ts'
import { expandBlendPlan } from './expandCpu.fixture.ts'
import { itemFilterWord } from './expansionViews.ts'
import { planEntry } from '../plan/planEntry.ts'
import { hasBit } from '../../../../math/src/scalar/bits.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** A plan entry: item rank, pipeline. */
const entryOf = (item: number, pipeline = 1) => planEntry(item, pipeline)

/** Minimal expansion setup: three items the table lists, one it does not list yet. */
function scene() {
  const draws = new Uint32Array(4 * 4)
  for (let item = 0; item < 3; item++) {
    draws[item * 4] = item
    draws[item * 4 + 1] = 4
    draws[item * 4 + 2] = item * 4
  }
  // The fourth has no cluster in the table yet.
  draws[12] = NO_INDEX
  const instances = Uint32Array.from({ length: 12 }, (_, k) => 100 + k)
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
  }
}

test('a run expands the instances of its entries, in plan order', () => {
  const base = scene()
  const order = Uint32Array.from([entryOf(2), entryOf(0), entryOf(1)])
  const runs = new Uint32Array(RUN_WORDS)
  runs.set([0, 3])
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 })
  assert.equal(total, 6, 'one + two + three clusters')
  // The item that carries each instance, then the table entry compaction kept for it.
  assert.deepEqual(
    Array.from(base.expanded.subarray(0, 12)),
    [2, 108, 0, 100, 0, 101, 1, 104, 1, 105, 1, 106],
  )
  // One indirect argument: a cluster's vertices, the six instances, and the start vertex that
  // carries the rank of the first instance in its high bits.
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [48, 6, 0, 0])
})

test('an item the frustum rejects expands no instance, and does not shift the others', () => {
  const base = scene()
  base.keep[0] = 0b1101
  const order = Uint32Array.from([entryOf(0), entryOf(1), entryOf(2)])
  const runs = new Uint32Array(RUN_WORDS)
  runs.set([0, 3])
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 })
  assert.equal(total, 3, 'the two clusters of rank 0 and the cluster of rank 2')
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [0, 100, 0, 101, 2, 108])
  assert.equal(base.args[1], 3)
})

test('the two passes expand into two disjoint regions, each at its base', () => {
  const base = scene()
  const order = Uint32Array.from([entryOf(0)])
  const runs = new Uint32Array(RUN_WORDS)
  runs.set([0, 1])
  expandBlendPlan({ ...base, order, runs, runCount: 1, instanceBase: 5, argsBase: 8 })
  assert.deepEqual(Array.from(base.expanded.subarray(10, 14)), [0, 100, 0, 101])
  // The start vertex carries the absolute rank of the first instance: five, shifted by the stride.
  assert.deepEqual(Array.from(base.args.subarray(8, 12)), [48, 2, 5 << 6, 0])
})

test('a double-sided paged item draws back then face in ONE run, its vertex stage culling', () => {
  const base = scene()
  // Two double-sided items, far to near: each sets the back (culls the face, 1) then the face.
  const order = Uint32Array.from(
    [0, 1].flatMap((item) => [planEntry(item, 1, true), planEntry(item, 2, true)]),
  )
  // Four entries of one pipeline: the main class of the pass, one slot, one draw.
  const runs = Uint32Array.from([0, order.length])
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 })
  assert.equal(total, 10, 'each item expands its clusters once per side')
  const words = Array.from(base.expanded.subarray(0, 20)).filter((_, k) => k % 2 === 0)
  // The paint order is the one two draws per item gave: back of 0, face of 0, back of 1, face of 1.
  assert.deepEqual(words.map(instanceItem), [0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(
    words.map((word) => word >>> 30),
    [1, 1, 2, 2, 1, 1, 1, 2, 2, 2],
    'the cull mode of each instance',
  )
})

test('an empty slot draws no instance and shifts none of the slots after it', () => {
  const base = scene()
  // The main class around one own entry: nothing before it, item 0 after it. The own entry's item
  // has no cluster listed yet: it draws none either.
  const order = Uint32Array.from([entryOf(3), entryOf(0)])
  const runs = Uint32Array.from([0, 0, 0, 1, 1, 1])
  const total = expandBlendPlan({ ...base, order, runs, runCount: 3 })
  assert.equal(total, 2, 'the two clusters of item 0')
  assert.deepEqual(Array.from(base.args.subarray(0, 12)), [48, 0, 0, 0, 48, 0, 0, 0, 48, 2, 0, 0])
})

test('a pipeline cull leaves the instance word as the bare item rank', () => {
  const base = scene()
  const order = Uint32Array.from([entryOf(0, 2)])
  const runs = Uint32Array.from([0, 1])
  expandBlendPlan({ ...base, order, runs, runCount: 1 })
  assert.deepEqual(Array.from(base.expanded.subarray(0, 4)), [0, 100, 0, 101])
})

test('the addressing stride holds the longest instance', () => {
  for (const mots of [3, 48, 384, 385, 4096])
    assert.ok(1 << blendVertexShift(mots) >= mots, `${mots} words fit in the stride`)
})

test('the frustum verdict is read bit by bit, at the item rank', () => {
  const keep = Uint32Array.from([0b1010, 0b0001])
  assert.deepEqual(
    [0, 1, 2, 3, 32, 33].map((item) => hasBit(keep, item)),
    [false, true, false, true, true, false],
  )
})

test('a view expands the items of its passes alone, and the instances of the others leave no gap', () => {
  const base = scene()
  // Items 0 and 2 are of the pass before the depth of field (code 1), item 1 of the pass after (code 2); item 2 is responsive.
  base.draws[3] = itemFilterWord(1, false)
  base.draws[7] = itemFilterWord(2, false)
  base.draws[11] = itemFilterWord(1, true)
  const order = Uint32Array.from([entryOf(0), entryOf(1), entryOf(2)])
  const runs = new Uint32Array(RUN_WORDS)
  runs.set([0, 3])
  // The three passes' bits, and the flag a responsive item carries beside its pass's.
  const passes = (1 << 1) | (1 << 2) | (1 << 3),
    responsive = itemFilterWord(1, true) ^ itemFilterWord(1, false)
  const before = { exclude: passes & ~(1 << 1), require: 0 }
  assert.equal(expandBlendPlan({ ...base, order, runs, runCount: 1, filter: before }), 3)
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [0, 100, 0, 101, 2, 108])
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [48, 3, 0, 0])
  const marking = { exclude: before.exclude, require: responsive }
  assert.equal(expandBlendPlan({ ...base, order, runs, runCount: 1, filter: marking }), 1)
  assert.deepEqual(Array.from(base.expanded.subarray(0, 2)), [2, 108])
  assert.equal(expandBlendPlan({ ...base, order, runs, runCount: 1 }), 6, 'the view of every layer')
})

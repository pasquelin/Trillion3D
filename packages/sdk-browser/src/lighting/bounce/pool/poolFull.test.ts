// The pool's full update (`pool/poolWgsl.ts`) on its kernels run as JavaScript (`pool.fixture.ts`): no budget, the whole pool queued,
// every probe the image reads traced whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS, probeQueueShapeOf } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { cityPool, poolAt, queueFor } from './pool.fixture.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { poolLimits, poolShapeOf } from './poolLayout.ts'

test('a full update has no budget, queues the whole pool and gives every probe back; a frame queues the probes its budget names', () => {
  const { probePool } = BOUNCE_SETTINGS
  const ATLAS = 6
  const queue = (budget: number, full: boolean, pool: number) =>
    probeQueueShapeOf(budget, ATLAS, full, pool).probes
  assert.deepEqual(poolLimits(8, false, queue(8, false, probePool)), {
    room: 32,
    cap: queueFor(8),
    fullUpdate: 0,
  })
  assert.deepEqual(poolLimits(8, true, queue(8, true, probePool)), {
    room: 0xffffffff,
    cap: probePool,
    fullUpdate: 1,
  })
})

test('a pool of its own queues no more than it holds', () => {
  const queue = (budget: number, full: boolean) => probeQueueShapeOf(budget, 6, full, 4096).probes
  assert.deepEqual(poolLimits(8, true, queue(8, true)), {
    room: 0xffffffff,
    cap: 4096,
    fullUpdate: 1,
  })
  assert.ok(poolLimits(1e6, false, queue(1e6, false)).cap <= 4096)
})

test('a full update traces every probe the image reads, at no budget and whole, and keeps none the image does not read', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  const cells = [0, 1, 2, 3, 4, 5].map((d) => around(0, d, 0, 0))
  cells.forEach((cell) => pool.mark(0, ...cell))
  pool.image({ rank: 2, eye, budget: 8 })
  assert.equal(pool.tally().live, 6)
  // The next frame reads four of the six: the others are kept for the frames they are kept, and a budget of one traces one probe.
  cells.slice(0, 4).forEach((cell) => pool.mark(0, ...cell))
  assert.equal(pool.image({ rank: 3, eye, budget: 1 }).length, 1)
  assert.equal(pool.tally().live, 6, 'the persistent cache keeps what the frames to keep say')
  // A full update with a budget of nothing: the six are given back, the four read take new ones, all traced whole.
  cells.slice(0, 4).forEach((cell) => pool.mark(0, ...cell))
  const full = pool.image({ rank: 4, eye, budget: 0, full: true })
  assert.equal(pool.tally().live, 4, 'the probes nothing reads are given back')
  assert.equal(full.length, 4, 'every probe the image reads is traced, whatever the budget')
  assert.ok(
    full.every((entry) => entry.fresh && !entry.down),
    'each a first trace, none at half a side',
  )
})

test('a full update queues past the queue a frame holds: every probe the image reads, up to the pool', () => {
  const eye = [100, 5, 100]
  const { pool, read } = cityPool(eye)
  read()
  const frame = pool.image({ rank: 2, eye, budget: 1 })
  assert.equal(frame.length, queueFor(1))
  read()
  const full = pool.image({ rank: 3, eye, budget: 1, full: true })
  const { live, unfilled } = pool.tally()
  assert.ok(full.length > frame.length, `${full.length} probes against ${frame.length}`)
  assert.equal(full.length, live, 'every probe the image reads is traced')
  assert.equal(unfilled, 0)
  assert.ok(full.every((entry) => entry.fresh && !entry.down))
})

test('the pool of a cache of its own is sized by its levels: a cell of every level, a bit each, four to a texel', () => {
  const world = poolShapeOf(createBounceCascades([0, 0, 0, 10, 10, 10]))
  assert.equal(world.entries, 4 * 48 ** 3)
  const own = poolShapeOf(
    createBounceCascades([0, 0, 0, 10, 10, 10], {
      cascadeLevels: 3,
      cascadeSize: 24,
      cascadeHalfExtentMetres: 25,
      cascadeBase: 2,
      probePool: 4096,
    }),
  )
  assert.deepEqual(own, {
    entries: 3 * 24 ** 3,
    markWords: (3 * 24 ** 3) / 32,
    tableTexels: (3 * 24 ** 3) / 4,
  })
})

// The pool's cost and its kernels (`pool/poolWgsl.ts`) run as JavaScript (`pool.fixture.ts`): what a
// probe costs by its distance from the eye, the budget spent in that cost, and the kernels over the slots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { POOL_COST, POOL_WORK } from './poolLayout.ts'
import { cityPool, poolAt } from './pool.fixture.ts'

test('a probe costs by its distance from the eye — a quarter of a map past the downsample distance, four maps within the supersample distance — and the budget is spent in that cost; a first trace the budget has no room for is told to be traced at half its side', () => {
  const eye = [100, 5, 100]
  // A budget of one probe has no room for the first traces the queue holds: every one is told to be downsampled.
  const starved = cityPool(eye)
  starved.read()
  const hungry = starved.pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(hungry.length, BOUNCE_PROBE_QUEUE)
  assert.ok(
    hungry.every((entry) => entry.fresh && entry.down),
    'no room: all downsampled',
  )
  // A budget of four maps a probe of the queue has room for each at its cost, sixteen units at most: none is.
  const fed = cityPool(eye)
  fed.read()
  assert.ok(
    fed.pool
      .image({ rank: 2, eye, marking: true, budget: 4 * BOUNCE_PROBE_QUEUE })
      .every((entry) => !entry.down),
  )
  // The refreshes: the budget is four units a probe, a probe costs one, four or sixteen.
  const { pool, read } = cityPool(eye)
  read()
  pool.image({ rank: 2, eye, marking: true, budget: 1000 })
  for (let rank = 3; pool.tally().unfilled > 0; rank++)
    pool.image({ rank, eye, marking: false, budget: 1000 })
  const refreshed = (distances: [number, number], rank: number) =>
    pool.image({ rank, eye, marking: false, budget: 10, distances })
  const normal = refreshed([Infinity, 0], 200)
  assert.equal(normal.length, 10, 'a budget of ten probes: ten probes at the cost of a whole map')
  const far = refreshed([0, 0], 300)
  assert.equal(far.length, 40, 'a quarter of a map each: forty')
  const near = refreshed([Infinity, Infinity], 400)
  assert.equal(near.length, 2, 'sixteen units each: two, the third does not fit')
  assert.ok([...normal, ...far, ...near].every((entry) => !entry.fresh && !entry.down))
  assert.equal(POOL_COST.supersampled / POOL_COST.downsampled, 16)
})

test('the kernels over the slots are bounded by the slots ever given, the lowest first', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye, 256)
  pool.image({ rank: 1, eye, marking: false, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 0, 'no slot given: no group dispatched')
  for (let i = 0; i < 3; i++) pool.mark(0, ...around(0, i, 0, 0))
  pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3)
  pool.image({ rank: 3, eye, marking: false, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3, 'what was given lasts')
})

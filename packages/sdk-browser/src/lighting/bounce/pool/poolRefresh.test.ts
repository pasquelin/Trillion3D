// The pool's refreshes (`pool/poolWgsl.ts`) on its kernels run as JavaScript (`pool.fixture.ts`): which probes are traced, in what order,
// at what budget, and when a probe nothing reads is given back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { poolAt } from './pool.fixture.ts'
import { POOL_COST, POOL_PRIORITY_BUCKETS, POOL_WORK } from './poolLayout.ts'

/** The frames a probe nothing reads is kept: the default of the screen probes' settings. */
const { framesToKeepProbes: KEPT } = screenProbeSettings().cache

test('the probes that hold nothing come before every refresh, whatever the budget; filled, the frame holds to the budget again', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  for (const d of [10, 3, 0, 1, 20, 2]) pool.mark(0, ...around(0, d, 0, 0))
  pool.mark(1, ...around(1, 0, 0, 0))
  // A budget of one: the cells that hold nothing are not throttled by it.
  const first = pool.image({ rank: 2, eye, budget: 1 })
  assert.equal(first.length, 7)
  assert.ok(first.every((entry) => entry.fresh))
  assert.equal(pool.tally().unfilled, 0)
  // Filled, the frame holds to the budget: ages are all alike, a budget of two names two.
  for (const d of [10, 3, 0, 1, 20, 2]) pool.mark(0, ...around(0, d, 0, 0))
  pool.mark(1, ...around(1, 0, 0, 0))
  const refreshed = pool.image({ rank: 40, eye, budget: 2 })
  assert.equal(refreshed.length, 2)
  assert.ok(refreshed.every((entry) => !entry.fresh))
})

test('a probe nothing reads for the kept frames is given back, one that is read is not', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  const read = around(0, 0, 0, 0),
    unread = around(0, 1, 0, 0)
  pool.mark(0, ...read)
  pool.mark(0, ...unread)
  pool.image({ rank: 1, eye, budget: 8 })
  for (let rank = 2; rank < 1 + KEPT; rank++) {
    pool.mark(0, ...read)
    pool.image({ rank, eye, budget: 8 })
    assert.equal(pool.tally().live, 2, `image ${rank}`)
  }
  pool.mark(0, ...read)
  pool.image({ rank: 1 + KEPT, eye, budget: 8 })
  assert.equal(pool.tally().live, 1)
})

test('a probe unread for the kept frames is given back by the frame number, whatever the frames between held', () => {
  const eye = [5, 5, 5]
  const kept = (last: number) => {
    const { pool, around } = poolAt(eye)
    const read = around(0, 0, 0, 0),
      unread = around(0, 1, 0, 0)
    pool.mark(0, ...read)
    pool.mark(0, ...unread)
    pool.image({ rank: 1, eye, budget: 8 })
    for (let rank = 2; rank < last; rank++) pool.image({ rank, eye, budget: 8 })
    pool.mark(0, ...read)
    pool.image({ rank: last, eye, budget: 8 })
    return pool.tally().live
  }
  assert.equal(kept(KEPT), 2, 'seven frames since it was read: kept')
  assert.equal(kept(1 + KEPT), 1, 'eight frames since it was read: given back')
})

test('a probe traced before is traced again by the frames from its trace to its last use, over its level plus one', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  const near = around(0, 0, 0, 0),
    unused = around(0, 5, 0, 0),
    coarse = around(1, 0, 0, 0)
  pool.mark(0, ...near)
  pool.mark(0, ...unused)
  pool.mark(1, ...coarse)
  const first = pool.image({ rank: 2, eye, budget: 8, keep: 100 })
  const slotOf = (queued: typeof first, level: number, cell: number[]) =>
    queued.find((entry) => entry.level === level && entry.cell.join() === cell.join())?.slot
  const slots = {
    near: slotOf(first, 0, near),
    coarse: slotOf(first, 1, coarse),
  }
  // Read again, as the image reads them every frame, seven frames after their trace: log2(7) = 2.8 and log2(7 / 2) = 1.8 are worth the
  // buckets 12 and 13 (cut to the whole number from fifteen); the probe nothing reads comes last, whatever its age.
  const order: (number | undefined)[] = []
  for (const rank of [9, 10, 11]) {
    pool.mark(0, ...near)
    pool.mark(1, ...coarse)
    const queued = pool.image({ rank, eye, budget: 1, keep: 100 })
    assert.equal(queued.length, 1)
    order.push(queued[0].slot)
    if (order.length === 1) assert.equal(pool.work[POOL_WORK.cut], 12)
    if (order.length === 2) assert.equal(pool.work[POOL_WORK.cut], 13)
  }
  // The probe just traced waits for the one read since a trace before it; the probe nothing reads is in the last bucket.
  assert.deepEqual(order, [slots.near, slots.coarse, slots.near])
  assert.equal(pool.work[POOL_WORK.cut], 14)
})

test('the probes never traced are in the first bucket of the one histogram, and the walk of the budget stops in the bucket that brings the sum to it', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  pool.mark(0, ...around(0, 0, 0, 0))
  pool.mark(0, ...around(0, 1, 0, 0))
  pool.image({ rank: 2, eye, budget: 8 })
  // A third probe, never traced: a whole map (4 units); the two traced before were not read since, the last bucket (8 units).
  pool.mark(0, ...around(0, 3, 0, 0))
  // A budget of one whole map: the first bucket alone fills it exactly, the walk stops there with nothing left for the others.
  const queued = pool.image({ rank: 5, eye, budget: 1 })
  const histogram = Array.from(
    pool.work.slice(POOL_WORK.priority, POOL_WORK.priority + POOL_PRIORITY_BUCKETS),
  )
  assert.deepEqual(histogram, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8])
  assert.equal(pool.work[POOL_WORK.cut], 0, 'the sum reaches the budget in the first bucket')
  assert.equal(pool.work[POOL_WORK.room], 4)
  assert.equal(queued.length, 1)
  assert.ok(queued[0].fresh)
  // The three probes now wait in the last bucket (12 units); a budget of two maps stops the walk there, with all its room left for it.
  const more = pool.image({ rank: 6, eye, budget: 2 })
  assert.equal(pool.work[POOL_WORK.cut], 15)
  assert.equal(pool.work[POOL_WORK.room], 8)
  assert.equal(more.length, 2, 'two whole maps fit, the third does not')
  // A budget no sum of the buckets reaches: the walk ends past the last bucket with the whole budget left.
  pool.image({ rank: 7, eye, budget: 100 })
  assert.equal(pool.work[POOL_WORK.cut], POOL_PRIORITY_BUCKETS)
  assert.equal(pool.work[POOL_WORK.room], 100 * POOL_COST.normal)
})

test('a probe is short of a trace until it has been traced since the lights last changed', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  const cells = [0, 1, 2].map((d) => around(0, d, 0, 0))
  const read = () => cells.forEach((cell) => pool.mark(0, ...cell))
  read()
  pool.image({ rank: 2, eye, budget: 8 })
  read()
  pool.image({ rank: 3, eye, budget: 8 })
  assert.equal(pool.tally().refreshing, 0, 'no change yet: nothing short of a trace')
  // The lights changed, and the budget has room for one probe of the three: two are short of a trace, then one, then none.
  read()
  pool.image({ rank: 4, eye, restart: true, budget: 1 })
  assert.equal(pool.tally().refreshing, 2)
  read()
  pool.image({ rank: 5, eye, budget: 1 })
  assert.equal(pool.tally().refreshing, 1)
  read()
  pool.image({ rank: 6, eye, budget: 1 })
  assert.equal(
    pool.tally().refreshing,
    0,
    'every probe traced since the change: the series may close',
  )
  // A change with no room in the budget leaves every probe short of a trace; none of them holds nothing (`unfilled`).
  read()
  pool.image({ rank: 7, eye, restart: true, budget: 0 })
  assert.equal(pool.tally().refreshing, 3)
  assert.equal(pool.tally().unfilled, 0)
})

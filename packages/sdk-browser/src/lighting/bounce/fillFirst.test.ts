// The pool fills the probes that hold nothing before it refreshes any: every new probe in the first bucket, and the cells an eye that jumps lands among.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CITY_REACH, cityPool, queueFor } from './pool/pool.fixture.ts'

const landed = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the probes that hold nothing fill before any refresh: every new probe in the first bucket, whatever its level or distance', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, read } = cityPool(eye)
  read()
  // A budget of ten probes: the cells that hold nothing are not throttled by it, the queue is.
  const queued = pool.image({ rank: 2, eye, budget: 10 })
  assert.equal(queued.length, queueFor(10), 'the queue the budget names fills past a budget of ten')
  // The reference sorts a probe made this frame into the first bucket of its priorities whatever its level and its distance
  // (its last trace never): the queue takes new probes in the order the kernel meets them, never one already traced, and
  // only the cells the image read, each within the read block about the eye at its own level.
  assert.ok(
    queued.every((entry) => entry.fresh),
    'only probes that hold nothing',
  )
  for (const entry of queued) {
    const spacing = cascades.levels[entry.level].spacing
    const at = eye.map((v) => Math.floor(v / spacing))
    assert.ok(
      entry.cell.every((c, axis) => Math.abs(c - at[axis]) <= CITY_REACH),
      `a cell the image read: ${entry.cell} at level ${entry.level}`,
    )
  }
  // Run on, the cells fill and the count of those left falls to zero. A pass queues a refresh only
  // once no cell is left that holds nothing: a probe already filled is refreshed after every empty one.
  for (let rank = 3; pool.tally().unfilled > 0; rank++) {
    assert.ok(rank < 100, 'the cells fill')
    read()
    const sent = pool.image({ rank, eye, budget: 10 })
    if (sent.some((entry) => !entry.fresh))
      assert.equal(pool.tally().unfilled, 0, 'no refresh before a cell that holds nothing')
  }
  // Filled, the frame holds to the budget again.
  read()
  assert.ok(pool.image({ rank: 100, eye, budget: 10 }).length <= 10)
})

test('an eye that jumps leaves the cells it lands among empty, and they fill before any refresh', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, read } = cityPool(eye)
  read()
  pool.image({ rank: 2, eye, budget: 10 })
  for (let rank = 3; pool.tally().unfilled > 0; rank++) {
    read()
    pool.image({ rank, eye, budget: 10 })
  }
  const landed = [30, 8, 160]
  assert.equal(cascades.follow(landed), true)
  // The cells the old eye read are mostly out of the finest level now: given back as the levels slid, and the new ones read.
  const readLanded = () => {
    for (let level = 0; level < 2; level++) {
      const spacing = cascades.levels[level].spacing
      const at = landed.map((v) => Math.floor(v / spacing))
      for (let dz = -CITY_REACH; dz <= CITY_REACH; dz++)
        for (let dy = -CITY_REACH; dy <= CITY_REACH; dy++)
          for (let dx = -CITY_REACH; dx <= CITY_REACH; dx++)
            pool.mark(level, at[0] + dx, at[1] + dy, at[2] + dz)
    }
  }
  readLanded()
  const queued = pool.image({ rank: 40, eye: landed, budget: 10 })
  assert.ok(
    pool.tally().live < 2 * 2 * (2 * CITY_REACH + 1) ** 3,
    'the cells that left are given back',
  )
  assert.ok(pool.tally().unfilled >= 0)
  // What holds nothing before any refresh, in the first bucket whatever its distance, as the reference sorts a new probe.
  assert.ok(queued.length > 0, 'the landed cells queue their new probes')
  assert.ok(
    queued.every((entry) => entry.fresh),
    'what holds nothing before any refresh',
  )
  for (let rank = 41; pool.tally().unfilled > 0; rank++) {
    assert.ok(rank < 200, 'the cells fill again')
    readLanded()
    pool.image({ rank, eye: landed, budget: 10 })
  }
  assert.equal(pool.tally().unfilled, 0)
})

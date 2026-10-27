// The pool's cost and its kernels (`pool/poolWgsl.ts`) run as JavaScript (`pool.fixture.ts`): what a
// probe costs by its distance from the eye, the budget spent in that cost, and the kernels over the slots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { POOL_COST, POOL_WORK } from './poolLayout.ts'
import { POOL_SHADER } from './poolWgsl.ts'
import { POOL_QUEUE, cityPool, poolAt, queueFor } from './pool.fixture.ts'

test('a probe costs by its distance from the eye — a quarter of a map past the downsample distance, four maps within the supersample distance — and the budget is spent in that cost; a first trace the budget has no room for is told to be traced at half its side', () => {
  const eye = [100, 5, 100]
  // A budget of one probe has no room for the first traces the queue holds: every one is told to be downsampled.
  const starved = cityPool(eye)
  starved.read()
  const hungry = starved.pool.image({ rank: 2, eye, budget: 1 })
  assert.equal(hungry.length, queueFor(1))
  assert.ok(
    hungry.every((entry) => entry.fresh && entry.down),
    'no room: all downsampled',
  )
  // A budget of four maps a probe of the queue has room for each at its cost, sixteen units at most: none is.
  const fed = cityPool(eye)
  fed.read()
  assert.ok(fed.pool.image({ rank: 2, eye, budget: 4 * POOL_QUEUE }).every((entry) => !entry.down))
  // The refreshes: the budget is four units a probe, a probe costs one, four or sixteen.
  const { pool, read } = cityPool(eye)
  read()
  pool.image({ rank: 2, eye, budget: 1000 })
  for (let rank = 3; pool.tally().unfilled > 0; rank++) {
    read()
    pool.image({ rank, eye, budget: 1000 })
  }
  // The image reads the same cells every frame, as it does while the view stands still.
  const refreshed = (distances: [number, number], rank: number) => {
    read()
    return pool.image({ rank, eye, budget: 10, distances })
  }
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
  pool.image({ rank: 1, eye, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 0, 'no slot given: no group dispatched')
  for (let i = 0; i < 3; i++) pool.mark(0, ...around(0, i, 0, 0))
  pool.image({ rank: 2, eye, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3)
  pool.image({ rank: 3, eye, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3, 'what was given lasts')
})

test('under an orthographic view a probe costs by its distance along the view: the vector to the eye squared over its extent along the direction the view looks along, as the perspective one by its length', () => {
  const costOf = (forward: number[], cell: number[]) =>
    shaderRun<{ probeCost: (level: number, cell: number[]) => number }>(
      POOL_SHADER,
      ['probeCost'],
      {
        bounce: {
          counts: [48, 1, 48 ** 3, 16384],
          eye: [0, 0, 0, 0],
          forward,
          levels: [{ base: [-24, -24, -24], spacing: 1 }],
        },
        pool: { distances: [100, 25] },
      },
    ).probeCost(0, cell)
  const perspective = [0, 0, 0, 0]
  const ortho = [0, 0, -1, 1]
  // The cell (3, 0, 3) is 3 along x and z from the eye: 18 squared, within the 25 of the supersample distance; along the view it is
  // 18 / 3 = 6 away, 36 squared: past it, within the downsample distance.
  assert.equal(costOf(perspective, [3, 0, 3]), POOL_COST.supersampled)
  assert.equal(costOf(ortho, [3, 0, 3]), POOL_COST.normal)
  // The cell (6, 0, 6): 72 squared; along the view 72 / 6 = 12 away, 144 squared, past the downsample distance's 100.
  assert.equal(costOf(perspective, [6, 0, 6]), POOL_COST.normal)
  assert.equal(costOf(ortho, [6, 0, 6]), POOL_COST.downsampled)
  // Straight along the view the two are one: 81 squared.
  assert.equal(costOf(ortho, [0, 0, 9]), costOf(perspective, [0, 0, 9]))
})

test('the pool and the cache name the one place of a cell’s probe, a multiple of the cell’s side: the cost of a probe counts its distance from it', () => {
  assert.equal(POOL_SHADER.match(/fn probePosition\(/g)?.length, 1)
  assert.ok(!POOL_SHADER.includes('probeCentre') && !POOL_SHADER.includes('probeCellCentre'))
  const { probePosition } = shaderRun<{
    probePosition: (cell: number[], spacing: number) => number[]
  }>(POOL_SHADER, ['probePosition'], {})
  assert.deepEqual(probePosition([0, -1, 3], 2), [0, -2, 6])
})

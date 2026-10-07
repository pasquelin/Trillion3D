// Batch H2: the pure off-thread page-task contract — no platform here, only the pool bound.
// Hostile inputs: missing or non-integer sizes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pageWorkerCount } from './taskContracts.ts'

test('the pool bound keeps the smallest of cores, ceiling and admission', () => {
  assert.equal(pageWorkerCount(8, 6), 4) // default ceiling (4) tightest
  assert.equal(pageWorkerCount(8, 2), 2) // tightest admission
  assert.equal(pageWorkerCount(1, 10), 1) // tightest cores
  assert.equal(pageWorkerCount(10, 10, 2), 2) // explicit ceiling tightest
})

test('missing or non-integer cores equal a single executor', () => {
  assert.equal(pageWorkerCount(undefined, 10), 1)
  assert.equal(pageWorkerCount(Number.NaN, 10), 1)
  assert.equal(pageWorkerCount(3.5, 10), 1)
  assert.equal(pageWorkerCount(Number.POSITIVE_INFINITY, 10), 1)
})

test('a missing or non-integer admission equals a single admitted executor', () => {
  assert.equal(pageWorkerCount(8, undefined as unknown as number), 1)
  assert.equal(pageWorkerCount(8, Number.NaN), 1)
  assert.equal(pageWorkerCount(8, 2.9), 1)
})

test('the bound never falls under a single executor, even at zero or negative', () => {
  assert.equal(pageWorkerCount(8, 0), 1)
  assert.equal(pageWorkerCount(0, 10), 1)
  assert.equal(pageWorkerCount(8, -5), 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_GRID_HEADER_WORDS,
  LIGHT_GRID_WIDTH,
  planLightGrid,
  rankBytes,
} from './lightGridLayout.ts'

const SETTINGS = { resolution: 256, maxCount: 128, axis: 3 }

test('a rank takes the fewest bytes the lights allow', () => {
  assert.deepEqual([1, 256, 257, 65536, 65537].map(rankBytes), [1, 1, 2, 2, 4])
})

test('the reference defaults, with few lights: the lists keep every light, whole words', () => {
  const plan = planLightGrid(5, 1, 6, SETTINGS, 8192)
  assert.equal(plan.resolution, 256)
  assert.equal(plan.maxCount, 5)
  assert.equal(plan.bytes, 1)
  assert.equal(plan.stride, 8)
  assert.equal(plan.countsAt, LIGHT_GRID_HEADER_WORDS + 1)
  assert.equal(plan.dataAt, plan.countsAt + 3 * 256 * 256)
  assert.equal(plan.words, plan.dataAt + (3 * 256 * 256 * 8) / 4)
  assert.equal(plan.rows, Math.ceil(plan.words / LIGHT_GRID_WIDTH))
  assert.equal(plan.all, false)
})

test('the settings are clamped as the reference does: 1 to 2048 cells, 1 to the local lights', () => {
  const plan = planLightGrid(3, 0, 3, { resolution: 99999, maxCount: 0, axis: 1 }, 1 << 20)
  assert.deepEqual([plan.resolution, plan.maxCount, plan.axis], [2048, 1, 1])
})

test('no local light: no grid, the suns alone', () => {
  const plan = planLightGrid(0, 2, 2, SETTINGS, 8192)
  assert.equal(plan.resolution, 0)
  assert.equal(plan.words, LIGHT_GRID_HEADER_WORDS + 2)
  assert.equal(plan.all, false)
})

test('a grid the device cannot hold loops over every light', () => {
  const plan = planLightGrid(100, 1, 101, SETTINGS, 64)
  assert.equal(plan.all, true)
  assert.equal(plan.rows, 1)
})

// The CPU side of the shadow cache: its values and when it holds data.
// The cache's bias, ageing and placements over frames are in `cacheAging.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_PRESSURE_LOAD,
  VSM_PRESSURE_BIAS_MAX,
  VSM_PRESSURE_CALM_FRAMES,
  VSM_STILL_FRAMES,
  VSM_LIGHT_KEEP_FRAMES,
  VSM_POOL_PAGES,
  VSM_PRESSURE_RISE,
  VSM_PRESSURE_FALL,
} from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'

test('the cache and budget values', () => {
  assert.equal(VSM_STILL_FRAMES, 100)
  assert.equal(VSM_LIGHT_KEEP_FRAMES, 10)
  assert.equal(VSM_POOL_PAGES, 2048)
  assert.deepEqual(
    [
      VSM_PRESSURE_LOAD,
      VSM_PRESSURE_BIAS_MAX,
      VSM_PRESSURE_RISE,
      VSM_PRESSURE_FALL,
      VSM_PRESSURE_CALM_FRAMES,
    ],
    [0.85, 2, 0.5, 0.1, 10],
  )
})

test('the cache has data once a frame is extracted, until it is invalidated', () => {
  const cache = new VsmCacheManager()
  assert.equal(cache.hasPreviousFrame(), false)
  cache.keepFrameForNext({
    mapSlotCount: 1,
    fullMapCount: 0,
    singlePageMapCount: 1,
  })
  assert.equal(cache.hasPreviousFrame(), true)
  cache.invalidate()
  assert.equal(cache.hasPreviousFrame(), false, 'a pool resize drops the previous frame')
})

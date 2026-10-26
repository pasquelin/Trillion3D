// The CPU side of the shadow cache: its values and when it holds data.
// The cache's bias, ageing and placements over frames are in `cacheAging.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_PRESSURE_CALM_FRAMES,
  VSM_POOL_PAGES,
  VSM_PRESSURE_RISE,
  VSM_PRESSURE_FALL,
} from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'

test('the cache and budget values', () => {
  const s = VSM_DEFAULT_SHADOWS
  assert.deepEqual(
    [
      s.shadowCacheFramesStaticThreshold,
      s.shadowCacheMaxPageAgeSinceLastRequest,
      s.shadowCacheMaxLightAgeSinceLastRequest,
    ],
    [100, 1000, 10],
  )
  assert.equal(VSM_POOL_PAGES, 4096)
  assert.deepEqual(
    [
      s.shadowDynamicResolutionMaxPagePoolLoadFactor,
      s.shadowDynamicResolutionMaxResolutionLodBias,
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
    mapCount: 1,
  })
  assert.equal(cache.hasPreviousFrame(), true)
  cache.invalidate()
  assert.equal(cache.hasPreviousFrame(), false, 'a pool resize drops the previous frame')
})

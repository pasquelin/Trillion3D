// The maps the rows' shadow changes stale on the GPU (`castInvalidation.ts`): those the CPU's boxes
// are filtered to — an entry that may hold cached pages, every map of it —, each map's word saying
// whether it draws its moving casters over a receiver cover, which a moving box skips. None when the
// cache holds nothing to stale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmLightCache, type VsmCacheManager } from './cacheManager.ts'
import { vsmCastMaps } from './castInvalidation.ts'
import { MAP_COVER } from './castInvalidationWgsl.ts'

/** A sun of one map holding cached pages, a point light of six over a receiver cover, a spot never
 *  rendered; the cache accepting invalidations when `accepts`. */
function cache(accepts: boolean) {
  const sun = new VsmLightCache('sun', 1),
    point = new VsmLightCache('point', 6),
    spot = new VsmLightCache('spot', 1)
  sun.mapId = 0
  point.mapId = 1
  spot.mapId = 7
  sun.renderedFrame = point.renderedFrame = 3
  point.useCover = true
  const entries = new Map([
    ['sun', sun],
    ['point', point],
    ['spot', spot],
  ])
  return { acceptsInvalidations: () => accepts, entries } as unknown as VsmCacheManager
}

test('the maps that may hold cached pages, each with its cover bit; none without cache data', () => {
  const words = vsmCastMaps(cache(true))!
  assert.deepEqual(
    [...words].map((word) => (word & ~MAP_COVER) >>> 0),
    [0, 1, 2, 3, 4, 5, 6],
    'the sun, then the point light: the spot never rendered holds nothing',
  )
  assert.deepEqual(
    [...words].map((word) => (word & MAP_COVER) !== 0),
    [false, true, true, true, true, true, true],
  )
  assert.equal(vsmCastMaps(cache(false)), null)
})

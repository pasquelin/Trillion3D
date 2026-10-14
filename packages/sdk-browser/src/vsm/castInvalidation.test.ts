// The maps the rows' shadow changes stale on the GPU (`castInvalidation.ts`): those the CPU's boxes
// are filtered to — an entry that may hold cached pages, every map of it —, each map's word saying
// whether it draws its moving casters over a receiver cover, which a moving box skips: read by the
// one filter both stales' kernels run (`vsmStaleMap`, `staleMapWgsl.ts`). None when the cache holds
// nothing to stale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmLightCache, type VsmCacheManager } from './cacheManager.ts'
import { vsmCastMaps } from './castInvalidation.ts'
import { VSM_STALE_MAP_WGSL } from './staleMapWgsl.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'

const { vsmStaleMap } = shaderRun<{ vsmStaleMap: (word: number, moving: boolean) => number }>(
  VSM_STALE_MAP_WGSL,
  ['vsmStaleMap'],
  {},
)
/** What `vsmStaleMap` answers for a map a box skips: an id past every map. */
const SKIPPED = 0xffffffff

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
    [...words].map((word) => vsmStaleMap(word, false)),
    [0, 1, 2, 3, 4, 5, 6],
    'the sun, then the point light: the spot never rendered holds nothing',
  )
  assert.deepEqual(
    [...words].map((word) => vsmStaleMap(word, true)),
    [0, SKIPPED, SKIPPED, SKIPPED, SKIPPED, SKIPPED, SKIPPED],
    'a moving box skips the point light, whose maps draw their moving casters over a cover',
  )
  assert.equal(vsmCastMaps(cache(false)), null)
})

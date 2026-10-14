// The maps the shadow changes stale on the GPU (`castInvalidation.ts`) — an entry that may hold
// cached pages, every map of it —, each map's word saying whether it draws its moving casters over a
// receiver cover, which a moving box skips: read by the one filter of the one stale (`vsmStaleMap`,
// `staleMapWgsl.ts`). None when the cache holds nothing to stale or nothing changed. And the CPU's
// boxes as that stale reads them (`invalidationPhase.ts`, `VsmCastBox`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmLightCache, type VsmCacheManager } from './cacheManager.ts'
import { vsmCastMaps } from './castInvalidation.ts'
import { vsmInvalidationPhaseFromShadowBoxes } from './invalidationPhase.ts'
import { UNBOUNDED_EXTENT, VSM_BOX_CASTS, VSM_BOX_MOVING } from './invalidationWgsl.ts'
import type { CastChanges } from '../webgpu/shadow/castChanges.ts'
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

/** A list of the rows' shadow changes a pass appended to, or not. */
const list = (appended: boolean) => ({ appended }) as CastChanges
/** One still box of the CPU's, from `box`'s bounds. */
const boxes = (box: { min: number[]; max: number[]; moving: boolean }) =>
  vsmInvalidationPhaseFromShadowBoxes(cache(true), { count: 1, read: () => box })

test('the maps that may hold cached pages, each with its cover bit; none without cache data', () => {
  const words = vsmCastMaps(cache(true), null, list(true))!
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
  assert.equal(vsmCastMaps(cache(false), null, list(true)), null)
})

// The old plan walked every entry and map each frame, whether anything changed or not.
test('no maps when nothing changed: no CPU box, and no pass appended to the list', () => {
  const still = { min: [0, 0, 0], max: [1, 1, 1], moving: false }
  assert.equal(vsmCastMaps(cache(true), null, list(false)), null)
  assert.equal(vsmCastMaps(cache(true), null, undefined), null)
  assert.equal(vsmCastMaps(cache(true), boxes(still), undefined)?.length, 7, 'a CPU box alone')
})

test('a CPU box as the stale reads it: its centre split high and low, its flags, its extent', () => {
  const far = 1e6 + 1 / 3
  const phase = boxes({ min: [far - 1, -2, 0], max: [far + 1, 2, 8], moving: true })!
  const words = phase.words,
    flags = new Uint32Array(words.buffer)
  assert.equal(phase.count, 1)
  assert.ok(
    Math.abs(words[0] + words[4] - far) < Math.abs(words[0] - far) / 1000,
    'the low word holds what the high one left',
  )
  assert.deepEqual([words[1], words[2], words[5], words[6]], [0, 4, 0, 0])
  assert.equal(flags[3], VSM_BOX_CASTS | VSM_BOX_MOVING)
  assert.deepEqual([...words.subarray(8, 11)], [1, 2, 4])
  const inverted = boxes({ min: [1, 0, 0], max: [0, 1, 1], moving: false })!.words
  assert.deepEqual([...inverted.subarray(0, 3)], [0, 0, 0], 'the unbounded box, at the origin')
  assert.deepEqual([...inverted.subarray(8, 11)], Array(3).fill(Math.fround(UNBOUNDED_EXTENT)))
  assert.equal(new Uint32Array(inverted.buffer)[3], VSM_BOX_CASTS)
  assert.equal(
    vsmInvalidationPhaseFromShadowBoxes(cache(false), {
      count: 1,
      read: () => ({ min: [0, 0, 0], max: [1, 1, 1], moving: false }),
    }),
    null,
  )
})

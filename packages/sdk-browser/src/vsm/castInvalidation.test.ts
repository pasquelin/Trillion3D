// The maps the shadow changes stale on the GPU (`castInvalidation.ts`) — an entry that may hold
// cached pages, every map of it —, each map's word saying whether it draws its moving casters over
// a receiver cover, which a moving box skips: read by the one filter of the one stale
// (`vsmStaleMap`, `staleMapWgsl.ts`). None when the cache holds nothing to stale or nothing
// changed. And the CPU's boxes as records of the one format that stale reads (`castBoxes.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmLightCache, type VsmCacheManager } from './cacheManager.ts'
import { encodeCastInvalidation, vsmCastMaps } from './castInvalidation.ts'
import { vsmCastBoxes } from './castBoxes.ts'
import { UNBOUNDED_EXTENT } from './invalidationWgsl.ts'
import { createCastChanges, type CastChanges } from '../webgpu/shadow/castChanges.ts'
import { createVsmResources } from './resources.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { dispatchedEntries } from '../../../../tests/kit/gpu/fakeRecords.ts'
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
  vsmCastBoxes(cache(true), { count: 1, read: () => box })

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

test('a CPU box as a record of the list: its centre an f32, its largest half extent, never less', () => {
  const far = 1e6 + 1 / 3
  const words = boxes({ min: [far - 1, -2, 0], max: [far + 1, 2, 8], moving: true })!.words
  assert.deepEqual([...words.subarray(0, 3)], [Math.fround(far), 0, 4])
  // 4 is a float32: the least float32 at or above it is 4 itself.
  assert.equal(words[3], -4, 'the largest half extent, moving')
  // A point far out: its extent the centre's rounding, so that the record still holds it.
  const point = boxes({ min: [far, 0, 0], max: [far, 0, 0], moving: false })!.words
  assert.ok(point[3] >= Math.abs(far - point[0]) && point[3] > 0)
  // A point at the origin keeps the sign that says its casters move.
  assert.equal(boxes({ min: [0, 0, 0], max: [0, 0, 0], moving: true })!.words[3], -(2 ** -40))
  const inverted = boxes({ min: [1, 0, 0], max: [0, 1, 1], moving: false })!.words
  assert.deepEqual([...inverted.subarray(0, 3)], [0, 0, 0], 'the unbounded box, at the origin')
  assert.ok(inverted[3] >= UNBOUNDED_EXTENT)
  assert.equal(
    vsmCastBoxes(cache(false), {
      count: 1,
      read: () => ({ min: [0, 0, 0], max: [1, 1, 1], moving: false }),
    }),
    null,
  )
})

// The CPU's boxes were once appended to the list by a kernel of their own, the list grown for them
// in the frame's encoder: a frame dropped took the old list, its unread records with it. Now the
// stale reads them after the list, from their own buffer: the list never grows for them.
test('the stale reads the CPU boxes after the list, from their own buffer: the list never grows', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, {
    fullMapCapacity: 127,
    sunMapCapacity: 35,
    poolPages: 256,
  })
  const casts = createCastChanges(device, 4),
    held = casts.buffer
  const still = { min: [0, 0, 0], max: [1, 1, 1], moving: false }
  const changed = vsmCastBoxes(cache(true), { count: 8, read: () => still })!
  const encoder = device.createCommandEncoder()
  const maps = new Uint32Array([0])
  const threads = encodeCastInvalidation(encoder, res, device, 1, maps, changed, casts)
  assert.equal(threads, 8)
  assert.equal(casts.buffer, held, 'no room asked of the list for the eight boxes')
  assert.deepEqual(fake.copies, [], 'nothing copied')
  assert.deepEqual(dispatchedEntries(fake.dispatches), ['vsmCastArgs', 'vsmStaleCasts'])
  const state = res.invalidation!
  const written = fake.writes.find((write) => write.buffer === state.boxes)!
  assert.deepEqual([...written.data], [...changed.words.subarray(0, 8 * 4)], 'the eight records')
  const stale = state.groups.stale.group as unknown as GPUBindGroupDescriptor
  assert.deepEqual(
    [...stale.entries].map((entry) => (entry.resource as GPUBufferBinding).buffer),
    [state.params, state.maps, held, state.boxes],
    'the list, then the boxes',
  )
  assert.ok(
    !fake.clears.some((clear) => clear.buffer === casts.buffer),
    'a list no pass appended to left as it is',
  )
})

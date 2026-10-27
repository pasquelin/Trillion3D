// The maps the shadow changes stale on the GPU (`castInvalidation.ts`) — an entry that may hold
// cached pages, every map of it, by id —: a box has a thread in each of them, a map over a receiver
// cover too (its thread leaves a box cached as dynamic, `vsmStaleBoxPages`). None when the cache
// holds nothing to stale or nothing changed. And the CPU's boxes as the records that stale reads
// after the list (`castBoxes.ts`).
import { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { VsmCacheManager } from '../cacheManager.ts'
import { VsmLightCache } from '../lightCache.ts'
import { encodeCastInvalidation, endCastInvalidation, vsmCastMaps } from './castInvalidation.ts'
import { CAST_BOX_WORDS, vsmCastBoxes } from './castBoxes.ts'
import { UNBOUNDED_EXTENT } from '../../../../deformation/halfFloat.ts'
import { createCastChanges, type CastChanges } from '../../casters/castChanges.ts'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import { createVsmResources } from '../resources.ts'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { dispatchedEntries } from '../../../../../../../tests/kit/fakeDevice/fakeRecords.ts'

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
  vsmCastBoxes(cache(true), { count: () => 1, read: () => box })

test('the maps that may hold cached pages, by id, a cover or not; none without cache data', () => {
  assert.deepEqual(
    [...vsmCastMaps(cache(true), null, list(true))!],
    [0, 1, 2, 3, 4, 5, 6],
    'the sun, then the point light over its cover: the spot never rendered holds nothing',
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

// A CPU box was the cube of its largest half extent: a flat tile staled a cube's pages.
test('a CPU box as a record: its centre an f32 and moving sign, its half axes along the world, never less', () => {
  const far = 1e6 + 1 / 3
  const words = boxes({ min: [far - 1, -2, 0], max: [far + 1, 2, 8], moving: true })!.words
  // The half axes: x at word 4, y at 9, z at 14.
  const axes = (w: Float32Array) => [w[4]!, w[9]!, w[14]!]
  assert.deepEqual([...words.subarray(0, 4)], [Math.fround(far), 0, 4, -1], 'its centre, moving')
  assert.ok(
    axes(words)[0]! >= 1 + Math.abs(far - words[0]!) && axes(words)[0]! < 1.1,
    'x: 1, its rounding added',
  )
  // 2 and 4 are float32s: the least float32 at or above each is itself.
  assert.deepEqual(axes(words).slice(1), [2, 4], 'y and z kept apart')
  assert.deepEqual(
    [5, 6, 8, 10, 12, 13].map((k) => words[k]),
    [0, 0, 0, 0, 0, 0],
    'each axis along its own',
  )
  assert.equal(new Uint32Array(words.buffer)[7], 0xffffffff, 'then the views it stales: every one')
  const flat = boxes({ min: [-100, 0, -100], max: [100, 2, 100], moving: false })!.words
  assert.deepEqual([...flat.subarray(0, 4)], [0, 1, 0, 1], 'a flat tile stays flat')
  assert.deepEqual(axes(flat), [100, 1, 100])
  // A point far out: its extent the centre's rounding, so that the record still holds it.
  const point = boxes({ min: [far, 0, 0], max: [far, 0, 0], moving: false })!.words
  assert.ok(axes(point)[0]! >= Math.abs(far - point[0]!) && axes(point)[0]! > 0)
  assert.equal(boxes({ min: [0, 0, 0], max: [0, 0, 0], moving: true })!.words[3], -1)
  const inverted = boxes({ min: [1, 0, 0], max: [0, 1, 1], moving: false })!.words
  assert.deepEqual([...inverted.subarray(0, 4)], [0, 0, 0, 1], 'the unbounded box, at the origin')
  for (const extent of axes(inverted)) assert.ok(extent >= UNBOUNDED_EXTENT)
  assert.equal(
    vsmCastBoxes(cache(false), {
      count: () => 1,
      read: () => ({ min: [0, 0, 0], max: [1, 1, 1], moving: false }),
    }),
    null,
  )
})

test('the stale reads the CPU boxes after the list, from their own buffer: the list never grows', async () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, {
    coverMode: 'suns',
    fullMapCapacity: 127,
    sunMapCapacity: 35,
    poolPages: 256,
  })
  const casts = createCastChanges(device, 4),
    held = casts.buffer
  const still = { min: [0, 0, 0], max: [1, 1, 1], moving: false }
  const changed = vsmCastBoxes(cache(true), { count: () => 8, read: () => still })!
  const maps = new Uint32Array([0])
  // A first call asks the pipelines; the frame under test runs once they are compiled.
  const asking = new ComputeRun().begin(device.createCommandEncoder())
  encodeCastInvalidation(asking, res, device, 1, maps, changed, casts, false)
  await pipelinesSettled(device)
  fake.writes.splice(0)
  const encoder = device.createCommandEncoder()
  const steps = new ComputeRun().begin(encoder)
  const threads = encodeCastInvalidation(steps, res, device, 1, maps, changed, casts, false)
  steps.end()
  endCastInvalidation(encoder, casts)
  assert.equal(threads, 8)
  assert.equal(casts.buffer, held, 'no room asked of the list for the eight boxes')
  assert.deepEqual(fake.copies, [], 'nothing copied')
  assert.deepEqual(dispatchedEntries(fake.dispatches), ['vsmCastArgs', 'vsmStaleCasts'])
  const state = res.invalidation!
  const written = fake.writes.find((write) => write.buffer === state.boxes)!
  assert.deepEqual(
    [...written.data],
    [...changed.words.subarray(0, 8 * CAST_BOX_WORDS)],
    'the eight records',
  )
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

// The cache over frames: the
// pool pressure bias follows the pool's load, down fast past 85 %, up slowly after 10 calm
// frames, within [0, 2]; a light's mobility factor falls over 10 frames; a light no
// longer seen goes after 10; the engine's placements follow the 100-frame static rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_PRESSURE_CALM_FRAMES,
  VSM_STILL_FRAMES,
  VSM_LIGHT_KEEP_FRAMES,
  VSM_MAP_UNSEEN,
} from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { createShadowMobility } from '../webgpu/shadow/mobility.ts'

test('the global LOD bias: down fast past 85 % of the pool, up slowly after 10 calm frames, in [0, 2]', () => {
  const cache = new VsmCacheManager()
  const f = Math.fround
  /** The bias rule, restated: the bias the next frame reads. */
  const target = (free: number, last: number) =>
    f(Math.max(0, last + Math.log2(f(f(1 - f(free / 2048)) / f(0.85)))))
  // Full pool: allocation 1 > 0.85 → half way to log2(1 / 0.85).
  cache.frameStamp = 1
  let bias = cache.readPoolFeedback(0, 0)
  assert.ok(Math.abs(bias - 0.5 * Math.log2(1 / 0.85)) < 1e-6)
  assert.equal(bias, f(0 + (target(0, 0) - 0) * 0.5))
  // An overflowing pool pushes it on, never past 2.
  for (let n = 2; n < 40; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(-2048, bias)
  }
  assert.equal(bias, 2)
  // Half the pool free: under budget, but for 10 frames nothing moves.
  for (let n = 40; n <= 39 + VSM_PRESSURE_CALM_FRAMES; n++) {
    cache.frameStamp = n
    assert.equal(cache.readPoolFeedback(1024, bias), 2, `frame ${n}: too soon`)
  }
  cache.frameStamp = 40 + VSM_PRESSURE_CALM_FRAMES
  const up = cache.readPoolFeedback(1024, bias)
  assert.equal(up, f(2 + (target(1024, 2) - 2) * 0.1), 'a tenth of the way')
  assert.ok(up < 2 && up > 1.9)
  // An empty pool lets it fall to 0, not below.
  for (let n = 51; n < 400; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(2048, cache.pressureBias)
  }
  assert.ok(bias >= 0 && bias < 1e-6)
})

test("a light's mobility factor: 1 when it changes, down to 0 over the next 10 frames", () => {
  const cache = new VsmCacheManager()
  const factors: number[] = []
  for (let n = 0; n < 12; n++) {
    cache.frameStamp = n
    factors.push(cache.updateLightMobility('sun', false))
  }
  assert.deepEqual(factors.slice(0, 3), [1, Math.fround(0.9), Math.fround(0.8)])
  assert.deepEqual(factors.slice(10), [0, 0])
  cache.frameStamp = 12
  assert.equal(cache.updateLightMobility('sun', true), 1, 'moved again')
})

test('a light no longer seen keeps its maps, unreferenced, 10 frames, then goes', () => {
  const cache = new VsmCacheManager()
  const entry = cache.lightEntryFor('lamp', 6)
  entry.moveToMapId(8192)
  cache.keepFrameForNext(null)
  let next = 9000
  const ids = {
    mapSlotCount: 9000,
    allocateUnreferenced: (_single: boolean, count: number) => ((next += count), next - count),
    writeNextMap: () => {},
  }
  cache.frameStamp = VSM_LIGHT_KEEP_FRAMES
  cache.carryUnseenLights(ids)
  assert.equal(cache.entries.size, 1)
  assert.ok(entry.mapCaches.every((m) => m.projectionData.flags & VSM_MAP_UNSEEN))
  assert.equal(entry.mapId, 9000, 'its maps moved to unreferenced ids')
  cache.frameStamp = VSM_LIGHT_KEEP_FRAMES + 1
  cache.carryUnseenLights(ids)
  assert.equal(cache.entries.size, 0)
  // Keyed by light; another map count is another entry.
  const a = cache.lightEntryFor('sun', 17)
  assert.equal(a.lightId, 'sun')
  assert.equal(cache.lightEntryFor('sun', 17), a)
  assert.notEqual(cache.lightEntryFor('sun', 16), a)
})

test('a moving placement turns static after resting more than the 100-frame threshold', () => {
  const mobility = createShadowMobility()
  const pose = new Float64Array(16)
  mobility.ensure(2, 2, () => pose)
  mobility.move(1, pose, true)
  const turned: number[] = []
  for (let frame = 1; frame <= VSM_STILL_FRAMES; frame++)
    mobility.settle(VSM_STILL_FRAMES, (rank) => turned.push(rank))
  assert.ok(mobility.moves(1), '100 frames at rest: still moving')
  assert.equal(
    mobility.settle(VSM_STILL_FRAMES, (rank) => turned.push(rank)),
    true,
  )
  assert.deepEqual(turned, [1], 'the 101st: static, its static pages invalidated once')
  assert.ok(!mobility.moves(1))
  // A move restarts the count.
  mobility.move(1, pose, true)
  for (let frame = 1; frame <= 50; frame++) mobility.settle(VSM_STILL_FRAMES, () => {})
  mobility.move(1, pose, true)
  for (let frame = 1; frame <= 100; frame++) mobility.settle(VSM_STILL_FRAMES, () => {})
  assert.ok(mobility.moves(1), 'moved 100 frames ago')
})

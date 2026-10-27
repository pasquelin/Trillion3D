// The cache over frames: the
// pool pressure bias follows the pool's load, down fast past 85 %, up slowly after 10 calm
// frames, within [0, 2]; a light no
// longer seen goes after 10; the engine's placements follow the 100-frame static rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_MAP_COARSE,
  VSM_MIPS,
  VSM_PRESSURE_CALM_FRAMES,
  VSM_POOL_PAGES,
  VSM_MAP_UNSEEN,
} from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { vsmCacheKey, type VsmLightCache } from './lightCache.ts'
import { VsmMapIds } from './mapIds.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { PROJECTION, VIEW, mapsOf } from './clipmap.fixture.ts'
import { scheduleDistantUpdates } from './distantLights.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'
import { createShadowMobility } from '../casters/mobility.ts'
import { MOVE_NONE } from '../../../placement/update.ts'

const VSM_STILL_FRAMES = VSM_DEFAULT_SHADOWS.shadowCacheFramesStaticThreshold,
  VSM_LIGHT_KEEP_FRAMES = VSM_DEFAULT_SHADOWS.shadowCacheMaxLightAgeSinceLastRequest

test('the global LOD bias: down fast past 85 % of the pool, up slowly after 10 calm frames, in [0, 2]', () => {
  const cache = new VsmCacheManager()
  /** The bias rule, restated: the bias the next frame reads. */
  const target = (free: number, last: number) =>
    Math.fround(
      Math.max(
        0,
        last +
          Math.log2(
            Math.fround(Math.fround(1 - Math.fround(free / VSM_POOL_PAGES)) / Math.fround(0.85)),
          ),
      ),
    )
  // Full pool: allocation 1 > 0.85 → half way to log2(1 / 0.85).
  cache.frameStamp = 1
  let bias = cache.readPoolFeedback(0, 0)
  assert.ok(Math.abs(bias - 0.5 * Math.log2(1 / 0.85)) < 1e-6)
  assert.equal(bias, Math.fround(0 + (target(0, 0) - 0) * 0.5))
  // An overflowing pool pushes it on, never past 2.
  for (let n = 2; n < 40; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(-VSM_POOL_PAGES, bias)
  }
  assert.equal(bias, 2)
  // Half the pool free: under budget, but for 10 frames nothing moves.
  for (let n = 40; n <= 39 + VSM_PRESSURE_CALM_FRAMES; n++) {
    cache.frameStamp = n
    assert.equal(cache.readPoolFeedback(VSM_POOL_PAGES / 2, bias), 2, `frame ${n}: too soon`)
  }
  cache.frameStamp = 40 + VSM_PRESSURE_CALM_FRAMES
  const up = cache.readPoolFeedback(VSM_POOL_PAGES / 2, bias)
  assert.equal(up, Math.fround(2 + (target(VSM_POOL_PAGES / 2, 2) - 2) * 0.1), 'a tenth of the way')
  assert.ok(up < 2 && up > 1.9)
  // An empty pool lets it fall to 0, not below.
  for (let n = 51; n < 400; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(VSM_POOL_PAGES, cache.pressureBias)
  }
  assert.ok(bias >= 0 && bias < 1e-6)
})

/** One frame's ids over `cache`: the entries `seen` claim as the lights that referenced them, the others
 *  as the unreferenced ones that have not aged out, then the claims committed. */
function claimFrame(cache: VsmCacheManager, ids: VsmMapIds, seen: VsmLightCache[] = []) {
  ids.reset()
  for (const entry of seen) ids.claim(entry, entry.view === undefined ? 'light' : 'sun')
  cache.claimUnseenLights(ids)
  ids.seal()
  cache.commitIds(ids)
}

test('a light no longer seen keeps its maps, unreferenced, 10 frames, then goes', () => {
  const cache = new VsmCacheManager()
  const entry = cache.lightEntryFor('lamp', 6)
  entry.moveToMapId(8192)
  const ids = new VsmMapIds()
  cache.beginFrame(VSM_LIGHT_KEEP_FRAMES)
  claimFrame(cache, ids)
  assert.equal(cache.entries.size, 1)
  assert.ok(entry.mapCaches.every((m) => m.projectionData.flags & VSM_MAP_UNSEEN))
  assert.equal(entry.mapId, 0, 'its maps moved to unreferenced ids')
  cache.beginFrame(VSM_LIGHT_KEEP_FRAMES + 1)
  claimFrame(cache, ids)
  assert.equal(cache.entries.size, 0)
  // Keyed by light; another map count is another entry.
  const a = cache.lightEntryFor('sun', 17)
  assert.equal(a.lightId, 'sun')
  assert.equal(cache.lightEntryFor('sun', 17), a)
  assert.notEqual(cache.lightEntryFor('sun', 16), a)
})

test('an entry is keyed by light id, view and shadow type: a name with a # or a view named firstPerson never shares one', () => {
  const cache = new VsmCacheManager()
  const plain = cache.lightEntryFor('sun#firstPerson', 2)
  const viewed = cache.lightEntryFor('sun', 2, 'firstPerson')
  const regular = cache.lightEntryFor('sun', 2, '')
  const firstPerson = cache.lightEntryFor('sun', 2, '', 1)
  const entries = [plain, viewed, regular, firstPerson]
  assert.equal(new Set(entries).size, 4)
  assert.equal(new Set(entries.map((e) => e.key)).size, 4)
  assert.equal(cache.lightEntryFor('sun', 2, '', 1), firstPerson)
  assert.deepEqual([regular.typeTag, firstPerson.typeTag, firstPerson.lightId], [0, 1, 'sun'])
})

test('a first-person entry survives the removed-light drop while its light exists, and goes with it', () => {
  const cache = new VsmCacheManager()
  const regular = cache.lightEntryFor('sun', 2, '')
  const firstPerson = cache.lightEntryFor('sun', 2, '', 1)
  cache.dropRemovedLights((id) => id === 'moon')
  assert.equal(cache.entries.get(vsmCacheKey('sun', '')), regular)
  assert.equal(cache.entries.get(vsmCacheKey('sun', '', 1)), firstPerson)
  cache.dropRemovedLights((id) => id === 'sun')
  assert.equal(cache.entries.size, 0)
})

test('a moving placement turns static after resting more than the 100-frame threshold', () => {
  const mobility = createShadowMobility()
  const pose = new Float64Array(16)
  mobility.ensure(2, () => pose)
  mobility.move(1, pose, true)
  for (let frame = 1; frame <= VSM_STILL_FRAMES; frame++) mobility.settle(VSM_STILL_FRAMES)
  assert.ok(mobility.moves(1), '100 frames at rest: still moving')
  mobility.settle(VSM_STILL_FRAMES)
  assert.ok(!mobility.moves(1), 'the 101st: static, its word written anew')
  // A move restarts the count.
  mobility.move(1, pose, true)
  for (let frame = 1; frame <= 50; frame++) mobility.settle(VSM_STILL_FRAMES)
  mobility.move(1, pose, true)
  for (let frame = 1; frame <= 100; frame++) mobility.settle(VSM_STILL_FRAMES)
  assert.ok(mobility.moves(1), 'moved 100 frames ago')
})

test('a placement parked while moving goes back to static: a placement that reuses its row starts so', () => {
  const mobility = createShadowMobility()
  const pose = new Float64Array(16)
  mobility.ensure(2, () => pose)
  mobility.move(1, pose, true)
  mobility.settle(VSM_STILL_FRAMES)
  assert.ok(mobility.moves(1))
  mobility.park(1)
  assert.ok(!mobility.moves(1), 'static at once')
  // Shown again where it stands: no move, still static.
  assert.ok(mobility.holds(1, pose), 'its pose is kept: shown at the same pose is no move')
  assert.equal(mobility.move(1, pose), MOVE_NONE)
  assert.ok(!mobility.moves(1), 'still static')
  // Reused at another pose: it moves again, rests the threshold, and turns static once, not twice.
  mobility.move(
    1,
    Float64Array.from({ length: 16 }, (_, i) => (i === 12 ? 5 : 0)),
  )
  assert.ok(mobility.moves(1))
  for (let frame = 0; frame <= VSM_STILL_FRAMES + 1; frame++) mobility.settle(VSM_STILL_FRAMES)
  assert.ok(!mobility.moves(1), 'static again after the threshold')
})

test('each view keeps its own sun clipmap and the local maps are shared; all age by the scene frame', () => {
  const cache = new VsmCacheManager()
  const ids = new VsmMapIds()
  cache.beginFrame(1)
  const main = cache.lightEntryFor('sun', 17, '')
  const lamp = cache.lightEntryFor('lamp', 6)
  cache.keepFrameForNext(null)
  cache.beginFrame(2, 'side')
  const side = cache.lightEntryFor('sun', 17, 'side')
  assert.notEqual(side, main, 'centred on another eye: an entry of its own')
  assert.notEqual(side.key, main.key)
  assert.equal(cache.lightEntryFor('lamp', 6), lamp, 'a local light’s maps every view shares')
  cache.keepFrameForNext(null)
  // The side view drawn on, the main one not: the main view's clipmap is kept while it is recent
  // enough, then goes with the scene frames, as an unrequested light does.
  const mainKey = vsmCacheKey('sun', '')
  for (let n = 3; n < 3 + 4 * VSM_LIGHT_KEEP_FRAMES; n++) {
    cache.beginFrame(n, 'side')
    claimFrame(cache, ids, [cache.lightEntryFor('sun', 17, 'side')])
    cache.keepFrameForNext(null)
    const kept = cache.entries.get(mainKey) === main
    assert.equal(kept, n - 1 <= VSM_LIGHT_KEEP_FRAMES, `scene frame ${n}: the main view's clipmap`)
  }
  cache.dropView('side')
  assert.equal(cache.entries.has(side.key), false, 'a released view’s clipmap goes')
})

const EYE_VIEW = vsmLocalViewData(
  { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
  { width: 1024, height: 768 },
)
/** A point light `z` metres ahead of the eye, of range 6. */
const lamp = (id: string, z: number, x = 0) => ({
  ...{ id, kind: 'point' as const, position: [x, 3, z], range: 6 },
})

/** The frames of `lights` under the settings `changes`, as the plan sets them up
 *  (`planVirtualShadowFrame`): the schedule, every light's setup, then the frame's end marking
 *  them rendered. Each frame's lights drawn again — their maps invalidated before the frame
 *  ended — by id. */
function distantFrames(
  lights: (frame: number) => ReturnType<typeof lamp>[],
  changes: Parameters<typeof mapsOf>[0],
  count: number,
) {
  const cache = new VsmCacheManager()
  const drawn: string[][] = []
  const setups: ReturnType<typeof addVsmLocalLightShadow>[][] = []
  for (let n = 1; n <= count; n++) {
    const maps = mapsOf(changes, n)
    cache.beginFrame(n)
    scheduleDistantUpdates(cache, maps.shadows.shadowMaxDistantUpdatePerFrame, n)
    const now = lights(n).map((light) => addVsmLocalLightShadow(cache, light, [EYE_VIEW], maps))
    drawn.push(now.filter((s) => s.cacheEntry.isInvalidated()).map((s) => s.cacheEntry.lightId))
    for (const [k, { cacheEntry }] of now.entries()) {
      cacheEntry.moveToMapId(6 * k)
      cacheEntry.markRendered(n)
    }
    setups.push(now)
    cache.keepFrameForNext(null)
  }
  return { cache, drawn, setups }
}

const FAR = () => [lamp('a', -300), lamp('b', -300, 1), lamp('c', -300, 2)]

test('a distant light takes the last mip alone with its page always marked, whatever the coarse mode', () => {
  for (const marks of [0, 1, 2]) {
    const { setups } = distantFrames(FAR, { shadowMarkCoarsePagesLocal: marks }, 1)
    for (const { cacheEntry, finestMip } of setups[0]) {
      assert.ok(cacheEntry.distant, 'it is distant')
      assert.equal(finestMip, VSM_MIPS - 1, 'the last mip')
      for (const map of cacheEntry.mapCaches)
        assert.ok(map.projectionData.flags & VSM_MAP_COARSE, `marked, mode ${marks}`)
    }
  }
  // The modes: 0 none is, 1 those of the last mip alone, 2 all of them.
  const near = [lamp('near', -3)]
  const is = (mode: 0 | 1 | 2) =>
    distantFrames(() => near, { shadowDistantLightMode: mode }, 1).setups[0][0]
  assert.equal(is(0).cacheEntry.distant, false)
  assert.ok(is(1).finestMip < VSM_MIPS - 1 && !is(1).cacheEntry.distant, 'a near light is not')
  assert.ok(is(2).cacheEntry.distant && is(2).finestMip === VSM_MIPS - 1, 'forced: the last mip')
  assert.equal(
    distantFrames(FAR, { shadowDistantLightMode: 0 }, 1).setups[0][0].cacheEntry.distant,
    false,
  )
})

/** Frames drawn before a distant light is kept: its first, and the one after it that turns its
 *  uncached maps cached (`VsmLightCache.updateCommon`). */
const WARM_UP = 2

test('a distant light is drawn once and kept, then again one light a frame, the longest kept first', () => {
  const { drawn, cache } = distantFrames(FAR, {}, WARM_UP + 8)
  assert.deepEqual(drawn.slice(0, WARM_UP), [
    ['a', 'b', 'c'],
    ['a', 'b', 'c'],
  ])
  // Each later frame draws one: every light has its turn before any has a second.
  const turns = drawn.slice(WARM_UP)
  assert.ok(
    turns.every((ids) => ids.length === 1),
    JSON.stringify(turns),
  )
  for (let k = 0; k + 3 <= turns.length; k += 3)
    assert.deepEqual(new Set(turns.slice(k, k + 3).flat()), new Set(['a', 'b', 'c']), `round ${k}`)
  // Between its turns a light is fully cached, so the casters' invalidations leave it alone.
  for (const entry of cache.entries.values()) {
    assert.ok(entry.isFullyCached())
    assert.equal(entry.mayHoldCachedPages(), false)
  }
  const near = distantFrames(() => [lamp('n', -3)], { shadowDistantLightMode: 0 }, 3)
  const nearEntry = near.cache.entries.get(vsmCacheKey('n'))!
  assert.equal(nearEntry.mayHoldCachedPages(), true, 'a near light may')
})

test('the distant updates a frame: all of them for -1, none for 0 — then only a moved light is drawn', () => {
  const later = (drawn: string[][]) => drawn.slice(WARM_UP)
  const all = distantFrames(FAR, { shadowMaxDistantUpdatePerFrame: -1 }, WARM_UP + 2)
  assert.deepEqual(later(all.drawn), [
    ['a', 'b', 'c'],
    ['a', 'b', 'c'],
  ])
  const none = distantFrames(FAR, { shadowMaxDistantUpdatePerFrame: 0 }, WARM_UP + 5)
  assert.deepEqual(later(none.drawn), [[], [], [], [], []], 'never again')
  const two = distantFrames(FAR, { shadowMaxDistantUpdatePerFrame: 2 }, WARM_UP + 3)
  assert.deepEqual(
    later(two.drawn).map((ids) => ids.length),
    [2, 2, 2],
  )
  // A light that moves is drawn at once, scheduled or not.
  const moved = distantFrames(
    (frame) => [lamp('a', -300), lamp('b', frame < WARM_UP + 3 ? -300 : -301)],
    { shadowMaxDistantUpdatePerFrame: 0 },
    WARM_UP + 4,
  )
  // Drawn as it moves, and once more as its uncached maps turn cached (`WARM_UP`).
  assert.deepEqual(later(moved.drawn), [[], [], ['b'], ['b']])
})

test('the distant schedule turns once a scene frame, whatever the views and the plans set up in it', () => {
  const { cache } = distantFrames(FAR, { shadowMaxDistantUpdatePerFrame: 1 }, WARM_UP)
  let stamp = WARM_UP
  // The lights the schedule picked while `views` were set up in the scene frame `scene`.
  const picked = (scene: number, views: string[]) => {
    const before = new Map([...cache.entries].map(([key, entry]) => [key, entry.scheduledFrame]))
    for (const view of views) {
      cache.beginFrame(++stamp, view)
      scheduleDistantUpdates(cache, 1, scene)
    }
    return [...cache.entries].filter(([key, entry]) => entry.scheduledFrame !== before.get(key))
  }
  assert.deepEqual(
    [3, 4, 5].map((scene) => picked(scene, ['', 'side']).length),
    [1, 1, 1],
  )
  // A view planned twice in one scene frame turns it once; the next scene frame turns it anew.
  assert.equal(picked(6, ['', '']).length, 1)
  assert.equal(picked(6, ['']).length, 0)
  assert.equal(picked(7, ['']).length, 1)
})

test('the unseen entries are given ids a run at a time: the maps of one page first, then the full maps’', () => {
  const cache = new VsmCacheManager()
  const full = cache.lightEntryFor('full', 6)
  const far = cache.lightEntryFor('far', 6)
  far.updateLocal(true, true, false, false)
  const ids = new VsmMapIds()
  cache.beginFrame(1)
  claimFrame(cache, ids)
  assert.deepEqual(
    [full.mapId, far.mapId],
    [6, 0],
    'the maps of one page first, then the full maps',
  )
  // An entry that aged out goes at the commit, whatever its run.
  cache.beginFrame(VSM_LIGHT_KEEP_FRAMES + 2)
  claimFrame(cache, ids)
  assert.deepEqual([...cache.entries.keys()], [])
})

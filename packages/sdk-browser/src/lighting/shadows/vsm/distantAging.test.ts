// The distant lights over frames: the last mip alone, drawn once and kept, then again one light a frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_MAP_COARSE, VSM_MIPS, VSM_MAX_SINGLE_PAGE_MAPS } from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { vsmCacheKey, type VsmLightCache } from './lightCache.ts'
import { VsmMapIds } from './mapIds.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { claimFrame } from './cacheAging.fixture.ts'
import { PROJECTION, VIEW, mapsOf } from './clipmap.fixture.ts'
import { scheduleDistantUpdates } from './distantLights.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'

const VSM_LIGHT_KEEP_FRAMES = VSM_DEFAULT_SHADOWS.shadowCacheMaxLightAgeSinceLastRequest

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
    [VSM_MAX_SINGLE_PAGE_MAPS, 0],
    'the maps of one page first, the full maps from the end of their range',
  )
  // An entry that aged out goes at the commit, whatever its run.
  cache.beginFrame(VSM_LIGHT_KEEP_FRAMES + 2)
  claimFrame(cache, ids)
  assert.deepEqual([...cache.entries.keys()], [])
})

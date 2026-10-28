// What the cache keeps across the frames the plan sets up: every entry ages by the one counter of scene
// frames, and a plan that is dropped moves no id (`cacheManager.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmCacheManager } from './cacheManager.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { VsmMapIds } from './mapIds.ts'
import { VSM_MAX_SINGLE_PAGE_MAPS } from './constants.ts'

const VSM_LIGHT_KEEP_FRAMES = VSM_DEFAULT_SHADOWS.shadowCacheMaxLightAgeSinceLastRequest

// Every entry ages on the one counter of scene frames (`frameStamp`), whichever view drew it: the
// entries of a view no longer drawn go after the age limit, drawn once and left, as do the maps every
// view shares.
test('the entries of a view drawn once age out by the scene frames of the views still drawn', () => {
  const cache = new VsmCacheManager()
  const ids = new VsmMapIds()
  cache.beginFrame(1, 'a')
  cache.lightEntryFor('sun', 17, 'a')
  cache.keepFrameForNext(null)
  cache.beginFrame(2, 'b')
  const b = cache.lightEntryFor('sun', 17, 'b')
  const shared = cache.lightEntryFor('lamp', 6)
  cache.keepFrameForNext(null)
  // Only the view `a` is drawn from now on.
  for (let n = 3; n < 3 + 2 * VSM_LIGHT_KEEP_FRAMES; n++) {
    cache.beginFrame(n, 'a')
    const sun = cache.lightEntryFor('sun', 17, 'a')
    ids.reset().claim(sun, 'sun')
    cache.claimUnseenLights(ids)
    ids.seal()
    cache.commitIds(ids)
    cache.keepFrameForNext(null)
    const alive = n - 2 <= VSM_LIGHT_KEEP_FRAMES
    assert.equal(cache.entries.get(b.key) === b, alive, `frame ${n}: the view b's clipmap`)
    assert.equal(cache.entries.get(shared.key) === shared, alive, `frame ${n}: the shared maps`)
  }
  assert.equal(cache.viewCount, 2, 'both views were drawn')
})

// A plan that is dropped (the slots grow, the frame casts none) moves no id: the entries are given
// theirs at the commit, so that the next frame's allocation moves them from the ids the GPU holds.
// A sun's clipmap, whose setup moved its panned origin, draws afresh; a local light's does not.
test('a dropped plan moves no id and has the clipmaps draw afresh', () => {
  const cache = new VsmCacheManager()
  const lamp = cache.lightEntryFor('lamp', 6)
  const sun = cache.lightEntryFor('sun', 3, '')
  sun.clipmap = {} as never
  lamp.moveToMapId(4)
  sun.moveToMapId(10)
  lamp.markRendered(1)
  sun.markRendered(1)
  cache.keepFrameForNext({ mapCount: 16, sunBase: 10 })
  cache.beginFrame(2)
  cache.lightEntryFor('lamp', 6)
  cache.lightEntryFor('sun', 3, '')
  const ids = new VsmMapIds().reset()
  ids.claim(lamp, 'light')
  ids.claim(sun, 'sun')
  ids.seal()
  cache.dropFrame()
  assert.deepEqual([lamp.mapId, sun.mapId], [4, 10], 'no id moved')
  assert.equal(sun.isInvalidated(), true, 'the clipmap draws afresh')
  assert.equal(lamp.isInvalidated(), false)
  // The next frame is claimed from the ids held.
  cache.beginFrame(3)
  assert.equal(lamp.seenThisFrame, false, 'no entry is seen before its light asks')
  cache.lightEntryFor('lamp', 6)
  ids.reset().claim(lamp, 'light')
  ids.seal()
  cache.commitIds(ids)
  assert.deepEqual([lamp.mapId, lamp.prevMapId], [VSM_MAX_SINGLE_PAGE_MAPS, 4])
})

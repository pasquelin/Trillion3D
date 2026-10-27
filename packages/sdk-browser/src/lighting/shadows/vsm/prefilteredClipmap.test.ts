// The sun's clipmap with the prefiltered distant shadow (`shadowPrefilteredDistant`): the regular
// clipmap keeps no page and cuts its depth at each level's end, each level's record carries the flag,
// its index and the band it draws into the filtered pages; the first-person clipmap holds none of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_MAP_UNCACHED, VSM_NEXT_KEEPS_PAGES } from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { vsmClipmapConfig, vsmFirstPersonClipmapConfig } from './mapSettings.ts'
import { VSM_MAP_LEVEL_INDEX_SHIFT, VSM_MAP_PREFILTERED_DISTANT } from './prefilteredConstants.ts'
import {
  clipDepth,
  cullingEnd,
  firstPersonFrames,
  frame,
  mapsOf,
  renderedFrames,
} from './clipmap.fixture.ts'
import { FLOAT32_MAX } from '../../../../../math/src/constants.ts'

const ON = mapsOf({ shadowPrefilteredDistant: true })

test('the config of the regular clipmap keeps no page and cuts its depth, the first-person one holds none of it', () => {
  const off = { ...vsmClipmapConfig(mapsOf({}).shadows) }
  assert.deepEqual(
    [off.prefilteredDistant, off.forceInvalidate, off.cullTightly],
    [false, false, true],
  )
  // On, whatever the settings the two switches it forces say.
  const loose = mapsOf({ shadowPrefilteredDistant: true, shadowClipmapCullDynamicTightly: false })
  const on = { ...vsmClipmapConfig(loose.shadows) }
  assert.deepEqual([on.prefilteredDistant, on.forceInvalidate, on.cullTightly], [true, true, true])
  // The first-person clipmap always keeps no page, takes the view's own cull setting, and no band;
  // its coarse pages keep their dynamic layer as the view's setting (mode 2) says, as any clipmap's.
  const own = { ...vsmFirstPersonClipmapConfig(loose.shadows) }
  assert.deepEqual(
    [own.prefilteredDistant, own.forceInvalidate, own.cullTightly],
    [false, true, false],
  )
  assert.deepEqual([own.coarseFrom, own.keepsDynamic], [-1, true])
  // The config object is rewritten by each: the regular one again, no trace of the first-person's.
  assert.equal(vsmClipmapConfig(mapsOf({}).shadows).prefilteredDistant, false)
})

test('each level’s record carries the flag, its index in the clipmap and the band it draws into', () => {
  const clipmap = renderedFrames(new VsmCacheManager(), 3, ON)
  const records = clipmap.cacheEntry.mapCaches.map((map) => map.projectionData)
  assert.equal(records.length, 17)
  records.forEach((record, k) => {
    assert.ok(record.flags & VSM_MAP_PREFILTERED_DISTANT, `level ${k}: the flag`)
    assert.equal((record.flags >>> VSM_MAP_LEVEL_INDEX_SHIFT) & 0xff, k, `level ${k}: its index`)
    assert.ok(record.flags & VSM_MAP_UNCACHED, `level ${k}: uncached`)
  })
  // From where the level before ends its band (none for the first) to the level's own end, toward the
  // light: the clip depth of -distance in the level's view, the outer end the greater.
  const band = (k: number) => {
    const level = clipmap.levels[k]
    const inner = k === 0 ? 0 : cullingEnd(6 + k - 1),
      outer = cullingEnd(6 + k)
    return {
      inner: clipDepth(level, -inner),
      outer: clipDepth(level, -outer),
    }
  }
  for (const k of [0, 1, 2, 9, 16]) {
    const [near, far] = records[k].dynamicDepthCullRange
    const expected = band(k)
    assert.ok(Math.abs(near - expected.inner) < 1e-9, `level ${k}: inner ${near}`)
    assert.ok(Math.abs(far - expected.outer) < 1e-9, `level ${k}: outer ${far}`)
    assert.ok(near < far, `level ${k}: the outer end lies nearer the light than the inner one`)
  }
  // The first level's inner end is the eye's plane: the clip depth of 0.
  const first = clipmap.levels[0]
  const depthRadius = 128e3,
    end = cullingEnd(6)
  assert.ok(Math.abs(records[0].dynamicDepthCullRange[0] - end / (end + depthRadius)) < 1e-9)
  assert.ok(Math.abs(first.viewToClip[14] - (1 - depthRadius / (end + depthRadius))) < 1e-9)
})

test('the clipmap is drawn uncached every frame, no level keeping a page', () => {
  const cache = new VsmCacheManager()
  const clipmap = renderedFrames(cache, 4, ON)
  assert.ok(clipmap.cacheEntry.isUncached)
  for (const map of clipmap.cacheEntry.mapCaches)
    assert.equal(map.nextMaps.flags & VSM_NEXT_KEEPS_PAGES, 0, 'no page carried over')
  // The option turned on over a cached clipmap: its pages are drawn again, none kept.
  const cached = new VsmCacheManager()
  const before = renderedFrames(cached, 3)
  assert.ok(!before.cacheEntry.isUncached)
  cached.frameStamp = 3
  const turned = frame(cached, [0, 0, 0], 1024, ON)
  assert.ok(turned.cacheEntry.isUncached)
  assert.ok(
    turned.cacheEntry.mapCaches.every((map) => (map.nextMaps.flags & VSM_NEXT_KEEPS_PAGES) === 0),
  )
})

test('without it the levels carry neither the flag nor a band', () => {
  const clipmap = renderedFrames(new VsmCacheManager(), 3)
  for (const map of clipmap.cacheEntry.mapCaches) {
    const record = map.projectionData
    assert.equal(record.flags & VSM_MAP_PREFILTERED_DISTANT, 0)
    assert.equal(record.flags >>> VSM_MAP_LEVEL_INDEX_SHIFT, 0, 'no level index')
    assert.equal(record.dynamicDepthCullRange[1], FLOAT32_MAX)
  }
})

test('the first-person clipmap keeps its own range and carries no flag beside a prefiltered sun', () => {
  const cache = new VsmCacheManager()
  const loose = mapsOf({ shadowPrefilteredDistant: true, shadowClipmapCullDynamicTightly: false })
  const own = firstPersonFrames(cache, 3, loose)
  assert.ok(own.cacheEntry.isUncached)
  for (const map of own.cacheEntry.mapCaches) {
    assert.equal(map.projectionData.flags & VSM_MAP_PREFILTERED_DISTANT, 0)
    assert.equal(map.projectionData.dynamicDepthCullRange[1], FLOAT32_MAX)
  }
  // Not tight: the cached level’s matrix, as for any first-person clipmap under that setting.
  assert.ok(Math.abs(own.levels[0].viewToClip[14] - 0.5) < 1e-12)
  // The sun’s regular clipmap beside it is tight all the same.
  const regular = renderedFrames(cache, 3, loose)
  assert.ok(Math.abs(clipDepth(regular.levels[0], cullingEnd(6))) < 1e-9)
})

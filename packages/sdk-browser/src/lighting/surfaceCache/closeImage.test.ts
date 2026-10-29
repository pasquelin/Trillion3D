import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SURFACE_CACHE_RULES } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { createSurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { closeImage } from './closeImage.ts'
import type { SurfaceCacheFrameState } from './frame.ts'

/** A cache state that holds nothing and asks for nothing: what `closeImage` reads of it, as a fake. */
function quietState() {
  const settings = resolveSettings(SURFACE_CACHE_RULES, {})
  return {
    cache: createSurfaceCache(settings),
    settings,
    raster: { failure: undefined },
    placements: { count: 0 },
    tables: { bytes: 0 },
    busy: true,
    updated: false,
    metrics: null,
  } as unknown as SurfaceCacheFrameState
}
const NOTHING = { captured: 0, copied: 0, refreshed: 0, waiting: 0 }

test('a cache with no request left, no page asked again and no object held back is not busy after the image', () => {
  const state = quietState()
  for (let image = 0; image < 8; image++) {
    closeImage(state, NOTHING, 0)
    assert.equal(state.busy, false, `image ${image}`)
  }
})

test('each term that keeps the cache busy does so while it holds, and no longer', () => {
  const state = quietState()
  const { stats } = state.cache
  for (const [what, hold, release] of [
    ['mesh cards to add', () => (stats.meshCardsToAdd = 1), () => (stats.meshCardsToAdd = 0)],
    [
      'locked cards to update',
      () => (stats.lockedCardsToUpdate = 1),
      () => (stats.lockedCardsToUpdate = 0),
    ],
    [
      'high-resolution pages to add',
      () => (stats.hiResPagesToAdd = 1),
      () => (stats.hiResPagesToAdd = 0),
    ],
  ] as const) {
    hold()
    closeImage(state, NOTHING, 0)
    assert.equal(state.busy, true, what)
    release()
    closeImage(state, NOTHING, 0)
    assert.equal(state.busy, false, `${what} released`)
  }
  closeImage(state, { ...NOTHING, waiting: 1 }, 0)
  assert.equal(state.busy, true, 'pages asked again')
  closeImage(state, NOTHING, 2)
  assert.equal(state.busy, true, 'objects held back for their textures')
  closeImage(state, { ...NOTHING, captured: 3, copied: 1, refreshed: 2 }, 0)
  assert.equal(state.busy, false, 'a capture alone, and a refresh, keep nothing')
})

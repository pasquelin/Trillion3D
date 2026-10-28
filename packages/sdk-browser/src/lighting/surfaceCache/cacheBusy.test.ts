// The cache has work left after an image while an object waits for its textures: the textures land between two images and the next one captures it,
// so the frame must not be held before — nor the lighting's settling begun — with the object still uncaptured (`closeImage`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeImage } from './closeImage.ts'
import type { SurfaceCacheFrameState } from './frame.ts'

const NO_STATS = { meshCardsToAdd: 0, lockedCardsToUpdate: 0, hiResPagesToAdd: 0, desiredTexels: 0 }
const NO_ACCOUNT = { captured: 0, copied: 0, refreshed: 0, waiting: 0 }

/** The part of a cache's frame state an image closes over, with the requests the image left (`stats`). */
function closing(stats: Partial<typeof NO_STATS> = {}) {
  return {
    cache: {
      stats: { ...NO_STATS, ...stats },
      frame: 1,
      allocator: { pagesX: 1, pagesY: 1, freePages: 1 },
      meshCards: [],
      cards: [],
    },
    raster: { failure: undefined },
    settings: { surfaceCacheFreeze: false, surfaceCacheFreezeUpdateFrame: 0 },
    tables: { bytes: 0 },
    placements: { count: 0 },
    busy: false,
  } as unknown as SurfaceCacheFrameState
}

test('a cache with nothing left to do, and no object held for its textures, is not busy', () => {
  const state = closing()
  closeImage(state, NO_ACCOUNT, 0)
  assert.equal(state.busy, false)
})

test('an object held back for its textures keeps the cache busy, whatever else it has left, and shows in the account', () => {
  const state = closing()
  closeImage(state, NO_ACCOUNT, 2)
  assert.equal(state.busy, true)
  assert.equal(state.metrics?.waiting, 2)
})

test('cards to add or update, pages to capture again, and requests asked again each keep it busy', () => {
  for (const stats of [{ meshCardsToAdd: 1 }, { lockedCardsToUpdate: 1 }, { hiResPagesToAdd: 1 }]) {
    const state = closing(stats)
    closeImage(state, NO_ACCOUNT, 0)
    assert.equal(state.busy, true, JSON.stringify(stats))
  }
  const asked = closing()
  closeImage(asked, { ...NO_ACCOUNT, waiting: 2 }, 0)
  assert.equal(asked.busy, true)
})

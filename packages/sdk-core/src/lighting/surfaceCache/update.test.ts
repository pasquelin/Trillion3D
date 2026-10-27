// The image's update (`update.ts`) of a frozen cache: nothing is given mesh cards, planned or captured.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../contracts/surfaceCacheOptions.ts'
import { INT32_MAX, resolveSettingsInto, type SettingValues } from '../../contracts/settingRules.ts'
import { cardLimits, cardResLevel } from './cardResolution.ts'
import type { MeshCards } from './cardTypes.ts'
import { maxCapturesPerFrame, maxTileCapturesPerFrame } from './requests.ts'
import { createSurfaceCache, type Placement } from './state.ts'
import { updateSurfaceCache } from './update.ts'

const defaults = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, defaults)

/** A placement of 20 metres, in range of the eye at the origin, that wants mesh cards. */
const placementWanting = (): Placement => ({
  id: 0,
  world: new Float64Array(16),
  mesh: {
    cards: [],
    min: [0, 0, 0],
    max: [0, 0, 0],
    mostlyTwoSided: false,
  } as unknown as MeshCards,
  shareId: -1,
  emissive: false,
  opaqueOrMasked: true,
  lightingChannels: 1,
  bounds: new Float64Array([-1000, -1000, -1000, 1000, 1000, 1000]),
  extentMax: 1000,
  visible: false,
  validMeshCards: true,
  meshCards: -1,
})

/** The image of an eye at the origin over a cache with that placement, under `changes` of the defaults. */
function updated(changes: Partial<typeof defaults>) {
  const settings = { ...defaults, ...changes }
  const cache = createSurfaceCache(settings)
  cache.placements.set(0, placementWanting())
  const work = updateSurfaceCache(cache, settings, {
    origins: [[0, 0, 0]],
    orthographic: false,
    clipmapExtent: 100000,
  })
  return { cache, work }
}

test('a frozen cache captures no tile, whatever its budget, and asks of the scene nothing', () => {
  assert.equal(maxTileCapturesPerFrame(defaults), maxCapturesPerFrame(defaults))
  assert.equal(maxTileCapturesPerFrame({ ...defaults, surfaceCacheFreeze: true }), 0)
  assert.equal(maxTileCapturesPerFrame({ ...defaults, surfaceCacheFreezeUpdateFrame: 1 }), 300)
  // Not frozen, the placement is asked about and counted as wanting cards.
  assert.equal(updated({}).cache.stats.meshCardsToAdd, 1)
  // Frozen, the update stops before the scene is asked: no card is added, planned or captured, no page evicted.
  const { cache, work } = updated({ surfaceCacheFreeze: true })
  assert.equal(cache.stats.meshCardsToAdd, 0)
  assert.equal(cache.stats.lockedCardsToUpdate, 0)
  assert.equal(work.pages.length, 0)
  assert.equal(work.texels, 0)
})

test('a cache recaptured every image is emptied each image and captures without a budget, unless it is frozen', () => {
  const recapture = { surfaceCacheRecaptureEveryFrame: true }
  assert.equal(maxTileCapturesPerFrame({ ...defaults, ...recapture }), INT32_MAX)
  assert.equal(maxTileCapturesPerFrame({ ...defaults, ...recapture, surfaceCacheFreeze: true }), 0)
  // The first image makes the atlas, which starts its textures either way; the next ones are emptied only when recaptured.
  const again = (changes: Partial<typeof defaults>) => {
    const settings = { ...defaults, ...changes }
    const { cache } = updated(changes)
    return updateSurfaceCache(cache, settings, {
      origins: [[0, 0, 0]],
      orthographic: false,
      clipmapExtent: 100000,
    })
  }
  assert.equal(again({}).reset, false)
  assert.equal(again(recapture).reset, true)
})

test('a fixed debugging resolution gives every card that many texels, whatever its distance, up to the greatest resolution', () => {
  const level = (changes: Partial<typeof defaults>, distance: number) =>
    cardResLevel(distance, 100, 1, 1, cardLimits({ ...defaults, ...changes }, false, 100000))
  assert.equal(level({}, 5000), 3, 'by the law: two texels, the least resolution')
  assert.equal(level({ surfaceCacheCardFixedDebugResolution: 256 }, 5000), 8)
  assert.equal(
    level({ surfaceCacheCardFixedDebugResolution: 256 }, 50000),
    8,
    'whatever the distance',
  )
  assert.equal(
    level({ surfaceCacheCardFixedDebugResolution: 4096 }, 5000),
    9,
    'held to the greatest resolution, 512',
  )
})

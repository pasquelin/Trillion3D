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

test('a placement that wants cards is counted in the scene add operations, with its id', () => {
  const { cache } = updated({})
  assert.deepEqual(Array.from(cache.stats.addOps.slice(0, 3)), [1, 0, 0])
  assert.equal(cache.stats.removeOps[0], 0)
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

test('the debugging reset, the pre-exposure of the cards’ light and the forced eviction act on the image they are asked in', () => {
  assert.equal(defaults.surfaceCacheReset, false)
  assert.equal(defaults.surfaceCacheResetEveryNthFrame, 0)
  assert.equal(defaults.surfaceCacheForceEvictHiResPages, false)
  const view = {
    origins: [[0, 0, 0]] as [number, number, number][],
    orthographic: false,
    clipmapExtent: 100000,
  }
  const { cache } = updated({})
  // The first image made the atlas under the pre-exposure it was given (none: 0); the next one is not reset unless asked.
  assert.equal(updateSurfaceCache(cache, defaults, view).reset, false)
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, reset: true }).reset, true)
  const evicted = updateSurfaceCache(cache, defaults, { ...view, forceEvictHiResPages: true })
  assert.equal(evicted.reset, false)
  // A pre-exposure other than the one the cards were captured under makes the atlas again and empties it, once.
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, preExposure: 2 }).reset, true)
  assert.equal(cache.preExposure, 2)
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, preExposure: 2 }).reset, false)
})

test('the format the atlas stores its light in makes the atlas again and empties it, once, as the pre-exposure does', () => {
  const view = {
    origins: [[0, 0, 0]] as [number, number, number][],
    orthographic: false,
    clipmapExtent: 100000,
  }
  const { cache } = updated({})
  // The first image made the atlas in the format it was given; an image that names none keeps it.
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, light: 'r32uint' }).reset, true)
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, light: 'r32uint' }).reset, false)
  assert.equal(updateSurfaceCache(cache, defaults, view).reset, false)
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, light: 'rgba16float' }).reset, true)
  assert.equal(cache.light, 'rgba16float')
  assert.equal(updateSurfaceCache(cache, defaults, { ...view, light: 'rgba16float' }).reset, false)
})

test('the sun’s shadow on the cards is traced through the meshes’ fields by default, from two centimetres off the texel', () => {
  assert.equal(defaults.surfaceCacheDirectLightingOffscreenShadowingTraceMeshSdfs, true)
  assert.equal(defaults.surfaceCacheDirectLightingMeshSdfShadowRayBias, 2)
})

test('the stochastic direct light is off, with one sample a texel, blended over 12 images', () => {
  assert.equal(defaults.surfaceCacheDirectLightingStochastic, false)
  assert.equal(defaults.surfaceCacheDirectLightingStochasticTemporal, true)
  assert.equal(defaults.surfaceCacheDirectLightingStochasticTemporalMaxFramesAccumulated, 12)
  assert.equal(defaults.surfaceCacheDirectLightingStochasticTemporalNeighborhoodClampScale, 2)
  assert.equal(defaults.surfaceCacheDirectLightingStochasticSamplePerTexel, 1)
  assert.equal(defaults.surfaceCacheDirectLightingStochasticMinWeight, 0.001)
})

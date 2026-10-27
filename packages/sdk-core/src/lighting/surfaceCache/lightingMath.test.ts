import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../contracts/surfaceCacheOptions.ts'
import { resolveSettingsInto, type SettingValues } from '../../contracts/settingRules.ts'
import {
  hemisphereResolution,
  lightsPerTile,
  litTiles,
  probeSpacing,
  surfaceCacheFrozen,
  updateFrameFrozen,
  updateTilesOf,
} from './lightingMath.ts'
import {
  cullLights,
  decodeAlbedo,
  finalLighting,
  lightSampleKey,
  pageTiles,
  planUpdate,
  priorityBucket,
  probeJitter,
  selectMaxUpdateBucket,
  shadowRayBias,
  updateSpeedOf,
} from './lightingOracle.fixture.ts'

const near = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`)

const defaults = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, defaults)
/** The tiles each update lights of a `side` atlas under the defaults changed by `changes`. */
const tilesOf = (side: number, changes: Partial<typeof defaults> = {}) =>
  updateTilesOf({ ...defaults, ...changes }, side)

test('an update lights the atlas over its factor, in whole tiles, a page at least', () => {
  // 4096 / sqrt(32) = 724.1, plus a half texel, 724 whole texels, up to 728 along a side; the radiosity over 64, 512.5 cut to 512.
  assert.deepEqual(tilesOf(4096), { direct: (728 / 8) ** 2, indirect: (512 / 8) ** 2 })
  // The half is cut, not rounded up to a tile: 3584 / 8 + 0.5 = 448.5 lights 448 texels, 56 tiles a side, not 57.
  assert.equal(tilesOf(3584, { surfaceCacheDirectLightingUpdateFactor: 64 }).direct, 56 ** 2)
  // The speed divides the factor; a full update takes the whole atlas; a small atlas still lights a page.
  assert.equal(
    tilesOf(4096, { surfaceCacheLightingUpdateSpeed: 2 }).direct,
    tilesOf(4096, { surfaceCacheDirectLightingUpdateFactor: 16 }).direct,
  )
  // A full update: 4096.5 cut to the 4096 texels of the atlas, 512 tiles a side.
  assert.equal(tilesOf(4096, { surfaceCacheLightingForceFullUpdate: true }).direct, 512 ** 2)
  assert.equal(tilesOf(256, { surfaceCacheDirectLightingUpdateFactor: 1024 }).direct, 16 * 16)
  assert.equal(pageTiles(128, 128), 256)
  assert.equal(pageTiles(8, 16), 2)
})

test('a page is in the bucket 15 less the log2 of its wait, cut to a whole number', () => {
  assert.equal(priorityBucket(10, 9, 1), 13) // 4 · 1 · 1 = 2^2
  assert.equal(priorityBucket(10, 7, 1), 11) // 4 · 3 = 12: log2 3.58, 15 - 3.58 = 11.4
  assert.equal(priorityBucket(10, 0, 1), 2) // never lit: 2048 frames, 2^13
  assert.equal(priorityBucket(10, 0, 0.5), 3)
  // A page far away and just lit never leaves the lowest priority; an enormous wait stops at bucket 0.
  assert.equal(priorityBucket(10, 9, updateSpeedOf(5000, 2500, false)), 14)
  assert.equal(priorityBucket(10, 9, updateSpeedOf(50000, 2500, false)), 15)
  assert.equal(priorityBucket(1e9, 1, 1), 0)
})

test('the update speed falls with the distance in first clipmaps and doubles near the frustum', () => {
  near(updateSpeedOf(0, 2500, false), 1)
  near(updateSpeedOf(2500, 2500, false), 0.5)
  near(updateSpeedOf(2500, 2500, true), 1)
  near(updateSpeedOf(-10, 2500, false), 1)
})

test('the cut is the bucket whose tiles reach the budget, with the tiles of it that fit', () => {
  const histogram = new Array(16).fill(0)
  histogram[5] = 10
  histogram[6] = 20
  histogram[9] = 100
  assert.deepEqual(selectMaxUpdateBucket(histogram, 25), { bucket: 6, tiles: 15 })
  assert.deepEqual(selectMaxUpdateBucket(histogram, 10), { bucket: 5, tiles: 10 })
  // A budget the whole histogram never reaches takes every bucket.
  assert.deepEqual(selectMaxUpdateBucket(histogram, 1000), { bucket: 16, tiles: 1000 })
})

test('pages are listed up to the cut while their tiles fit, and one that does not fit closes the list', () => {
  const pages = [
    { bucket: 2, tiles: 16 },
    { bucket: 6, tiles: 16 },
    { bucket: 6, tiles: 16 },
    { bucket: 7, tiles: 1 },
    { bucket: 6, tiles: 4 },
  ]
  // The cut is bucket 6 with room for 20 of its tiles: the first of its pages fits, the second does not, and the
  // last — counted after the second — does not either.
  const planned = planUpdate(pages, { bucket: 6, tiles: 20 }, 64)
  assert.deepEqual(planned.listed, [true, true, false, false, false])
  assert.equal(planned.tiles, 32)
  // The budget in all closes the list in the same way.
  const tight = planUpdate(pages, { bucket: 7, tiles: 1 }, 20)
  assert.deepEqual(tight.listed, [true, false, false, false, false])
})

test('a tile keeps at most its cap of lights, the heaviest, the later one of two of a weight', () => {
  const lights = [
    { index: 0, weight: 0.5 },
    { index: 1, weight: 4 },
    { index: 2, weight: 2 },
    { index: 3, weight: 2 },
    { index: 4, weight: 0 },
    { index: 5, weight: 3 },
  ]
  assert.deepEqual(cullLights(lights, 3), [1, 5, 3])
  // A light of no weight is kept past the others, but for the first, whose key is none.
  assert.deepEqual(cullLights(lights, 8), [1, 5, 3, 2, 0, 4])
  assert.deepEqual(cullLights([{ index: 0, weight: 0 }], 8), [])
  assert.ok(lightSampleKey(2, 1) > lightSampleKey(1.5, 16383))
  assert.equal(lightSampleKey(0, 0), 0)
  assert.deepEqual([1, 3, 8, 9, 100].map(lightsPerTile), [1, 4, 8, 16, 32])
})

test('the shadow ray starts a voxel off the texel, three where it turns from the light', () => {
  near(shadowRayBias(1, 1), 1)
  near(shadowRayBias(0.5, 1), 2)
  near(shadowRayBias(0, 1), 3)
  near(shadowRayBias(-1, 1), 3)
  near(shadowRayBias(0, 0), 0)
})

test('the probes follow the quality: their spacing halves from 6, their hemisphere grows with its square root', () => {
  assert.equal(probeSpacing(4, 1), 4)
  assert.equal(probeSpacing(4, 6), 2)
  assert.equal(probeSpacing(3, 1), 4)
  assert.equal(probeSpacing(100, 1), 8)
  assert.equal(hemisphereResolution(4, 1), 4)
  assert.equal(hemisphereResolution(4, 4), 8)
  assert.equal(hemisphereResolution(4, 6), 8)
  assert.equal(hemisphereResolution(4, 0.5), 2)
  assert.equal(hemisphereResolution(16, 4), 16)
})

test('the jitter of a page walks its pattern, a point a texel in the spacing, and a fixed index holds it', () => {
  const seen = new Set<string>()
  for (let image = 0; image < 4; image++) {
    const [x, y] = probeJitter(image, 4, 4)
    assert.ok(x >= 0 && x < 4 && y >= 0 && y < 4)
    seen.add(`${x},${y}`)
    assert.deepEqual(probeJitter(image + 4, 4, 4), [x, y])
  }
  assert.equal(seen.size, 4)
  assert.deepEqual(probeJitter(3, 4, 4, 1), probeJitter(1, 4, 4))
})

test('a boost under one raises the luminance of the albedo, never to one', () => {
  near(decodeAlbedo([0.5, 0.5, 0.5], 1)[0], 0.25)
  const lifted = decodeAlbedo([0.5, 0.5, 0.5], 0.5)
  assert.ok(lifted[0] > 0.25 && lifted[0] < 0.99)
  near(decodeAlbedo([1, 1, 1], 0.5)[0], 0.99)
})

test('a floor lit by a sun of illuminance E at the cosine c reflects its albedo times E c over π', () => {
  const albedo = 0.5
  const stored = [Math.sqrt(albedo), Math.sqrt(albedo), Math.sqrt(albedo)]
  const illuminance = 3,
    cosine = Math.cos(Math.PI / 3)
  const direct = [illuminance * cosine, illuminance * cosine, illuminance * cosine]
  const lit = finalLighting(stored, 1, [0, 0, 0], direct, [0, 0, 0])
  lit.forEach((c) => near(c, (albedo * illuminance * cosine) / Math.PI, 1e-12))
})

test('in a closed furnace of albedo ρ and emission e the light settles at e / (1 - ρ)', () => {
  const rho = 0.5,
    emission = 0.4
  const stored = [Math.sqrt(rho), Math.sqrt(rho), Math.sqrt(rho)]
  let light = [0, 0, 0]
  for (let bounce = 0; bounce < 80; bounce++) {
    // Every other surface sees the whole furnace at this light, so a texel's irradiance is π times it.
    const indirect = light.map((c) => Math.PI * c)
    light = finalLighting(stored, 1, [emission, emission, emission], [0, 0, 0], indirect)
  }
  light.forEach((c) => near(c, emission / (1 - rho), 1e-9))
})

test('a light that is not a number, or under zero, is kept at zero', () => {
  const stored = [0.5, 0.5, 0.5]
  assert.deepEqual(finalLighting(stored, 1, [0, 0, 0], [NaN, 1, -50], [0, 0, 0]), [
    0,
    0.25 / Math.PI,
    0,
  ])
})

test('a frozen cache lights no tile and holds its clock, its lists keeping their size; a frozen update frame holds the clock alone', () => {
  const frozen = { ...defaults, surfaceCacheFreeze: true }
  assert.equal(defaults.surfaceCacheFreeze, false)
  assert.equal(surfaceCacheFrozen(defaults), false)
  assert.equal(surfaceCacheFrozen(frozen), true)
  // The lists are made at the size of an unfrozen update, so that freezing leaves them as they are.
  assert.deepEqual(updateTilesOf(frozen, 4096), updateTilesOf(defaults, 4096))
  const { direct, indirect } = updateTilesOf(frozen, 4096)
  assert.deepEqual([litTiles(frozen, direct), litTiles(frozen, indirect)], [0, 0])
  assert.deepEqual([litTiles(defaults, direct), litTiles(defaults, indirect)], [direct, indirect])
  assert.equal(updateFrameFrozen(defaults), false)
  assert.equal(updateFrameFrozen(frozen), true)
  const frameFrozen = { ...defaults, surfaceCacheFreezeUpdateFrame: 1 }
  assert.equal(updateFrameFrozen(frameFrozen), true)
  assert.equal(litTiles(frameFrozen, direct), direct)
})

// The sun's clipmap as the clipmap builds it: levels
// 6 to 22, level L of radius 2^(L+1) cm, each centre snapped to its own radius in light space, and
// a level's cached pages kept while the camera's depth along the light stays within 0.9 of its
// depth range (a Z range scale of 1000 radii).
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_MAP_COARSE, VSM_MAP_COARSE_KEEPS_DYNAMIC, VSM_SUN_DEPTH_KEEP } from './constants.ts'
import { createVsmClipmap, type VsmClipmap, type VsmViewport } from './clipmap.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { SUN, PROJECTION, VIEW, frame, mapsOf } from './clipmap.fixture.ts'

test('the levels: 6 to 22, a radius of 2^(L+1) cm, a depth range of 1000 radii', () => {
  const clipmap = frame(new VsmCacheManager(), [0, 0, 0])
  assert.deepEqual([clipmap.firstLevel, clipmap.levels.length], [6, 17])
  const depthRadius = ({ clipmap }: { clipmap: { depthRadius: number } }) => clipmap.depthRadius
  assert.deepEqual(clipmap.cacheEntry.mapCaches.slice(0, 2).map(depthRadius), [128e3, 256e3])
  assert.equal(VSM_SUN_DEPTH_KEEP, 0.9)
})

test("the sun's bias at rest and moving is -1.5, a local light's 0 and 1", () => {
  const { shadows } = { shadows: VSM_DEFAULT_SHADOWS }
  assert.deepEqual(
    [
      ...[
        shadows.shadowResolutionLodBiasDirectional,
        shadows.shadowResolutionLodBiasDirectionalMoving,
      ],
      ...[shadows.shadowResolutionLodBiasLocal, shadows.shadowResolutionLodBiasLocalMoving],
    ],
    [-1.5, -1.5, 0, 1],
  )
  assert.equal(
    frame(new VsmCacheManager(), [0, 0, 0]).levelBias,
    1.5,
    'the screen term 3, less 1.5',
  )
})

test('the settings shape the sun clipmap: its levels, depth range and coarse pages', () => {
  const shaped = mapsOf({
    ...{ shadowClipmapFirstLevel: 8, shadowClipmapLastLevel: 20, shadowClipmapZRangeScale: 500 },
    ...{ shadowClipmapFirstCoarseLevel: 10, shadowClipmapLastCoarseLevel: 12 },
    shadowMarkCoarsePagesDirectional: 1,
  })
  const clipmap = frame(new VsmCacheManager(), [0, 0, 0], 1024, shaped)
  assert.deepEqual([clipmap.firstLevel, clipmap.levels.length], [8, 13])
  const maps = clipmap.cacheEntry.mapCaches
  assert.equal(maps[0].clipmap.depthRadius, 2 ** 9 * 500, 'the scale on the radius')
  const marks = (map: (typeof maps)[number], flag: number) => !!(map.projectionData.flags & flag)
  const coarse = maps.map((map) => marks(map, VSM_MAP_COARSE))
  assert.deepEqual(
    coarse.map((on, k) => on && 8 + k),
    [false, false, 10, 11, 12, false, false, false, false, false, false, false, 20],
    'the levels 10 to 12 and the last',
  )
  assert.ok(!maps.some((map) => marks(map, VSM_MAP_COARSE_KEEPS_DYNAMIC)), 'mode 1: no keeping')
  // Mode 2 keeps the coarse pages' dynamic layer; mode 0 marks no coarse page, the last included.
  const keeps = (mode: 0 | 2) =>
    frame(
      new VsmCacheManager(),
      [0, 0, 0],
      1024,
      mapsOf({ shadowMarkCoarsePagesDirectional: mode }),
    ).cacheEntry.mapCaches.map((map) => [
      marks(map, VSM_MAP_COARSE),
      marks(map, VSM_MAP_COARSE_KEEPS_DYNAMIC),
    ])
  assert.ok(keeps(2).every(([, keeping]) => keeping))
  assert.ok(keeps(0).every(([coarsePage, keeping]) => !coarsePage && !keeping))
})

test('a moving sun reads the moving bias, back to its own over the active frames', () => {
  const cache = new VsmCacheManager(),
    eye = [0, 0, 0]
  const bias = (frameNumber: number, light = SUN) => {
    const maps = mapsOf(
      { shadowResolutionLodBiasDirectional: 0, shadowResolutionLodBiasDirectionalMoving: 2 },
      frameNumber,
    )
    const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye }
    return createVsmClipmap(cache, light, camera, { width: 1024, height: 1024 }, maps).levelBias
  }
  // The screen term is 3. Made at frame 0, the sun moves: 2 more, falling to 0 in ten frames.
  assert.deepEqual(
    [0, 5, 9, 10, 20].map((f) => bias(f)),
    [5, 4, Math.fround(3.2), 3, 3],
  )
  const turned = { ...SUN, direction: [0.1, -0.9, 0.2] }
  assert.equal(bias(21, turned), 5, 'turned: moving again')
  assert.equal(bias(26, turned), 4, 'half way back')
})

test("the clipmap's bias is max(0, -1.5 + the screen term)", () => {
  // Screen term: log2(0.5 / p[0] · 16384 / width), p[0] = 1 at 90°.
  for (const width of [256, 1024, 1728, 2048, 2900, 3456, 4096, 16384]) {
    const clipmap = createVsmClipmap(
      new VsmCacheManager(),
      SUN,
      { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
      { width, height: width },
    )
    const expected = Math.max(0, -1.5 + Math.log2((0.5 * 16384) / width))
    assert.ok(
      Math.abs(clipmap.levelBias - expected) < 1e-6,
      `width ${width}: ${clipmap.levelBias} against ${expected}`,
    )
  }
  // The clamp holds the wide screens: 4096 px would ask -0.5, 3456 px about -0.25.
  assert.equal(frame(new VsmCacheManager(), [0, 0, 0], 4096).levelBias, 0)
  assert.equal(frame(new VsmCacheManager(), [0, 0, 0], 3456).levelBias, 0)
})

test("a frame drawn below the display keeps the display's clipmap: levels, bias and projection data", () => {
  const eye = [3.7, 1.2, -8.4]
  const build = (viewport: VsmViewport) =>
    createVsmClipmap(
      new VsmCacheManager(),
      SUN,
      { view: VIEW, projection: PROJECTION, perspective: true, eye },
      viewport,
    )
  const projectionData = (clipmap: VsmClipmap) =>
    clipmap.cacheEntry.mapCaches.map((entry) => entry.projectionData)
  // 1024 px: bias 1.5; 3456 px: the screen term is under 1.5, the clamp holds the bias at 0.
  for (const [width, height] of [
    [1024, 768],
    [3456, 2234],
  ]) {
    const display = build({ width, height })
    const half = build({ width: width / 2, height: height / 2, minScreenWidth: width })
    assert.equal(half.levelBias, display.levelBias, `${width} px: bias`)
    assert.equal(half.firstLevel, display.firstLevel)
    assert.deepEqual(half.levels, display.levels, `${width} px: levels`)
    assert.deepEqual(projectionData(half), projectionData(display), `${width} px: projection`)
    // Without the floor, half the width reads one level coarser (up to the clamp).
    const unfloored = build({ width: width / 2, height: height / 2 }).levelBias
    assert.ok(unfloored > display.levelBias, `${width} px: ${unfloored} unfloored`)
    // A floor under the drawn width changes nothing.
    const under = build({ width, height, minScreenWidth: width / 2 })
    assert.deepEqual(projectionData(under), projectionData(display))
  }
})

test("the display's floor is the sun's alone: a local light keeps the drawn size", () => {
  const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] }
  const drawn = { width: 512, height: 384 },
    floored = { ...drawn, minScreenWidth: 1024 },
    display = { width: 1024, height: 768 }
  assert.deepEqual(vsmLocalViewData(camera, floored), vsmLocalViewData(camera, drawn))
  const spot = {
    id: 'spot',
    kind: 'spot' as const,
    position: [0, 3, -20],
    direction: [0, -1, 0],
    range: 6,
    coneAngle: 0.6,
  }
  // A light just made reads its moving bias; the floor is judged at the bias it rests at.
  const still = mapsOf({ shadowResolutionLodBiasLocalMoving: 0 })
  const setup = (viewport: VsmViewport) =>
    addVsmLocalLightShadow(new VsmCacheManager(), spot, [vsmLocalViewData(camera, viewport)], still)
  const data = (viewport: VsmViewport) => {
    const s = setup(viewport)
    return [s.finestMip, s.cacheEntry.mapCaches.map((entry) => entry.projectionData)]
  }
  assert.deepEqual(data(floored), data(drawn))
  // The display's size would have sharpened this spot: the floor must not reach it.
  assert.ok(setup(display).finestMip < setup(drawn).finestMip)
})

test("a local light reads the moving bias as the sun does, and marks its last mip's page by the mode", () => {
  const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] }
  const views = [vsmLocalViewData(camera, { width: 1024, height: 768 })]
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 6, coneAngle: 0.6 },
  }
  const cache = new VsmCacheManager()
  const mip = (frameNumber: number, changes = {}) =>
    addVsmLocalLightShadow(cache, spot, views, mapsOf(changes, frameNumber)).finestMip
  const moving = { shadowResolutionLodBiasLocal: 0, shadowResolutionLodBiasLocalMoving: 3 }
  const [made, half, rest] = [mip(0, moving), mip(5, moving), mip(10, moving)]
  assert.ok(
    made > rest && made >= half && half >= rest,
    `${made}, ${half}, ${rest}: coarser while it moves`,
  )
  assert.equal(rest, mip(11, { shadowResolutionLodBiasLocalMoving: 0 }), 'at rest: its own bias')
  const flags = (mode: 0 | 1 | 2) =>
    addVsmLocalLightShadow(
      new VsmCacheManager(),
      spot,
      views,
      mapsOf({ shadowMarkCoarsePagesLocal: mode }),
    ).cacheEntry.mapCaches[0].projectionData.flags
  assert.deepEqual(
    [0, 1, 2].map((mode) => [
      !!(flags(mode as 0) & VSM_MAP_COARSE),
      !!(flags(mode as 0) & VSM_MAP_COARSE_KEEPS_DYNAMIC),
    ]),
    [
      [false, false],
      [true, false],
      [true, true],
    ],
  )
})

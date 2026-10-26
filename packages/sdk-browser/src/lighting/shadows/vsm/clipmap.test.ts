// The sun's clipmap as the clipmap builds it: levels
// 6 to 22, level L of radius 2^(L+1) cm, each centre snapped to its own radius in light space, and
// a level's cached pages kept while the camera's depth along the light stays within 0.9 of its
// depth range (a Z range scale of 1000 radii).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_MAP_COARSE,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_NEXT_KEEPS_PAGES,
  VSM_SUN_DEPTH_KEEP,
  vsmLocalMipLevel,
} from './constants.ts'
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
  const moves = { ...SUN, movable: true }
  const bias = (frameNumber: number, light = moves) => {
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
  const turned = { ...moves, direction: [0.1, -0.9, 0.2] }
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

test('the screen term reads the drawn width, floored by the setting (0 floors nothing)', () => {
  const eye = [0, 0, 0]
  const biasAt = (width: number, minScreenWidth: number) =>
    createVsmClipmap(
      new VsmCacheManager(),
      SUN,
      { view: VIEW, projection: PROJECTION, perspective: true, eye },
      { width, height: width, minScreenWidth },
    ).levelBias
  // log2(0.5 / P00 * 16384 / width) less the sun's resolution bias of 1.5 (P00 = 1 here).
  const expected = (width: number) => Math.max(0, -1.5 + Math.log2((0.5 * 16384) / width))
  assert.ok(Math.abs(biasAt(512, 0) - expected(512)) < 1e-6, 'floor 0: the drawn 512')
  assert.ok(Math.abs(biasAt(512, 1024) - expected(1024)) < 1e-6, 'floor 1024: that of 1024')
  assert.ok(Math.abs(biasAt(2048, 1024) - expected(2048)) < 1e-6, 'a floor under the drawn width')
})

test("a frame drawn below the floor keeps the floor's clipmap: levels, bias and projection data", () => {
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

test("the width floor is the sun's alone: a local light keeps the drawn size", () => {
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
    outerCone: 0.601,
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
    ...{ range: 6, outerCone: 0.601, movable: true },
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
      mapsOf({ shadowMarkCoarsePagesLocal: mode, shadowDistantLightMode: 0 }),
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

test('a movable local light is moving when its pose changes, not its shape', () => {
  const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] }
  const views = [vsmLocalViewData(camera, { width: 1024, height: 768 })]
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 6, outerCone: 0.601, movable: true },
  }
  const cache = new VsmCacheManager()
  const moving = { shadowResolutionLodBiasLocal: 0, shadowResolutionLodBiasLocalMoving: 3 }
  const biasAt = (frameNumber: number, light: typeof spot) =>
    addVsmLocalLightShadow(cache, light, views, mapsOf(moving, frameNumber)).cacheEntry.mapCaches[0]
      .projectionData.levelBias
  assert.equal(biasAt(0, spot), 3, 'made: moving')
  assert.equal(biasAt(20, spot), 0, 'at rest')
  assert.equal(biasAt(21, { ...spot, range: 8 }), 0, 'a new range keeps it at rest')
  assert.equal(biasAt(22, { ...spot, range: 8, outerCone: 0.9 }), 0, 'a new cone too')
  assert.equal(biasAt(23, { ...spot, range: 8, outerCone: 0.9, position: [1, 3, -20] }), 3)
})

test('a local light’s finest mip takes the mip mode: all, the even ones, the odd ones', () => {
  // Footprints of 4.5, 9 and 200 texels: floors of log2 of 2, 3 and 7.
  const mips = (mode: number) =>
    [4.5, 9, 200].map((footprint) => vsmLocalMipLevel(footprint, 0, 0, 0, mode))
  assert.deepEqual(mips(0), [2, 3, 7])
  assert.deepEqual(mips(1), [2, 2, 6])
  assert.deepEqual(mips(2), [3, 3, 7])
})

// An object that names a distance past which its offset stops is moved in the levels whose threshold
// (`wpoThreshold`, the square of the distance in map units) it does not pass: it grows four times for a
// level, the bias holds it back by whole levels, and the setting off leaves no threshold.
test('each level of the sun’s clipmap says the distance past which it shows no motion, the setting and its bias moving it', () => {
  const thresholds = (changes: Parameters<typeof mapsOf>[0] = {}) =>
    frame(new VsmCacheManager(), [0, 0, 0], 1024, mapsOf(changes)).cacheEntry.mapCaches.map(
      (map) => map.projectionData.wpoThreshold,
    )
  const held = thresholds()
  assert.ok(held.every((value) => value > 0))
  for (let level = 1; level < held.length; level++)
    assert.equal(held[level] / held[level - 1], 4, `level ${level}: twice the distance, squared`)
  const lowered = thresholds({ shadowClipmapWpoDisableDistanceLodBias: 0 })
  assert.equal(
    lowered[0] / held[0],
    2 ** 6,
    'the bias of 3 holds it back by three levels (a distance 8×)',
  )
  assert.ok(thresholds({ shadowClipmapWpoDisableDistance: false }).every((value) => value === 0))
})

// The threshold counts the clipmap's whole resolution bias: the sun's at rest, -1.5, plus the screen's
// term, log2 of the level-0 texels a pixel spans (8192 over the width, for this 90° view).
test('a level’s offset threshold is two to twice its level less the bias and the clipmap’s resolution bias, which follows the view’s width', () => {
  const thresholds = (width: number) => {
    const clipmap = frame(new VsmCacheManager(), [0, 0, 0], width)
    const bias = -1.5 + Math.log2(8192 / width)
    assert.ok(Math.abs(clipmap.levelBias - bias) < 1e-5, `width ${width}: the bias is ${bias}`)
    return clipmap.cacheEntry.mapCaches.map(({ projectionData }, i) => {
      const level = clipmap.firstLevel + i,
        expected = 2 ** (2 * Math.ceil(level - 3 - bias)) / 1e4
      assert.ok(Math.abs(projectionData.wpoThreshold / expected - 1) < 1e-6, `level ${level}`)
      return projectionData.wpoThreshold
    })
  }
  const narrow = thresholds(1024),
    wide = thresholds(2048)
  assert.equal(wide[0] / narrow[0], 4, 'a view twice as wide: the level shifts by one')
})

test('a shift of the offset threshold redraws a cached level only where the setting asks it', () => {
  const kept = (invalidates: boolean, width: number) => {
    const cache = new VsmCacheManager(),
      maps = mapsOf({ shadowClipmapWpoDisableDistanceInvalidateOnScaleChange: invalidates })
    for (let n = 0; n < 2; n++) {
      cache.frameStamp = n
      frame(cache, [0, 0, 0], 1024, maps).cacheEntry.markRendered(n)
    }
    cache.frameStamp = 2
    return frame(cache, [0, 0, 0], width, maps).cacheEntry.mapCaches[0].nextMaps.flags
  }
  assert.equal(kept(false, 2048), VSM_NEXT_KEEPS_PAGES, 'off: kept')
  assert.equal(kept(true, 2048), 0, 'on: the threshold shifted, drawn again')
  assert.equal(kept(true, 1024), VSM_NEXT_KEEPS_PAGES, 'on, the threshold the same: kept')
})

// The sun's clipmap frame by frame (`clipmap.test.ts` holds its levels and bias): every level built,
// each centre snapped to its own radius, a cached level's pages panned with the camera, and its
// depth range kept until 0.9 of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_NEXT_KEEPS_PAGES,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_COARSE,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
} from './constants.ts'
import { createVsmClipmap, type VsmClipmap } from './clipmap.ts'
import { casterDrawDistance, farDropOf } from './frame/vsmFarShadow.ts'
import type { VsmBoundLight } from './mapViews.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { transformAffinePoint } from '../../../../../math/src/vector/vector.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { VsmMapCache, VsmLightCache } from './lightCache.ts'
import {
  SUN,
  PROJECTION,
  VIEW,
  LEVELS,
  frame,
  lightSpace,
  lightAxis,
  along,
  cachedClipmap,
} from './clipmap.fixture.ts'

test('a frame builds every level, its LOD bias from the screen, its data packed level by level', () => {
  const cache = new VsmCacheManager()
  const clipmap = frame(cache, [0, 0, 0])
  assert.equal(clipmap.levels.length, LEVELS)
  assert.equal(clipmap.firstLevel, 6)
  // 0.5 / p[0] · 16384 / width = 8 on 1024 pixels at 90°: log2 8 = 3, plus the sun's -1.5.
  assert.equal(clipmap.levelBias, 1.5)
  assert.equal(frame(new VsmCacheManager(), [0, 0, 0], 16384).levelBias, 0, 'never below 0')
  clipmap.cacheEntry.mapCaches.forEach(({ projectionData }, index) => {
    const level = 6 + index
    assert.deepEqual([projectionData.mapLevel, projectionData.levelsLeft], [level, LEVELS - index])
    const coarse = (level >= 15 && level <= 18) || level === 22
    assert.equal(!!(projectionData.flags & VSM_MAP_COARSE), coarse, `level ${level}`)
    assert.ok(projectionData.flags & VSM_MAP_COVERAGE)
    assert.ok(projectionData.flags & VSM_MAP_COARSE_KEEPS_DYNAMIC)
    assert.ok(projectionData.flags & VSM_MAP_UNCACHED, 'a new light renders uncached')
    assert.deepEqual(
      Array.from(projectionData.lightDirection),
      clipmap.lightDirection.map((v) => -v),
    )
  })
})

test("each level's centre snaps to its own radius across the light; a coarser one stays put", () => {
  const eye = [3.7, 1.2, -8.4]
  const clipmap = frame(new VsmCacheManager(), eye)
  clipmap.levels.forEach((level, index) => {
    const centre = lightSpace(clipmap, level.worldCentre),
      snap = 2 ** (7 + index), // the radius, 2^(L+1) cm, of level L = 6 + index
      camera = lightSpace(clipmap, eye)
    for (const axis of [0, 1]) {
      const cells = centre[axis] / snap
      assert.ok(
        Math.abs(cells - Math.round(cells)) < 1e-6,
        `level ${6 + index} axis ${axis}: whole snaps`,
      )
      assert.ok(
        Math.abs(centre[axis] - camera[axis]) <= snap / 2 + 1e-6,
        'within half a snap of the eye',
      )
    }
    assert.ok(Math.abs(centre[2] - camera[2]) < 1e-6, 'along the light, the eye itself')
  })
  // One metre across the light: level 6 (1.28 m snaps) moves one snap, level 7 (2.56 m) does not.
  const x = lightAxis(clipmap, 0)
  const start = frame(new VsmCacheManager(), [0, 0, 0])
  const moved = frame(new VsmCacheManager(), along([0, 0, 0], x, 1))
  assert.deepEqual(
    [
      moved.levels[0].cornerQuarters[0] - start.levels[0].cornerQuarters[0],
      moved.levels[1].cornerQuarters,
    ],
    [-1, start.levels[1].cornerQuarters],
  )
})

test("a cached level's pages pan with the camera: page offset in whole radii of 32 pages", () => {
  const cache = new VsmCacheManager()
  cachedClipmap(cache, [0, 0, 0])
  const x = lightAxis(frame(new VsmCacheManager(), [0, 0, 0]), 0)
  const clipmap = frame(cache, along([0, 0, 0], x, 1))
  const [level6, level7] = clipmap.cacheEntry.mapCaches
  assert.equal(level6.nextMaps.flags, VSM_NEXT_KEEPS_PAGES)
  assert.deepEqual(level6.nextMaps.pageShift, [-32, 0], 'one radius: 32 pages')
  assert.deepEqual(
    [level7.nextMaps.flags, level7.nextMaps.pageShift],
    [VSM_NEXT_KEEPS_PAGES, [0, 0]],
  )
  assert.equal(level6.projectionData.flags & VSM_MAP_UNCACHED, 0)
})

test('along the light, a cached level keeps its depth range until 0.9 of it; past it, it is rebased', () => {
  const cache = new VsmCacheManager()
  cachedClipmap(cache, [0, 0, 0])
  const probe = frame(new VsmCacheManager(), [0, 0, 0])
  const z = lightAxis(probe, 2)
  const startZ = cache.entries
    .values()
    .next()
    .value!.mapCaches.map((m) => m.clipmap.depthCentre)
  // Level 6 holds |ΔZ| + 128 cm <= 0.9 · 128 000 cm: 1149.44 m kept, 1151 m rebased.
  const kept = frame(cache, along([0, 0, 0], z, 1149))
  const level6 = kept.cacheEntry.mapCaches[0]
  assert.equal(level6.nextMaps.flags, VSM_NEXT_KEEPS_PAGES)
  assert.equal(level6.clipmap.depthCentre, startZ[0], 'the cached centre stays')
  assert.equal(level6.clipmap.depthRadius, 128 * 1000)
  // Kept, the depth a point maps to is the cached frame's: the matrix absorbs the eye's move.
  const depth = (clipmap: VsmClipmap, p: number[]) => {
    const level = clipmap.levels[0],
      translated = p.map((v, k) => v - level.worldCentre[k])
    const v = transformAffinePoint(
      new Float64Array(3),
      clipmap.lightViewRotation,
      ...(translated as [number, number, number]),
    )
    return transformAffinePoint(v, level.viewToClip, v[0], v[1], v[2])[2]
  }
  const point = along([0, 0, 0], z, 50)
  const before = frame(new VsmCacheManager(), [0, 0, 0])
  assert.ok(Math.abs(depth(kept, point) - depth(before, point)) < 1e-6)
  kept.cacheEntry.markRendered(2)
  cache.frameStamp = 3
  const rebased = frame(cache, along([0, 0, 0], z, 1151)).cacheEntry.mapCaches
  assert.deepEqual([rebased[0].nextMaps.flags, rebased[0].nextMaps.pageShift], [0, [0, 0]])
  assert.ok(
    Math.abs(rebased[0].clipmap.depthCentre - (startZ[0] + 115100)) < 1e-6,
    'centred on the eye',
  )
  assert.equal(rebased[1].nextMaps.flags, VSM_NEXT_KEEPS_PAGES, 'level 7 has room left')
})

test('the cache rule alone: a radius change or a light never rendered keeps nothing', () => {
  const light = new VsmLightCache('sun', 1),
    level = new VsmMapCache()
  level.updateLevel(light, [64, 64], 128, 0, 128000, 0, false)
  assert.equal(level.nextMaps.flags, 0, 'never rendered')
  light.markRendered(0)
  level.updateLevel(light, [96, 64], 128, 1000, 128000, 0, false)
  assert.deepEqual(
    [level.nextMaps.flags, level.nextMaps.pageShift],
    [VSM_NEXT_KEEPS_PAGES, [32, 0]],
  )
  level.updateLevel(light, [96, 64], 128, 1000, 256000, 0, false)
  assert.equal(level.nextMaps.flags, 0, 'another depth range')
  assert.equal(level.clipmap.depthRadius, 256000)
})

test("a sun's far-shadow distance is in its maps' records, and another distance restages no page", () => {
  const cache = new VsmCacheManager()
  const sun = (farShadowEdge?: number) =>
    createVsmClipmap(
      cache,
      { ...SUN, farShadowEdge },
      { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
      { width: 1024, height: 1024 },
    )
  for (let n = 0; n < 2; n++) {
    cache.frameStamp = n
    sun(400).cacheEntry.markRendered(n)
  }
  cache.frameStamp = 2
  const held = sun(400).cacheEntry.mapCaches.map(({ projectionData: d }) => [
    d.farShadowEdge,
    d.lightRange,
    d.flags,
  ])
  for (const [distance, range, flags] of held)
    assert.deepEqual([distance, range, flags & VSM_MAP_UNCACHED], [400, 0, 0], 'cached, distance')
  const moved = sun(250).cacheEntry.mapCaches.map(({ projectionData: d }) => [
    d.farShadowEdge,
    d.flags,
  ])
  for (const [distance, flags] of moved)
    assert.deepEqual([distance, flags & VSM_MAP_UNCACHED], [250, 0], 'still cached: no restage')
  const none = frame(new VsmCacheManager(), [0, 0, 0]).cacheEntry.mapCaches
  assert.equal(none[0].projectionData.farShadowEdge, 0, 'a light that names none has no limit')
})

test('a frame drops the casters past its greatest far-shadow distance only when every light is a sun that has one', () => {
  const light = (kind: 'directional' | 'point', distance?: number) =>
    ({ kind, clipmap: { light: { farShadowEdge: distance } } }) as unknown as VsmBoundLight
  assert.equal(farDropOf([light('directional', 300), light('directional', 427)]), 427)
  assert.equal(farDropOf([light('directional', 300), light('point')]), 0, 'a lamp takes them all')
  assert.equal(farDropOf([light('directional', 300), light('directional', 0)]), 0, 'a sun of none')
  assert.equal(farDropOf([light('directional')]), 0, 'a sun that names none')
  assert.equal(farDropOf([]), 0, 'no light')
})

test('the casters take the draw distances when the cut holds one, at the view’s scale, the instances’ only while the host did not turn their cull off', () => {
  const session = (context: object) => ({ context }) as unknown as WebgpuPagesRuntime
  const holds = { drawDistances: true },
    none = { drawDistances: false }
  assert.deepEqual(casterDrawDistance(session({}), holds), { scale: 1, instances: true })
  assert.deepEqual(casterDrawDistance(session({ cutViewDistanceScale: 2.5 }), holds), {
    scale: 2.5,
    instances: true,
  })
  // The secondary scale the cut applies, the casters apply too; the field of view's they do not.
  const secondary = { cutViewDistanceApplySecondaryScale: true, cutViewDistanceSecondaryScale: 2 }
  const wide = { cutViewDistanceFovMaxAngleScale: 4, cutViewDistanceFovMinAngleScale: 4 }
  assert.deepEqual(
    casterDrawDistance(session({ cutViewDistanceScale: 2.5, ...secondary, ...wide }), holds),
    { scale: 5, instances: true },
  )
  assert.equal(casterDrawDistance(session({}), none), undefined, 'no placement names one')
  assert.equal(casterDrawDistance(session({}), null), undefined, 'no cut')
  // The host's switch is the instances': an object of its own is still tested.
  assert.deepEqual(casterDrawDistance(session({ cutDrawDistanceCulling: false }), holds), {
    scale: 1,
    instances: false,
  })
})

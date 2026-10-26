// The plan of the local fog volumes of a view (`./fog/localPlan.ts`): the order they are drawn in, the most a
// view draws, what is written of each into the block of the light buffer — none dropped for lying
// outside the view, the culling pass lists them by tile (`fogLocalTiles.test.ts`) —, the view and
// the tiling the block says, and the sky light's rows (`fogLocalRun.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { localFogLimits } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { LOCAL_FOG_FLAG, LOCAL_FOG_INSTANCE, LOCAL_FOG_SLOT } from './fog/localLayout.ts'
import { LOCAL_SKY_PROGRAM } from './fog/localPrograms.ts'
import { localFogTiling } from './fog/localTiling.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { HARMONICS_SET_VECTORS, HARMONICS_SETS } from '../modules/sky/skyLight/layout.ts'
import { DEFAULT_SETTINGS } from './fogVolumeRun.fixture.ts'
import { EYE, VIEW, localSlots, overOf, placed, planSettings } from './fogLocalRun.fixture.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

/** The names of the volumes the plan draws, in the order it draws them: each is told by its distance
 *  from the eye along z, which is how far its slot's centre lies in front of the eye. */
const ids = (volumes: ReturnType<typeof placed>[], maxCount = 32) => {
  const { slots, count } = localSlots(volumes, { settings: planSettings({ maxCount }) })
  const byDepth = new Map(volumes.map((v) => [-(v.matrix as number[])[14] + EYE[2], v.id]))
  return Array.from({ length: count }, (_, k) =>
    byDepth.get(-slots[LOCAL_FOG_SLOT.instances + k * LOCAL_FOG_INSTANCE.slots][2]),
  )
}

test('the order of the volumes: by priority, then by distance, the farther first, then by the order they were added, the earlier over the later; the most a view draws, the last kept', () => {
  const a = placed('a', [0, 2, -30])
  const b = placed('b', [0, 2, -10])
  const c = placed('c', [0, 2, -20])
  assert.deepEqual(ids([b, a, c]), ['a', 'c', 'b'], 'the farther behind')
  // A higher priority is drawn over those of a lower, whatever their distance.
  assert.deepEqual(ids([{ ...a, sortPriority: 3 }, b, c]), ['c', 'b', 'a'])
  assert.deepEqual(ids([{ ...b, sortPriority: -2 }, a, c]), ['b', 'a', 'c'])
  // At the same priority and distance the earlier added is drawn over the later: the engines that fixed
  // the order sort the place in the store down with the rest.
  const twin = placed('twin', [0, 2, 10])
  assert.deepEqual(ids([b, twin]), ['twin', 'b'])
  assert.deepEqual(ids([twin, b]), ['b', 'twin'])
  // A view draws the most it is told, the volumes behind dropped: the nearest and those of the highest priority stay.
  assert.deepEqual(ids([b, a, c], 2), ['c', 'b'])
  assert.deepEqual(ids([{ ...a, sortPriority: 1 }, b, c], 2), ['b', 'a'])
  // A volume of no radial or of no height extinction at all is none: only both zero drops it, the
  // laws' coverages multiplying so that one alone shows nothing, which the volume's own draw finds.
  assert.deepEqual(ids([a, placed('none', [0, 2, -5], { radialDensity: 0, heightDensity: 0 })]), [
    'a',
  ])
})

test('the settings of the volumes are held to the ranges the engines that fixed them hold theirs to', () => {
  const held = (more: object) => localFogLimits({ ...DEFAULT_SETTINGS, ...more })
  assert.deepEqual(held({}), {
    startDistance: 10,
    maxVolumeDensity: 1,
    maxCount: 32,
    tileSize: 128,
  })
  assert.deepEqual(
    held({
      localFogVolumeStartDistance: 0.01,
      localFogVolumeMaxVolumeDensity: -3,
      localFogVolumeMaxCount: 1000,
      localFogVolumeTileSize: 3000,
    }),
    { startDistance: 0.1, maxVolumeDensity: 0, maxCount: 256, tileSize: 512 },
  )
  assert.equal(held({ localFogVolumeMaxCount: 0 }).maxCount, 1)
  assert.equal(held({ localFogVolumeTileSize: 0 }).tileSize, 8)
})

test('what the plan writes: the header, the sun, and each volume relative to the eye with its radius, height axis and numbers', () => {
  // Turned a quarter about x, its height axis (0, 1, 0) lies along (0, 0, 1); scaled 2 by 3 by 1, its radius is 15.
  const turned = [2, 0, 0, 0, 0, 0, 3, 0, 0, -1, 0, 0, 4, 5, -6, 1]
  const volume = {
    id: 'v',
    matrix: turned,
    radialDensity: 0.5,
    heightDensity: 2,
    heightFalloff: 400,
    heightOffset: 0.25,
    scatteringDistribution: 0.3,
    albedo: [0.2, 0.4, 0.6] as [number, number, number],
    emissive: [1, 2, 3] as [number, number, number],
    startDistance: 7,
  }
  const sun = { light: [4, 3, 2], toward: [0, 1, 0] }
  const { slots, count } = localSlots([volume], {
    sun,
    settings: planSettings({ onTranslucent: true, startDistance: 12, maxVolumeDensity: 0.5 }),
  })
  assert.equal(count, 1)
  assert.deepEqual(slots[LOCAL_FOG_SLOT.header], [
    1,
    LOCAL_FOG_FLAG.inVolume | LOCAL_FOG_FLAG.onTranslucent,
    0.5,
    12,
  ])
  assert.deepEqual(slots[LOCAL_FOG_SLOT.sunLight], [4, 3, 2, 1])
  assert.deepEqual(slots[LOCAL_FOG_SLOT.sunDirection], [0, 1, 0, 0])
  const at = LOCAL_FOG_SLOT.instances
  near(
    slots[at + LOCAL_FOG_INSTANCE.centre],
    [4 - EYE[0], 5 - EYE[1], -6 - EYE[2], 15],
    'centre',
    1e-6,
  )
  near(slots[at + LOCAL_FOG_INSTANCE.axis], [0, 0, 1, 7], 'axis', 1e-6)
  near(
    slots[at + LOCAL_FOG_INSTANCE.law],
    [0.5, 2, 4, 0.25],
    'law: the falloff over a hundred',
    1e-6,
  )
  near(slots[at + LOCAL_FOG_INSTANCE.albedo], [0.2, 0.4, 0.6, 0.3], 'albedo', 1e-6)
  near(slots[at + LOCAL_FOG_INSTANCE.emissive], [1, 2, 3, 0], 'emissive', 1e-6)
  // No sun: the sun's slots are zero.
  const dark = localSlots([volume], { sun: null }).slots
  assert.deepEqual(
    [dark[LOCAL_FOG_SLOT.sunLight], dark[LOCAL_FOG_SLOT.sunDirection]],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  )
  // A falloff below 1 is held to 1, and the first volume is the farthest: its slot is first.
  const slow = localSlots([{ ...volume, heightFalloff: 0.1 }]).slots
  near([slow[at + LOCAL_FOG_INSTANCE.law][2]], [0.01], 'held to 1', 1e-7)
})

test('the plan drops no volume for lying outside the view: the cap keeps the nearest, the culling pass lists them by tile', () => {
  // Before the view, behind the eye, past a side, above it: all of them written.
  const volumes = [
    placed('ahead', [0, 2, -12]),
    placed('behind', [1, 2, 14]),
    placed('far side', [-80, 2, -30], { scale: 2 }),
    placed('above', [0, 60, -20]),
  ]
  assert.equal(localSlots(volumes).count, volumes.length)
})

test('the view in the block: the rows that take a point from the eye to clip space, the size, the near distance, and the tiling only where a volume is drawn', () => {
  const tiling = localFogTiling(VIEW.width, VIEW.height, 40, 32)!
  assert.deepEqual(tiling, { size: 40, across: 4, down: 3, stride: 9, words: 4 * 3 * 9 + 32 })
  const { slots, count } = localSlots([placed('a', [0, 2, -12])], { tiling })
  assert.equal(count, 1)
  assert.deepEqual(slots[LOCAL_FOG_SLOT.tiling], [40, 4, 3, 9])
  near(
    slots[LOCAL_FOG_SLOT.screen],
    [VIEW.width, VIEW.height, VIEW.near, tiling.words],
    'view',
    1e-6,
  )
  const m = VIEW.viewProj
  for (const p of [
    [1, -2, -5],
    [-3, 4, -20],
    [0.5, 0, -0.3],
    [2, 1, 6],
  ]) {
    const world = [p[0] + EYE[0], p[1] + EYE[1], p[2] + EYE[2], 1]
    for (let r = 0; r < 4; r++) {
      const want = world.reduce((sum, c, k) => sum + c * m[4 * k + r], 0)
      const row = slots[LOCAL_FOG_SLOT.projection + r]
      near(
        [row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3]],
        [want],
        `row ${r} of ${p}`,
        1e-5,
      )
    }
  }
  // No volume this image: the tiling is not said, whatever was asked for, and a view that is not tiled
  // says none either.
  const none = localSlots([], { tiling }).slots
  assert.deepEqual(none[LOCAL_FOG_SLOT.tiling], [0, 0, 0, 0])
  assert.equal(none[LOCAL_FOG_SLOT.screen][3], 0)
  assert.deepEqual(
    localSlots([placed('a', [0, 2, -12])]).slots[LOCAL_FOG_SLOT.tiling],
    [0, 0, 0, 0],
  )
})

test('volumes that left the view leave no fog on the sky: the header says none and not tiled, and the lists and volumes of the image before are not read', () => {
  const sun = { light: [3, 2, 1], toward: [0.3, 0.9, 0.3] }
  const tiling = localFogTiling(VIEW.width, VIEW.height, 40, 32)!
  const volume = placed('v', [0, 2, -12], { emissive: [1, 1, 1] })
  const [first, second] = [localSlots([volume], { sun, tiling }), localSlots([], { sun, tiling })]
  // The sky's ray through the volume of the first image.
  const ray: V3 = [0, 0.1, -1e11]
  const tiles = new Array(tiling.words).fill(0)
  const lists = overOf(first.slots, 0, tiles)
  tiles[0] = 1
  tiles[1] = 0
  for (let tile = 0; tile < 12; tile++) {
    tiles[tile * tiling.stride] = 1
    tiles[tile * tiling.stride + 1] = 0
  }
  const seen = lists(ray, [80, 45])
  assert.ok(seen[3] < 1, 'the first image lays the volume on the sky')
  // The second image: the header holds no volume, but the instance words and the lists are the first
  // image's, as the GPU buffers are (the plan writes only what it draws).
  const stale = second.slots.map((row, k) => (k >= LOCAL_FOG_SLOT.instances ? first.slots[k] : row))
  assert.deepEqual(stale[LOCAL_FOG_SLOT.header].slice(0, 1), [0])
  assert.deepEqual(overOf(stale, 0, tiles)(ray, [80, 45]), [0, 0, 0, 1], 'nothing on the sky')
  // The same with a header that still says tiled, as the image before wrote it.
  const tiled = stale.map((row, k) => (k === LOCAL_FOG_SLOT.tiling ? first.slots[k] : row))
  assert.deepEqual(
    overOf(tiled, 0, tiles)(ray, [80, 45]),
    [0, 0, 0, 1],
    'nothing, whatever it says',
  )
})

test('the sky light’s term is three rows, each `max(0, a · n + b)` along a direction of the scene: what the harmonics read there, times the light’s colour and its scattering', () => {
  // A set of harmonics of numbers of no pattern, the second set the first's cross-fade partner.
  const harmonics = Array.from({ length: HARMONICS_SETS * HARMONICS_SET_VECTORS }, (_, i) =>
    [0, 1, 2, 3].map((k) => Math.sin(1 + i * 1.7 + k * 0.9) * 0.4 + (k === 3 ? 0.35 : 0)),
  )
  const read = (levels: number[]) => {
    const block = Array.from({ length: LOCAL_FOG_SLOT.sky + 4 }, () => [9, 9, 9, 9])
    const run = shaderRun<{
      localSkyMain: () => void
      localSkyRow: (k: number) => number[]
      skyLightDiffuseSimple: (n: V3) => number[]
      skyLightScattering: () => number
    }>(
      LOCAL_SKY_PROGRAM,
      ['localSkyMain', 'localSkyRow', 'skyLightDiffuseSimple', 'skyLightScattering'],
      {
        skyHarmonics: harmonics,
        skyLight: { colour: [0.8, 0.6, 0.4, 0.7], levels },
        directLights: { localFog: block },
      },
    )
    const rows = [0, 1, 2].map((k) => run.localSkyRow(k))
    // The pass writes the three rows into the block's sky slots and nothing past them.
    run.localSkyMain()
    assert.deepEqual(block.slice(LOCAL_FOG_SLOT.sky, LOCAL_FOG_SLOT.sky + 4), [
      ...rows,
      [9, 9, 9, 9],
    ])
    for (const n of [
      [0, 1, 0],
      [0.6, 0.8, 0],
      [-0.3, -0.5, 0.81],
      [0.15, -0.2, -0.9],
      [0.12, 0.05, -0.04],
    ] as V3[]) {
      const row = rows.map((r) => Math.max(0, r[0] * n[0] + r[1] * n[1] + r[2] * n[2] + r[3]))
      const want = run.skyLightDiffuseSimple(n).map((c) => c * run.skyLightScattering())
      near(row, want, `${n} at ${levels}`, 1e-9)
    }
    return rows
  }
  // The first set alone, then half way to the second.
  const alone = read([1, 5, 0, 0])
  read([1, 5, 0, 0.5])
  assert.ok(
    alone.every((row) => row.some((c) => c !== 0)),
    'the rows are the light’s',
  )
})

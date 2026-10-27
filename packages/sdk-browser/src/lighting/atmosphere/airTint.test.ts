// The planet's frame and the air's tint toward a light, run in JavaScript (`shaderRun`): a point of the planet's
// frame put back in the scene at the planet's place, and the tint a light takes through the air, per point and
// at the ground the surface cache's cards stand on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AIR_TINT_WGSL } from './airTintWgsl.ts'
import { capture360Program } from './capture360Wgsl.ts'
import { DEFAULT_AIR_SHAPE } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'

/** The radius of the top of the air the runs stand under, kilometres. */
const TOP_RADIUS = 6420

/** The block's slots of a planet whose ground stands at `height` metres and whose top stands at
 *  `place` on the ground plane, as a program reads them (`atmo`). */
const planetBlock = (height: number, place: number[]) => (slot: number) =>
  slot === ATMOSPHERE_SLOT.planet
    ? [1, 6360, 6420, height]
    : slot === ATMOSPHERE_SLOT.planetPlace
      ? [place[0], place[1], 0, 0]
      : [0, 0, 0, 0]

test('a point of the planet’s frame is put back in the scene at the planet’s place, and a scene place taken from it', () => {
  const place = [30_000, -10_000]
  const { airToScene } = shaderRun<{ airToScene: (p: number[]) => number[] }>(
    skyProgram(DEFAULT_AIR_SHAPE).code,
    ['airToScene'],
    { bottomRadius: () => 6360, atmo: planetBlock(40, place) },
  )
  // The planet's top, 2 km along x and 1 km over its ground, is a scene point beside the place.
  assert.deepEqual(airToScene([2, 6361, 0.5]), [32_000, 1040, -9_500])
  const { sceneToPlanet } = shaderRun<{ sceneToPlanet: (scene: number[]) => number[] }>(
    capture360Program(DEFAULT_AIR_SHAPE).code,
    ['sceneToPlanet'],
    { atmo: planetBlock(40, place), bottomRadius: () => 6360, topRadius: () => TOP_RADIUS },
  )
  const there = sceneToPlanet([32_000, 1040, -9_500])
  assert.ok(Math.abs(there[0] - 2) < 1e-4 && Math.abs(there[2] - 0.5) < 1e-4)
  assert.ok(Math.abs(there[1] - 6361) < 1e-3)
})

test('the air’s tint toward a light is read at the surface point seen from the planet’s centre, the planet at its place', () => {
  const rows: number[][] = Array.from({ length: ATMOSPHERE_SLOT.planetPlace + 1 }, () => [
    0, 0, 0, 0,
  ])
  rows[ATMOSPHERE_SLOT.planet] = [1, 6360, 6420, 40]
  rows[ATMOSPHERE_SLOT.planetPlace] = [30_000, -10_000, 0, 0]
  rows[ATMOSPHERE_SLOT.lightFlags] = [0, 0, 1, 0]
  rows[ATMOSPHERE_SLOT.lightSlots] = [0, -1, 0, 0]
  let height = 0
  const { airTintOf } = shaderRun<{
    airTintOf: (rank: number, light: object, point: number[]) => number[]
  }>(AIR_TINT_WGSL, ['airTintOf'], {
    directLights: { atmosphere: rows },
    raySphere: () => [-1, -1],
    transmittanceAddress: (h: number) => ((height = h), [0, 0]),
    tintStored: () => [0.5, 0.5, 0.5],
  })
  const tint = airTintOf(0, { directionCone: [0, -1, 0, 0] }, [32_000, 1040, -9_500])
  assert.deepEqual(tint, [0.25, 0.25, 0.25], 'the table’s square root, squared')
  assert.ok(Math.abs(height - Math.hypot(2, 6361, 0.5)) < 1e-3)
})

test('the surface cache’s cards take the air’s tint toward a light once, the transmittance at the ground the block holds, and none for a light that does not ask for it per point', () => {
  const rows: number[][] = Array.from({ length: ATMOSPHERE_SLOT.planetPlace + 1 }, () => [
    0, 0, 0, 0,
  ])
  rows[ATMOSPHERE_SLOT.sunTransmittance] = [0.9, 0.6, 0.3, 0.1]
  rows[ATMOSPHERE_SLOT.secondTransmittance] = [0.5, 0.4, 0.2, 0]
  rows[ATMOSPHERE_SLOT.lightSlots] = [0, 3, 0, 0]
  const tintOf = (flags: number[]) => {
    rows[ATMOSPHERE_SLOT.lightFlags] = flags
    const { airGroundTintOf } = shaderRun<{ airGroundTintOf: (rank: number) => number[] }>(
      AIR_TINT_WGSL,
      ['airGroundTintOf'],
      { directLights: { atmosphere: rows } },
    )
    return [0, 3, 7].map(airGroundTintOf)
  }
  assert.deepEqual(
    tintOf([0, 0, 1, 0]),
    [
      [0.9, 0.6, 0.3],
      [1, 1, 1],
      [1, 1, 1],
    ],
    'the sun alone',
  )
  assert.deepEqual(
    tintOf([0, 0, 1, 1]),
    [
      [0.9, 0.6, 0.3],
      [0.5, 0.4, 0.2],
      [1, 1, 1],
    ],
    'both',
  )
  assert.deepEqual(
    tintOf([0, 0, 0, 0]),
    [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    'its colour is tinted already',
  )
})

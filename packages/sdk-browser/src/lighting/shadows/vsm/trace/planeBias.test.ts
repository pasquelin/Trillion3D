// The receiver-plane biases of the rays, run from the shipped WGSL: the plane's lift is twice the
// depth it climbs toward the light over a step, never below 0; a sun ray's bias is that lift over
// its start dither, the slope held, less what its start offset gained; a sun's one tap and a local
// ray take the lift from their start to the centre of the texel it falls in, held to a cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmSunsProjectionWgsl } from '../projection/projectionWgsl.ts'
import { VSM_UNIT_PER_CM } from '../constants.ts'
import { vsmLayout } from '../layout.ts'

const CODE = vsmSunsProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }))
const K = wgslConstants(CODE)
const TEXELS = K.VSM_LEVEL0_TEXELS
/** A mapped, drawable entry at the pool's first page: the word the table reads give. */
const MAPPED = (K.VSM_ENTRY_MAPPED_BIT | K.VSM_ENTRY_DRAWABLE_BIT) >>> 0
/** World = map UV, a depth unit a unit of the sun level's depth: `lightViewToClip[2][2]` is -0.01. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const DEPTH_PER_UNIT = -0.01
const record = {
  shiftedToMapUv: new Mat(IDENTITY),
  lightViewToClip: new Mat(IDENTITY.map((v, i) => (i === 10 ? DEPTH_PER_UNIT : v))),
}
const bias = shaderRun<{
  vsmPlaneLift: (slope: number[], offset: number[]) => number
  vsmSunDitherBias: (m: object, offsetUv: number[], start: number, slope: number[]) => number
  vsmSunTapBias: (m: object, slope: number[]) => number
  vsmLocalPlaneBias: (m: object, start: number[], slope: number[], cap: number) => number
}>(CODE, ['vsmPlaneLift', 'vsmSunDitherBias', 'vsmSunTapBias', 'vsmLocalPlaneBias'], {
  ...K,
  vsmProjectionData: [record],
  vsmTableEntryOf: () => 0,
  vsmTableWord: () => MAPPED,
})
const map = { handle: { id: 0 }, mip: 0 }
/** A texel's UV a quarter texel left of its centre in X and right of it in Y. */
const UV = [10.25 / TEXELS, 20.75 / TEXELS]
/** The centre offset there, in UV: a quarter texel right in X, a quarter left in Y. */
const CENTRE = [0.25 / TEXELS, -0.25 / TEXELS]

test('the lift is twice the plane’s climb over the step, and never below 0', () => {
  assert.equal(bias.vsmPlaneLift([0.01, 0.02], [0.5, 0.25]), 2 * (0.005 + 0.005))
  assert.equal(bias.vsmPlaneLift([0.01, 0], [-0.5, 0]), 0)
})

test('a sun ray’s dither bias follows the slope held to 0.05, less the depth its start offset gained', () => {
  const dither = { offset: [2, 0], slope: [0.2, 0] }
  const lift = 2 * 0.05 * 2
  assert.ok(Math.abs(bias.vsmSunDitherBias(map, dither.offset, 0, dither.slope) - lift) < 1e-7)
  const gained = 5 * Math.abs(DEPTH_PER_UNIT)
  const reduced = bias.vsmSunDitherBias(map, dither.offset, 5, dither.slope)
  assert.ok(
    Math.abs(reduced - (lift - gained)) < 1e-7,
    'what the start offset gained is not added twice',
  )
  assert.equal(bias.vsmSunDitherBias(map, dither.offset, 40, dither.slope), 0, 'never below 0')
  assert.equal(bias.vsmSunDitherBias(map, [0, 0], 0, dither.slope), 0, 'no dither, no bias')
})

test('a local ray’s bias is the lift to the centre of its texel, held to the cap', () => {
  const start = [UV[0], UV[1], 0.5]
  const one = bias.vsmLocalPlaneBias(map, start, [4096, 0], 1)
  assert.ok(Math.abs(one - 2 * 4096 * CENTRE[0]) < 1e-6, `${one}`)
  assert.equal(bias.vsmLocalPlaneBias(map, start, [4096, 0], 0.1), 0.1)
  assert.equal(
    bias.vsmLocalPlaneBias(map, start, [0, 4096], 1),
    0,
    'a centre behind the start lifts nothing',
  )
  const centred = [10.5 / TEXELS, 20.5 / TEXELS, 0.5]
  assert.equal(
    bias.vsmLocalPlaneBias(map, centred, [4096, 4096], 1),
    0,
    'a start on the centre needs none',
  )
})

test('a sun’s one tap lifts to the centre of its texel, held to 100 cm of the level’s depth', () => {
  const tap = (levelPoint: number[]) => ({
    handle: { id: 0 },
    level: { id: 0 },
    page: { entry: MAPPED },
    levelPoint: [...levelPoint, 0.5, 1],
  })
  const lifted = bias.vsmSunTapBias(tap(UV), [100, 0])
  assert.ok(Math.abs(lifted - 2 * 100 * CENTRE[0]) < 1e-7, `${lifted}`)
  const cap = 100 * VSM_UNIT_PER_CM * Math.abs(DEPTH_PER_UNIT)
  assert.ok(Math.abs(bias.vsmSunTapBias(tap(UV), [1e9, 0]) - cap) < 1e-7)
  assert.equal(bias.vsmSunTapBias({ ...tap(UV), page: { entry: 0 } }, [100, 0]), 0, 'unmapped')
})

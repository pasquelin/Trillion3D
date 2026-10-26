// The receiver-plane biases of the rays, run from the shipped WGSL: the plane's lift is twice the
// depth it climbs toward the light over a step, never below 0; a sun ray, a sun's one tap and a
// local ray take the lift from their receiver to the centre of the texel their start falls in, held
// to a cap (a sun ray's start dithered, the slope held, less what its start offset gained).
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
/** The biases run over a map `rec` whose table words are all `word`. */
const biasOver = (rec: object, word: number) =>
  shaderRun<{
    vsmPlaneLift: (slope: number[], offset: number[]) => number
    vsmSunDitherBias: (
      m: object,
      rayStart: number[],
      offsetUv: number[],
      startOffset: number,
      slope: number[],
    ) => number
    vsmSunTapBias: (m: object, slope: number[]) => number
    vsmLocalPlaneBias: (m: object, start: number[], slope: number[], cap: number) => number
  }>(CODE, ['vsmPlaneLift', 'vsmSunDitherBias', 'vsmSunTapBias', 'vsmLocalPlaneBias'], {
    ...K,
    vsmProjectionData: [rec],
    vsmTableEntryOf: () => 0,
    vsmTableWord: () => word,
  })
const bias = biasOver(record, MAPPED)
const map = { handle: { id: 0 }, mip: 0 }
/** A texel's UV a quarter texel left of its centre in X and right of it in Y. */
const UV = [10.25 / TEXELS, 20.75 / TEXELS]
/** The centre offset there, in UV: a quarter texel right in X, a quarter left in Y. */
const CENTRE = [0.25 / TEXELS, -0.25 / TEXELS]

test('the lift is twice the plane’s climb over the step, and never below 0', () => {
  assert.equal(bias.vsmPlaneLift([0.01, 0.02], [0.5, 0.25]), 2 * (0.005 + 0.005))
  assert.equal(bias.vsmPlaneLift([0.01, 0], [-0.5, 0]), 0)
})

/** A sun ray's receiver at `UV` of the map, as `vsmLightMapAt` keeps it. */
const RECEIVER = { handle: { id: 0 }, mapPoint: [...UV, 0.5, 1] }
/** The step, in texels, from the receiver to a texel centre. */
const toCentre = (centre: number[]) => [centre[0] - 10.25, centre[1] - 20.75]
/** Twice the plane's climb over a step of `d` texels, never below 0. */
const lift = (slope: number[], d: number[]) =>
  (2 * Math.max(0, slope[0] * d[0] + slope[1] * d[1])) / TEXELS
const near = (got: number, want: number) =>
  assert.ok(Math.abs(got - want) <= 1e-5 * Math.abs(want) + 1e-12, `${got} vs ${want}`)
/** A ray start at texel coordinates (x, y) of the map. */
const start = (x: number, y: number) => [x / TEXELS, y / TEXELS, 0.5]
const SLOPE = [0.04, 0.03]
const FROM_RECEIVER = start(10.25, 20.75)

test('a sun ray’s bias is the lift to the centre of the texel its dithered start falls in', () => {
  const at = (rayStart: number[], offset = [0, 0], startOffset = 0, slope = SLOPE) =>
    bias.vsmSunDitherBias(RECEIVER, rayStart, offset, startOffset, slope)
  near(at(FROM_RECEIVER), lift(SLOPE, toCentre([10.5, 20.5])))
  assert.ok(at(FROM_RECEIVER) > 0, 'a start off its texel’s centre is lifted with no dither')
  near(at(FROM_RECEIVER, [1 / TEXELS, 0]), lift(SLOPE, toCentre([11.5, 20.5])))
  near(at(start(12.25, 20.75)), lift(SLOPE, toCentre([12.5, 20.5])))
  near(at(FROM_RECEIVER, [0, 0], 0, [1, 0]), lift([0.05, 0], toCentre([10.5, 20.5])))
  const centred = { ...RECEIVER, mapPoint: [10.5 / TEXELS, 20.5 / TEXELS, 0.5, 1] }
  assert.equal(
    bias.vsmSunDitherBias(centred, start(10.5, 20.5), [0, 0], 0, SLOPE),
    0,
    'a start on a texel’s centre, undithered, is lifted by nothing',
  )
})

test('a sun ray’s bias is held to the cap and less the depth its start offset gained', () => {
  const full = lift(SLOPE, toCentre([10.5, 20.5]))
  const gained = full / 4
  const reduced = bias.vsmSunDitherBias(
    RECEIVER,
    FROM_RECEIVER,
    [0, 0],
    gained / Math.abs(DEPTH_PER_UNIT),
    SLOPE,
  )
  near(reduced, full - gained)
  assert.equal(
    bias.vsmSunDitherBias(RECEIVER, FROM_RECEIVER, [0, 0], 40, SLOPE),
    0,
    'never below 0',
  )
  const shallow = {
    ...record,
    lightViewToClip: new Mat(IDENTITY.map((v, i) => (i === 10 ? -1e-12 : v))),
  }
  const cap = 100 * VSM_UNIT_PER_CM * 1e-12
  near(biasOver(shallow, MAPPED).vsmSunDitherBias(RECEIVER, FROM_RECEIVER, [0, 0], 0, SLOPE), cap)
})

test('a sun ray whose start no texel holds is lifted by the plane over its dither alone', () => {
  const step = [1 / TEXELS, 0]
  const dither = lift(SLOPE, [1, 0])
  near(biasOver(record, 0).vsmSunDitherBias(RECEIVER, FROM_RECEIVER, step, 0, SLOPE), dither)
  near(bias.vsmSunDitherBias(RECEIVER, [1, 0.5, 0.5], step, 0, SLOPE), dither)
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_LEVEL0_TEXELS, VSM_UNIT_PER_CM } from '../../vsm/constants.ts'
import { biasSlope, cascadeBiasInDistance, spotBiasInDistance } from '../classicBias.fixture.ts'
import { cascadeDrawBias, spotDrawBias, type DrawBiasSettings } from './drawBias.ts'

const settings: DrawBiasSettings = {
  shadowCsmDepthBias: 10,
  shadowCsmSlopeScaleDepthBias: 3,
  shadowMaxCsmResolution: 2048,
  shadowCsmCaching: false,
  shadowSpotLightDepthBias: 3,
  shadowSpotLightSlopeScaleDepthBias: 3,
  shadowMaxSlopeScaleDepthBias: 1,
}
const light = { userBias: 0.5, userSlope: 0.5 }
/** What a vertex of slope `slope` is biased by, as the vertex stage computes it. */
const lift = (b: { constant: number; slope: number }, slope: number) =>
  b.constant * (1 + b.slope * slope)

test('a cascade’s draw bias is the reference’s, strictly, for every size and slope', () => {
  for (const radiusCm of [120, 900.5, 4999, 12000, 80000])
    for (const nol of [1, 0.8, 0.4, 0.1]) {
      const slope = biasSlope(nol, 1)
      const expected = cascadeBiasInDistance(radiusCm, 2048, 10, 3, light, slope).depth
      const drawn = lift(cascadeDrawBias(radiusCm * VSM_UNIT_PER_CM, settings), slope)
      assert.ok(Math.abs(drawn - expected * VSM_UNIT_PER_CM) <= 1e-12 * Math.max(1, expected))
    }
})

test('a spot’s draw bias is the reference’s, strictly, for every map size and slope', () => {
  for (const mip of [0, 1, 3])
    for (const nol of [1, 0.5, 0.2]) {
      const slope = biasSlope(nol, 1)
      const expected = spotBiasInDistance(
        VSM_LEVEL0_TEXELS >> mip,
        3,
        3,
        60,
        1500,
        light,
        slope,
      ).depth
      const drawn = lift(spotDrawBias(mip, settings), slope)
      assert.ok(Math.abs(drawn - expected * VSM_UNIT_PER_CM) <= 1e-12 * Math.max(1, expected))
    }
})

test('cached cascades carry no slope bias, and each cascade’s bias is its own sphere’s', () => {
  assert.equal(cascadeDrawBias(10, { ...settings, shadowCsmCaching: true }).slope, 0)
  const small = cascadeDrawBias(5, settings)
  const large = cascadeDrawBias(20, settings)
  assert.equal(large.constant, small.constant * 4)
  assert.equal(large.slope, small.slope)
})

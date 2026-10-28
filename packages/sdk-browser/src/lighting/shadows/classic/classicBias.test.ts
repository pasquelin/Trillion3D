// The classic biases the reference's way (through each map's normalised depth range) and in distance (what the shader computes) are one number: the range cancels from a cascade's and a spot's,
// and a point light's depth bias, brought back from its reversed depth, is the closed form.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  biasSlope,
  cascadeBiasInDistance,
  cascadeBiasThroughRange,
  cascadeDepthRange,
  pointBiasInDepth,
  pointShiftInDistance,
  pointShiftThroughDepth,
  spotBiasInDistance,
  spotBiasThroughRange,
} from './classicBias.fixture.ts'

const near = (a: number, b: number, relative = 1e-9) =>
  Math.abs(a - b) <= relative * Math.max(Math.abs(a), Math.abs(b), 1e-12)
const LIGHT = { userBias: 0.5, userSlope: 0.5 }

test('a cascade’s depth range is its sphere’s doubled, at least 10000 cm: 5000 each way from the light’s plane', () => {
  assert.equal(cascadeDepthRange(300.2), 10000)
  assert.equal(cascadeDepthRange(8000.1), 2 * 8001)
})

test('a cascade’s biases through its depth range are the ones in distance, for every size and slope', () => {
  for (const radius of [120, 900.5, 4999, 5000, 12000, 80000])
    for (const nol of [1, 0.8, 0.4, 0.1]) {
      const slope = biasSlope(nol, 1)
      const range = cascadeBiasThroughRange(radius, 2048, 10, 3, LIGHT, slope)
      const distance = cascadeBiasInDistance(radius, 2048, 10, 3, LIGHT, slope)
      assert.ok(near(range.depth, distance.depth), `depth ${radius} ${nol}`)
      assert.ok(near(range.transition, distance.transition), `transition ${radius} ${nol}`)
    }
  // The settings' defaults on a cascade of 1000 cm: 10 · (1000 / 2048) · 0.5 centimetres of constant bias.
  assert.ok(
    near(cascadeBiasInDistance(1000, 2048, 10, 3, LIGHT, 0).depth, 10 * (1000 / 2048) * 0.5),
  )
})

test('a spot’s biases through its depth range are the ones in distance', () => {
  for (const radius of [300, 1500, 9000])
    for (const resolution of [512, 2048]) {
      const slope = biasSlope(0.5, 1)
      const range = spotBiasThroughRange(radius, resolution, 3, 3, 60, LIGHT, slope)
      const distance = spotBiasInDistance(resolution, 3, 3, 60, radius, LIGHT, slope)
      assert.ok(near(range.depth, distance.depth), `depth ${radius} ${resolution}`)
      assert.ok(near(range.transition, distance.transition), `transition ${radius} ${resolution}`)
    }
})

test('a point light’s receiver shift, from its reversed depth plus the bias, is the closed form', () => {
  for (const radius of [400, 1500, 9000])
    for (const z of [20, 150, 0.9 * radius])
      for (const nol of [1, 0.3]) {
        const bias = pointBiasInDepth(z, 2048, 0.02, 3, LIGHT, nol)
        assert.ok(
          near(
            pointShiftThroughDepth(z, radius, bias),
            pointShiftInDistance(z, radius, bias),
            1e-6,
          ),
          `${radius} ${z} ${nol}`,
        )
      }
})

test('the slope is held to the most the setting allows, and is the most at a surface edge on', () => {
  assert.equal(biasSlope(1, 1), 0)
  assert.equal(biasSlope(0.01, 1), 1)
  assert.equal(biasSlope(0, 3), 3)
})

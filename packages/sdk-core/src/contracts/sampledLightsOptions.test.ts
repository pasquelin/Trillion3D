import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import { SAMPLED_LIGHTS_RULES } from './sampledLightsOptions.ts'

test('the sampled lighting is off by default, every other setting at the reference default', () => {
  const values = resolveSettings(SAMPLED_LIGHTS_RULES, {})
  assert.equal(values.sampledLights, false)
  assert.equal(values.sampledLightsDirectional, false)
  assert.equal(values.sampledLightsShadowMethod, 'rayTracing')
  assert.equal(values.sampledLightsDownsample, 2)
  assert.equal(values.sampledLightsHiddenWeight, 0.1)
  assert.equal(values.sampledLightsHiddenWeightOnHistoryMiss, 0.4)
  assert.equal(values.sampledLightsDirectionalFraction, 0.5)
  assert.equal(values.sampledLightsDirectionalMinClampWeight, 0.01)
  assert.equal(values.sampledLightsMergeRays, true)
  assert.equal(values.sampledLightsVsmMarkPages, true)
  assert.equal(values.sampledLightsTemporalMinFrames, 4)
  assert.equal(values.sampledLightsTemporalMaxFrames, 12)
  assert.equal(values.sampledLightsTemporalClampScale, 1)
  assert.equal(values.sampledLightsSpatial, true)
  assert.equal(values.sampledLightsPowerDelta, true)
  assert.equal(values.sampledLightsPowerDeltaLightFunctions, false)
  assert.equal(values.sampledLightsSpatialRadius, 8)
  assert.equal(values.sampledLightsSpatialSamples, 4)
  assert.equal(values.sampledLightsSpatialHistoryDeviation, 0.15)
  assert.equal(values.sampledLightsShadingConfidence, true)
  assert.equal(values.sampledLightsMaxShadingWeight, 20)
  assert.equal(values.sampledLightsMaxShadingWeightHidden, 5)
  assert.equal(values.sampledLightsScreenTraces, true)
  assert.equal(values.sampledLightsScreenTraceHair, true)
  assert.equal(values.sampledLightsHairUnshadowedDistance, 0.2)
  assert.equal(values.sampledLightsScreenTraceIterations, 50)
  assert.equal(values.sampledLightsScreenTraceThickness, 0.005)
  assert.equal(values.sampledLightsFastClear, false)
  assert.equal(values.sampledLightsHairFastClear, true)
  assert.equal(values.sampledLightsHairDownsample, 0)
  assert.equal(values.sampledLightsSamplesPerPixel, 4)
  assert.equal(values.sampledLightsMinSampleWeight, 0.001)
  assert.equal(values.sampledLightsAttenuationFalloff, 0.18)
  assert.equal(values.sampledLightsTransmissionSampleWeight, 0.1)
  assert.equal(values.sampledLightsTemporalHistoryDistance, 0.03)
  assert.equal(values.sampledLightsVolume, true)
  assert.equal(values.sampledLightsVolumeDownsample, 2)
  assert.equal(values.sampledLightsVolumeWorldSpaceTraces, true)
  assert.equal(values.sampledLightsVolumeSamplesPerVoxel, 2)
  for (const [name, rule] of Object.entries(SAMPLED_LIGHTS_RULES)) assert.equal(rule.field, name)
})

test('each setting takes what its rule says, and nothing else', () => {
  const rules = SAMPLED_LIGHTS_RULES
  assert.equal(resolveSetting(rules.sampledLights, true), true)
  assert.throws(() => resolveSetting(rules.sampledLights, 1 as never), /true or false/)
  assert.equal(
    resolveSetting(rules.sampledLightsShadowMethod, 'virtualShadowMap'),
    'virtualShadowMap',
  )
  assert.throws(
    () => resolveSetting(rules.sampledLightsShadowMethod, 'other' as never),
    /rayTracing/,
  )
  assert.throws(() => resolveSetting(rules.sampledLightsDownsample, 3), /whole number/)
  assert.throws(() => resolveSetting(rules.sampledLightsSamplesPerPixel, 0), /at least 1/)
  assert.throws(() => resolveSetting(rules.sampledLightsTransmissionSampleWeight, 1.5), /number/)
  assert.throws(() => resolveSetting(rules.sampledLightsMinSampleWeight, -1), /at least 0/)
})

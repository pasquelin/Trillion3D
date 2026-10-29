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

test('the debug views are off by default, the distances and the cursor at the reference’s values', () => {
  const values = resolveSettings(SAMPLED_LIGHTS_RULES, {})
  assert.equal(values.sampledLightsVisualize, 0)
  assert.equal(values.sampledLightsVisualizeShadowCasterMissingDistance, 0.5)
  assert.equal(values.sampledLightsVisualizeShadowCasterPoorDistance, 0.25)
  assert.equal(values.sampledLightsVisualizeTileClassification, 0)
  assert.equal(values.sampledLightsDebug, 0)
  assert.equal(values.sampledLightsDebugTraceStats, false)
  assert.equal(values.sampledLightsDebugCursorX, -1)
  assert.equal(values.sampledLightsDebugCursorY, -1)
  assert.equal(values.sampledLightsVisualizeLightComplexity, 0)
  assert.equal(values.sampledLightsVisualizeLightComplexityMaxLights, 32)
  assert.equal(values.sampledLightsVisualizeLightComplexityMaxCost, 32)
  assert.equal(values.sampledLightsVisualizeLightComplexityFreeze, false)
  assert.equal(values.sampledLightsVisualizeLightComplexityDump, false)
  assert.equal(values.sampledLightsVisualizeLightComplexityHeatmap, true)
  assert.equal(values.sampledLightsVisualizeLightComplexityLightColor, true)
  const rules = SAMPLED_LIGHTS_RULES
  assert.equal(resolveSetting(rules.sampledLightsVisualizeLightComplexity, 5), 5)
  assert.throws(() => resolveSetting(rules.sampledLightsVisualizeLightComplexity, 6))
  assert.equal(resolveSetting(rules.sampledLightsVisualizeLightComplexityMaxLights, 0), 0)
  assert.throws(() => resolveSetting(rules.sampledLightsVisualizeLightComplexityMaxLights, -1))
  assert.equal(resolveSetting(rules.sampledLightsVisualize, 16), 16)
  assert.throws(() => resolveSetting(rules.sampledLightsVisualize, 17))
})

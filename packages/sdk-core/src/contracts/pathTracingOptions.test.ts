// The view's path tracer settings: off by default, each default the reference's, each read by its rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PATH_TRACING_MEANINGS } from '../llm/pathTracingMeanings.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import { PATH_TRACING_RULES } from './pathTracingOptions.ts'

test('the path tracer is off, and its other settings hold the reference defaults', () => {
  const defaults = resolveSettings(PATH_TRACING_RULES, {})
  assert.equal(defaults.pathTracing, false)
  assert.equal(defaults.pathTracingSamplesPerPixel, 2048)
  assert.equal(defaults.pathTracingMaxBounces, 32)
  assert.equal(defaults.pathTracingCompactionDepth, 6)
  assert.equal(defaults.pathTracingDispatchSize, 2048)
  assert.equal(defaults.pathTracingAdaptiveSampling, false)
  assert.equal(defaults.pathTracingAdaptiveSamplingErrorThreshold, 0.001)
  assert.equal(defaults.pathTracingDenoiser, true)
  assert.equal(defaults.pathTracingTemporalDenoiser, false)
  assert.equal(defaults.pathTracingTemporalDenoiserMode, 1)
  assert.equal(defaults.pathTracingFilterWidth, 3)
  assert.equal(defaults.pathTracingIndirectDispatch, false)
  assert.equal(defaults.pathTracingEnableReferenceAtmosphere, -1)
  assert.equal(defaults.pathTracingAtmosphereOpticalDepthLUTResolution, 512)
  assert.equal(defaults.pathTracingAtmosphereOpticalDepthLUTNumSamples, 16384)
  assert.equal(defaults.pathTracingEnableAtmosphereGround, false)
  assert.equal(defaults.pathTracingUseAnalyticTransmittance, true)
  assert.equal(defaults.pathTracingMaxRaymarchSteps, 768)
  assert.equal(defaults.pathTracingVolumeMISMode, 1)
  assert.equal(defaults.pathTracingVisualize, 'none')
  assert.equal(defaults.pathTracingVisualizeMaxCount, 16)
  assert.equal(defaults.pathTracingVisualizeAmbientOcclusionMaxDistance, 2)
  assert.equal(defaults.pathTracingEnableReferenceClouds, true)
  assert.equal(defaults.pathTracingCloudAccelerationMapResolution, 512)
  assert.equal(defaults.pathTracingCloudAccelerationMapNumSamples, 64)
  assert.equal(defaults.pathTracingCloudAccelerationMapVisualize, false)
  assert.equal(defaults.pathTracingCloudMultipleScatterMode, 1)
  assert.equal(defaults.pathTracingCloudRoughnessCutoff, 0.05)
})

test('each takes what its rule says, and nothing else', () => {
  const rule = (field: keyof typeof PATH_TRACING_RULES) => PATH_TRACING_RULES[field]
  assert.equal(resolveSetting(rule('pathTracingMaxBounces'), 0), 0)
  for (const depth of [0, -1, -100])
    assert.equal(resolveSetting(rule('pathTracingCompactionDepth'), depth), depth)
  assert.throws(() => resolveSetting(rule('pathTracingSamplesPerPixel'), 0), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingAdaptiveSamplingVisualize'), 8), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingTemporalDenoiserMode'), 3), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingDenoiserNormalSpace'), 2), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingCloudMultipleScatterMode'), 3), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingVolumeMISMode'), 2), TypeError)
  assert.throws(() => resolveSetting(rule('pathTracingVisualize'), 5), TypeError)
})

test('every setting has its meaning', () => {
  assert.deepEqual(
    Object.keys(PATH_TRACING_MEANINGS).sort(),
    Object.keys(PATH_TRACING_RULES).sort(),
  )
})

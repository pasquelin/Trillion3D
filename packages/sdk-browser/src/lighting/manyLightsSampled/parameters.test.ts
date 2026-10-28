import test from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import {
  resolveSettings,
  type SettingOptions,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  sampledDownsampleFactor,
  sampledMinSampleWeightEstimate,
  sampledSamplesForInput,
  sampledSamplesPerVoxel3d,
  sampledTransmissionSampleWeight,
  sampledVolumeDownsampleFactor,
} from './parameters.ts'

const settings = (options: SettingOptions<typeof SAMPLED_LIGHTS_RULES> = {}) =>
  resolveSettings(SAMPLED_LIGHTS_RULES, options)

test('downsample and sample layouts', () => {
  assert.deepEqual(sampledDownsampleFactor(settings(), 'surface'), [2, 2])
  assert.deepEqual(sampledDownsampleFactor(settings(), 'hair'), [1, 1])
  assert.deepEqual(
    sampledDownsampleFactor(settings({ sampledLightsDownsample: 1 }), 'frontTranslucency'),
    [2, 1],
  )
  assert.deepEqual(
    sampledDownsampleFactor(settings({ sampledLightsDownsample: 0 }), 'surface'),
    [1, 1],
  )
  assert.deepEqual(
    sampledSamplesForInput(settings({ sampledLightsHairSamplesPerPixel: 2 }), 'hair'),
    [2, 1],
  )
  assert.deepEqual(sampledSamplesPerVoxel3d(2), [2, 1, 1])
  assert.deepEqual(sampledSamplesPerVoxel3d(4), [2, 2, 1])
  assert.equal(sampledVolumeDownsampleFactor(settings()), 2)
  assert.equal(sampledVolumeDownsampleFactor(settings({ sampledLightsVolumeDownsample: 0 })), 1)
})

test('weights', () => {
  assert.equal(sampledTransmissionSampleWeight(settings()), 0.1)
  assert.equal(sampledTransmissionSampleWeight(settings({ sampledLightsTransmission: false })), 0)
  assert.equal(sampledMinSampleWeightEstimate(settings()), 0.001 / 0.18)
  assert.equal(sampledMinSampleWeightEstimate(settings({ sampledLightsAttenuationFalloff: 0 })), 0)
})

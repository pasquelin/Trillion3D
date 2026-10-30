import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { heightFogOf } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import { blurMipCount, blurSteps, separateFogOf } from './separatePlan.ts'
import { fogTemporalWgsl } from './separateTemporalWgsl.ts'
import { SEPARATE_BLUR_CODE, gaussianTaps, separateUpsampleWgsl } from './separateWgsl.ts'

const settings = (options: object = {}) => resolveSettings(VOLUMETRIC_FOG_RULES, options)

test('the fog is drawn into textures of its own where the scene asks for the scattering, or the run forces it', () => {
  const plain = heightFogOf({})
  const scattering = heightFogOf({ screenSpaceScattering: true })
  assert.equal(separateFogOf(settings(), plain), undefined)
  assert.equal(separateFogOf(settings(), undefined), undefined)
  assert.deepEqual(separateFogOf(settings(), scattering), {
    scattering: scattering.screenSpaceScattering,
    maxLuminance: 10,
    temporal: true,
    temporalWeight: 0.04,
  })
  assert.equal(
    separateFogOf(settings({ fogScreenSpaceScatteringTemporal: false }), scattering)?.temporal,
    false,
  )
  assert.equal(separateFogOf(settings({ fogScreenSpaceScattering: false }), scattering), undefined)
  assert.equal(separateFogOf(settings({ fogSeparateComposition: 'off' }), scattering), undefined)
  // Forced on, without the scattering: drawn into the textures, no blur.
  assert.deepEqual(separateFogOf(settings({ fogSeparateComposition: 'on' }), plain), {
    scattering: undefined,
    maxLuminance: 10,
    temporal: false,
    temporalWeight: 0.04,
  })
  assert.equal(
    separateFogOf(
      settings({ fogSeparateComposition: 'on', fogScreenSpaceScatteringMaxLuminance: 0.01 }),
      plain,
    )?.maxLuminance,
    0.1,
  )
})

test('the scattering defaults are the reference fog values', () => {
  assert.deepEqual(heightFogOf({ screenSpaceScattering: true }).screenSpaceScattering, {
    sceneColorScatteringAmountScale: 1,
    sceneColorScatteringAmountPower: 1,
    spreadScale: 0.1,
    blurControl: 0.5,
  })
  assert.equal(heightFogOf({}).screenSpaceScattering, undefined)
})

test('the blur chain stops before the last level and has one level without the scattering', () => {
  assert.equal(blurMipCount(1920, 1080, false), 1)
  assert.equal(blurMipCount(1920, 1080, true), 11)
  assert.equal(blurMipCount(16, 16, true), 4)
  assert.equal(blurMipCount(1, 1, true), 1)
})

test('the steps build every level, filter every level, and blend all but the last', () => {
  assert.deepEqual(blurSteps(1), [])
  assert.deepEqual(
    blurSteps(4).map((s) => `${s.kind}${s.level}`),
    [
      'downsample1',
      'downsample2',
      'downsample3',
      'filter1',
      'filter2',
      'filter3',
      'blend1',
      'blend2',
    ],
  )
  assert.deepEqual(
    blurSteps(2).map((s) => `${s.kind}${s.level}`),
    ['downsample1', 'filter1'],
  )
})

test('the nine bilinear taps of the 5x5 filter weigh one and gather their blocks', () => {
  const taps = gaussianTaps()
  assert.equal(taps.length, 9)
  assert.ok(Math.abs(taps.reduce((sum, t) => sum + t[2], 0) - 1) < 1e-4)
  // The corner texel alone: its own offset and weight.
  assert.deepEqual(taps[8], [2, 2, 0.00366])
  // The 2x2 block of the offsets 0 and 1: the mean offset between them, weighted toward the heavier texels.
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4
  assert.ok(near(taps[4][0], 0.15384 / 0.39925) && near(taps[4][1], taps[4][0]))
  assert.ok(near(taps[4][2], 0.39925))
})

test('the blur and upsample programs hold no backtick', () => {
  assert.equal(SEPARATE_BLUR_CODE.includes('`'), false)
  assert.equal(separateUpsampleWgsl.includes('`'), false)
})

test('the temporal filter holds no backtick and stores in the history format', () => {
  for (const format of ['rgba16float', 'rg11b10ufloat'] as const) {
    const code = fogTemporalWgsl(format)
    assert.equal(code.includes('`'), false)
    assert.ok(code.includes(`texture_storage_2d<${format},write>`))
  }
})

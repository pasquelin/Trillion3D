// The screen probes' reference mode, the fast update, the integration's reduction and tiles, the translucent surfaces' mark and the irradiance field's gather.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'
import { DIFFUSE_INTEGRAL_METHOD } from './screenProbeOptions.ts'

test("the reference mode takes the slow reference's switches over the settings", () => {
  const reference = screenProbeSettings({
    screenProbeReferenceMode: true,
    screenProbeRadianceCache: true,
    screenProbeSpatialFilter: true,
    screenProbeQuality: 6,
  })
  assert.deepEqual(
    [reference.downsampleFactor, reference.tracingResolution, reference.gatherResolution],
    [16, 32, 8],
  )
  assert.deepEqual(
    [
      reference.spatialFilterPasses,
      reference.radianceCache,
      reference.occlusion,
      reference.importanceLighting,
    ],
    [0, false, false, false],
  )
  assert.equal(reference.integralMethod, DIFFUSE_INTEGRAL_METHOD.numerical)
  assert.equal(reference.tileClassification, false)
  assert.equal(
    reference.values.screenProbeSpatialFilter,
    false,
    'the values readers see are the overridden ones',
  )
  assert.equal(
    screenProbeSettings({ screenProbeReferenceMode: false }).integralMethod,
    DIFFUSE_INTEGRAL_METHOD.preintegrated,
  )
})

test("the fast update fraction is read as 0.001 at least, the reference's floor", () => {
  const inverse = (screenProbeFastUpdateFraction: number) =>
    screenProbeSettings({ screenProbeFastUpdateFraction }).fastUpdateInverseFraction
  assert.equal(inverse(0.1), 10)
  assert.equal(inverse(1e-5), 1000)
})

test("the irradiance format is the level's, spherical harmonics where the occlusion is applied during the integration with the bent normal", () => {
  const format = (options: object) => screenProbeSettings(options).irradianceFormat
  assert.equal(format({ screenProbes: 'high' }), 'octahedral')
  // The high level searches no bent normal: applying the occlusion during the integration leaves its format.
  assert.equal(
    format({ screenProbes: 'high', screenProbeShortRangeAOApplyDuringIntegration: true }),
    'octahedral',
  )
  assert.equal(
    format({ screenProbes: 'ultra', screenProbeShortRangeAOApplyDuringIntegration: true }),
    'sh3',
  )
})

test('the integration runs at the reduction asked, 1 by default and 2 at most, held to 1 where the level casts no probe or the occlusion is searched and applied during it at another reduction; with both asked 2 the occlusion is searched at 2', () => {
  const integrate = (options: object) => screenProbeSettings(options).integrateDownsample
  const occlusion = (options: object) => screenProbeSettings(options).occlusionDownsample
  assert.equal(integrate({ screenProbes: 'ultra' }), 1, 'the default')
  assert.equal(integrate({ screenProbes: 'ultra', screenProbeIntegrateDownsampleFactor: 2 }), 2)
  assert.equal(integrate({ screenProbes: 'off', screenProbeIntegrateDownsampleFactor: 2 }), 1)
  // The occlusion applied during the integration and searched at another reduction (the ultra level's is 1): the integration is not downsampled.
  const applied = {
    screenProbes: 'ultra',
    screenProbeShortRangeAOApplyDuringIntegration: true,
    screenProbeIntegrateDownsampleFactor: 2,
  }
  assert.equal(integrate(applied), 1)
  assert.equal(occlusion(applied), 1)
  // Asked the same reduction, both run at it.
  const same = { ...applied, screenProbeShortRangeAODownsampleFactor: 2 }
  assert.equal(integrate(same), 2)
  assert.equal(occlusion(same), 2)
  // The high level's own occlusion reduction is 2: the integration asked 2 agrees with it.
  const high = { ...applied, screenProbes: 'high' }
  assert.equal(integrate(high), 2)
  assert.equal(occlusion(high), 2)
  // Without the occlusion applied during the integration the two are independent.
  assert.equal(integrate({ screenProbes: 'high', screenProbeIntegrateDownsampleFactor: 2 }), 2)
  assert.equal(occlusion({ screenProbes: 'ultra', screenProbeIntegrateDownsampleFactor: 2 }), 1)
  // Where the occlusion is off, it asks nothing of the integration.
  assert.equal(
    integrate({
      ...applied,
      screenProbeShortRangeOcclusion: false,
      screenProbeIntegrateDownsampleFactor: 2,
    }),
    2,
  )
})

test('the integration’s tiles are classified by default, and not where the switch is off, the method is the numerical integral, or the level casts no probe; the diffuse method takes 0, 1 or 2, and unclassified tiles integrate at the image’s size', () => {
  const settings = (options: object) => screenProbeSettings({ screenProbes: 'ultra', ...options })
  assert.deepEqual(
    [settings({}).tileClassification, settings({}).integralMethod],
    [true, 0],
    'the reference’s defaults',
  )
  assert.equal(
    settings({ screenProbeIntegrationTileClassification: false }).tileClassification,
    false,
  )
  assert.equal(settings({ screenProbeDiffuseIntegralMethod: 1 }).tileClassification, true)
  assert.equal(
    settings({ screenProbeDiffuseIntegralMethod: 2 }).tileClassification,
    false,
    'the numerical integral is run over every pixel',
  )
  assert.equal(settings({ screenProbeDiffuseIntegralMethod: 2 }).integralMethod, 2)
  assert.equal(screenProbeSettings({ screenProbes: 'off' }).tileClassification, false)
  for (const refused of [
    { screenProbeDiffuseIntegralMethod: 3 },
    { screenProbeDiffuseIntegralMethod: -1 },
  ])
    assert.throws(() => settings(refused), TypeError, JSON.stringify(refused))
  // Without the classification the integration is not downsampled, whatever is asked; the numerical integral, which does not classify, keeps the reduction asked.
  const twice = { screenProbeIntegrateDownsampleFactor: 2 }
  assert.equal(settings({ ...twice }).integrateDownsample, 2)
  assert.equal(
    settings({ ...twice, screenProbeIntegrationTileClassification: false }).integrateDownsample,
    1,
  )
  assert.equal(settings({ ...twice, screenProbeDiffuseIntegralMethod: 2 }).integrateDownsample, 2)
})

test('the translucent surfaces mark the radiance cache by default, at a quarter of the image, behind the depth pyramid’s test, fading over four probes; the pyramid level follows the downsample, and the switch takes the mark away', () => {
  assert.deepEqual(screenProbeSettings().cache.translucentMark, {
    downsample: 4,
    hizMip: 2,
    hizTest: true,
    invFade: 0.25,
  })
  const mip = (factor: number) =>
    screenProbeSettings({ screenProbeTranslucencyReflectionsMarkDownsampleFactor: factor }).cache
      .translucentMark?.hizMip
  // A texel of the read level covers a downsampled pixel, the reference's levels (0, 0, 1, 2, 3, 5 of a half-size first level) one further in our full-size pyramid.
  assert.deepEqual([1, 2, 4, 8, 16, 64].map(mip), [1, 1, 2, 3, 4, 6])
  const off = screenProbeSettings({
    screenProbeTranslucencyReflectionsRadianceCache: false,
    screenProbeTranslucencyReflectionsHizOcclusionTest: false,
    screenProbeTranslucencyReflectionsClipmapFadeSize: 16,
  })
  assert.equal(off.cache.translucentMark, undefined)
  const bare = screenProbeSettings({
    screenProbeTranslucencyReflectionsHizOcclusionTest: false,
    screenProbeTranslucencyReflectionsClipmapFadeSize: 16,
  }).cache.translucentMark
  assert.deepEqual([bare?.hizTest, bare?.invFade], [false, 1 / 16])
})

test('the irradiance field gather is a setting of the reference’s names and defaults, the screen probes the default method, distances in metres', () => {
  const settings = screenProbeSettings({})
  assert.equal(settings.finalGather, 'screenProbes')
  assert.deepEqual(settings.irradianceField, {
    clipmaps: 4,
    worldExtent: 50,
    distributionBase: 2,
    budget: 100,
    gridResolution: 64,
    probeResolution: 16,
    irradianceResolution: 6,
    occlusionResolution: 16,
    mipmaps: 3,
    atlasProbes: 128,
    occlusionBias: 0.008,
    shortRangeRadius: 32,
    interpolateDownsample: 2,
    markDownsample: 2,
    adaptivePlacement: false,
    feedbackTile: 8,
    maxRoughnessToEvaluateRoughSpecular: 0.8,
  })
  assert.equal(
    screenProbeSettings({ finalGatherMethod: 'irradianceField' }).finalGather,
    'irradianceField',
  )
  for (const refused of [
    { finalGatherMethod: 'restir' },
    { irradianceFieldNumClipmaps: 0 },
    { irradianceFieldProbeAtlasResolutionInProbes: 256 },
    { irradianceFieldInterpolateDownsampleFactor: 3 },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

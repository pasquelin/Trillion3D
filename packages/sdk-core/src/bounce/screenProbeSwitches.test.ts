// The screen probes' switches, ranges and refusals, and the radiance cache's settings: the rows of a level and the update speed's reach.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'

test('a switch off, or an occlusion of no strength, leaves its pass out; a value a rule does not take is refused', () => {
  assert.equal(screenProbeSettings({ screenProbeSpatialFilter: false }).spatialFilterPasses, 0)
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterPasses: 5 }).spatialFilterPasses, 5)
  // The reference's filter runs where its kernel is above zero: the number of passes is not capped.
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterKernel: 0 }).spatialFilterPasses, 0)
  assert.equal(screenProbeSettings({ screenProbeSpatialFilterPasses: 12 }).spatialFilterPasses, 12)
  assert.equal(screenProbeSettings({ screenProbeShortRangeOcclusion: false }).occlusion, false)
  assert.equal(screenProbeSettings({ screenProbeOcclusionIntensity: 0 }).occlusion, false)
  // Where the reference takes any value, so does the setting: no invented range.
  assert.equal(
    screenProbeSettings({ screenProbeAdaptiveFraction: 2 }).values.screenProbeAdaptiveFraction,
    2,
  )
  assert.equal(
    screenProbeSettings({ screenProbeDisocclusionMaxFrames: 0 }).values
      .screenProbeDisocclusionMaxFrames,
    0,
  )
  assert.equal(
    screenProbeSettings({ screenProbeMaxIterations: 0 }).values.screenProbeMaxIterations,
    0,
  )
  for (const refused of [
    { screenProbes: 'extreme' },
    { screenProbeQuality: 0 },
    { screenProbeSpatialFilterPasses: -1 },
    { screenProbeMaxFramesAccumulated: 0 },
    { screenProbeMaxRayDirections: 0 },
    { screenProbeOcclusionIntensity: 2 },
    { screenProbeMaxFastUpdate: 2 },
    { screenProbeFastUpdateFraction: 0 },
    { screenProbeMaxTraceDistance: 0 },
    { screenProbeMaxTraceDistance: 10486 },
    { screenProbeGatherScale: 1.5 },
    { screenProbeGatherScale: 0.05 },
    { screenProbeSpatialFilterMaxHitAngle: 0 },
    { screenProbes: 'ultra ' },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

test("the radiance cache: its maps' side and its probes' budget are a level's row (the update speed taken in, from a half to four), the reference's settings its options, and no level that casts none reads it", () => {
  const rows = (level: 'high' | 'ultra' | 'cinematic') => {
    const { resolution, budget } = screenProbeSettings({ screenProbes: level }).cache
    return [resolution, budget]
  }
  assert.deepEqual(
    [rows('high'), rows('ultra'), rows('cinematic')],
    [
      [16, 100],
      [32, 150],
      [32, 350],
    ],
  )
  const speed = (screenProbeUpdateSpeed: number) =>
    screenProbeSettings({ screenProbeUpdateSpeed }).cache.budget
  assert.deepEqual([speed(1), speed(2), speed(100), speed(0.01)], [150, 300, 600, 75])
  const cache = screenProbeSettings().cache
  assert.deepEqual(
    [cache.tiles, cache.filter, cache.filterAngle, cache.mipmaps, cache.skyVisibility],
    ['full', true, 0.2, 1, false],
  )
  assert.deepEqual([cache.downsampleSq, cache.supersampleSq], [1600, 0])
  assert.equal(
    screenProbeSettings({ screenProbeRadianceCacheSupersampleDistance: 15 }).cache.supersampleSq,
    225,
  )
  assert.equal(screenProbeSettings().values.screenProbeRadianceCacheReprojectionRadiusScale, 1.5)
  // The probes nothing reads are kept 8 frames; where no screen probe is cast the cells are marked from one pixel in 2 × 2 of the image.
  assert.deepEqual(
    [cache.framesToKeepProbes, cache.markDownsample, cache.interpolateDownsample],
    [8, 2, 2],
  )
  assert.equal(
    screenProbeSettings({ screenProbeRadianceCacheFramesToKeepProbes: 0 }).cache.framesToKeepProbes,
    0,
  )
  // Read by the screen probes of a level that casts, while the switch is on; the world's probes keep a row of the finest casting level.
  const read = (options: object) => screenProbeSettings(options).radianceCache
  assert.deepEqual(
    [
      read({}),
      read({ screenProbeRadianceCache: false }),
      read({ screenProbes: 'low' }),
      read({ screenProbes: 'off' }),
    ],
    [true, false, false, false],
  )
  assert.equal(screenProbeSettings({ screenProbes: 'low' }).cache.resolution, 16)
  for (const refused of [
    { screenProbeRadianceCacheMipmaps: 0 },
    { screenProbeRadianceCacheMipmaps: 4 },
    { screenProbeRadianceCacheMipmaps: 1.5 },
    { screenProbeRadianceCacheTraceTiles: 'both' },
    { screenProbeRadianceCacheTraceTiles: 'adaptive' },
    { screenProbeRadianceCacheFilterHitAngle: 0 },
    { screenProbeRadianceCacheDownsampleDistance: -1 },
    { screenProbeRadianceCacheReprojectionRadiusScale: -1 },
    { screenProbeRadianceCacheFramesToKeepProbes: -1 },
    { screenProbeRadianceCacheFramesToKeepProbes: 1.5 },
    { screenProbeMarkDownsampleFactor: 0 },
    { screenProbeMarkDownsampleFactor: 9 },
    { screenProbeInterpolateDownsampleFactor: 3 },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

test('the options the reference leaves off carry its defaults: the probes’ temporal filter and extra ambient occlusion are off, the gather holds one level, the hair and unlit hits are kept', () => {
  const { values } = screenProbeSettings()
  assert.deepEqual(
    [
      values.screenProbeTemporalFilterProbes,
      values.screenProbeTemporalFilterProbesHistoryWeight,
      values.screenProbeExtraAmbientOcclusion,
      values.screenProbeExtraAmbientOcclusionMaxDistance,
      values.screenProbeExtraAmbientOcclusionExponent,
      values.screenProbeGatherNumMips,
      values.screenProbeSkipHairHits,
      values.screenProbeSkipUnlitHits,
      values.screenProbeScreenTracesHairBias,
      values.screenProbeSkylightLeakingRoughness,
      values.screenProbeFullSkylightLeakingDistance,
      values.screenProbeHeightFogOnGI,
    ],
    [false, 0.5, false, 5, 0.5, 1, false, false, 0.02, 0.3, 10, false],
  )
  const settings = screenProbeSettings()
  assert.deepEqual(
    [settings.temporalFilterProbes, settings.extraAo, settings.gatherMips],
    [false, false, 1],
  )
})

test('the temporal filter of the probes and the extra ambient occlusion need a level that casts; the levels of the gather are the number asked, however its side halves', () => {
  const on = {
    screenProbeTemporalFilterProbes: true,
    screenProbeExtraAmbientOcclusion: true,
  } as const
  const ultra = screenProbeSettings(on)
  assert.deepEqual([ultra.temporalFilterProbes, ultra.extraAo], [true, true])
  const low = screenProbeSettings({ ...on, screenProbes: 'low' })
  assert.deepEqual(
    [low.temporalFilterProbes, low.extraAo],
    [false, false],
    'a level that casts no probe',
  )
  // The levels asked are the levels made, whatever the side the gather has; a request of none, or of more than the texture holds, is refused.
  assert.equal(screenProbeSettings({ screenProbeGatherNumMips: 2 }).gatherMips, 2)
  assert.equal(screenProbeSettings({ screenProbeGatherNumMips: 3 }).gatherMips, 3)
  assert.equal(screenProbeSettings({ screenProbeGatherNumMips: 9 }).gatherMips, 9)
  assert.equal(
    screenProbeSettings({ screenProbeGatherNumMips: 2, screenProbeGatherScale: 0.2 }).gatherMips,
    2,
  )
  assert.throws(() => screenProbeSettings({ screenProbeGatherNumMips: 0 }), TypeError)
  // A level that casts no probe holds one level of gather, whatever is asked: no mip texture is made, no atlas refused for them.
  for (const screenProbes of ['off', 'low'] as const)
    assert.equal(screenProbeSettings({ screenProbes, screenProbeGatherNumMips: 5 }).gatherMips, 1)
  // A probe's square of the finest level (the gather plus a border of 2 ** levels) must fit the 8192 texels of a texture on any device.
  assert.equal(screenProbeSettings({ screenProbeGatherNumMips: 12 }).gatherMips, 12)
  assert.throws(() => screenProbeSettings({ screenProbeGatherNumMips: 13 }), TypeError)
})

test('the short-range occlusion is searched at the setting’s reduction, else the level’s; at the image’s size where applied in the integration or not blended with its history', () => {
  const downsample = (options: object) => screenProbeSettings(options).occlusionDownsample
  assert.equal(downsample({ screenProbes: 'high' }), 2, 'the level’s row')
  assert.equal(downsample({ screenProbes: 'ultra' }), 1, 'the level’s row')
  assert.equal(downsample({ screenProbes: 'ultra', screenProbeShortRangeAODownsampleFactor: 2 }), 2)
  assert.equal(downsample({ screenProbes: 'high', screenProbeShortRangeAODownsampleFactor: 1 }), 1)
  assert.equal(
    downsample({ screenProbes: 'ultra', screenProbeShortRangeAODownsampleFactor: 0 }),
    1,
    'held to one',
  )
  assert.equal(
    downsample({ screenProbes: 'high', screenProbeShortRangeAOApplyDuringIntegration: true }),
    1,
    'the integration is at the size of the image',
  )
  assert.equal(
    downsample({ screenProbes: 'high', screenProbeOcclusionTemporal: false }),
    1,
    'no temporal pass to filter the fewer texels',
  )
})

test('the integration runs at the reduction asked, 1 by default and 2 at most, held to 1 where the level casts no probe or the occlusion is searched and applied during it at another reduction; with both asked 2 the occlusion is searched at 2', () => {
  const integrate = (options: object) => screenProbeSettings(options).integrateDownsample
  const occlusion = (options: object) => screenProbeSettings(options).occlusionDownsample
  assert.equal(integrate({ screenProbes: 'ultra' }), 1, 'the default')
  assert.equal(integrate({ screenProbes: 'ultra', screenProbeIntegrateDownsampleFactor: 2 }), 2)
  assert.equal(integrate({ screenProbes: 'low', screenProbeIntegrateDownsampleFactor: 2 }), 1)
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

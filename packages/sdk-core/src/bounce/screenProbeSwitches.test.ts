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
    screenProbeSettings({ screenProbeMeshTraceDistance: 500 }).values.screenProbeMeshTraceDistance,
    500,
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
    { screenProbeMeshTraceDistance: -1 },
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
    ['adaptive', true, 0.2, 1, false],
  )
  assert.deepEqual(
    [cache.downsampleSq, cache.supersampleSq, cache.supersampleThreshold],
    [1600, 0, 0.1],
  )
  assert.equal(
    screenProbeSettings({ screenProbeRadianceCacheSupersampleDistance: 15 }).cache.supersampleSq,
    225,
  )
  assert.equal(screenProbeSettings().values.screenProbeRadianceCacheReprojectionRadiusScale, 1.5)
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
    { screenProbeRadianceCacheFilterHitAngle: 0 },
    { screenProbeRadianceCacheDownsampleDistance: -1 },
    { screenProbeRadianceCacheReprojectionRadiusScale: -1 },
  ])
    assert.throws(() => screenProbeSettings(refused as never), TypeError, JSON.stringify(refused))
})

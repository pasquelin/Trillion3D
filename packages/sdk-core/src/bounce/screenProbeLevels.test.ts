// The screen probes' levels: the default, each level's row, the detail trace over a level that allows it, the quality and update speed as the reference rounds them.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SCREEN_PROBE_LEVEL,
  SCREEN_PROBE_LEVEL_KNOBS,
  SCREEN_PROBE_PRESET_LEVELS,
} from './screenProbeLevels.ts'
import { screenProbeSettings } from './screenProbeOptions.fixture.ts'

test('the screen probes default to their ultra level with every pass on, and a level holds its own row', () => {
  assert.equal(DEFAULT_SCREEN_PROBE_LEVEL, 'ultra')
  const settings = screenProbeSettings()
  const { values } = settings
  assert.deepEqual(
    [
      settings.level,
      settings.enabled,
      settings.casts,
      settings.downsampleFactor,
      settings.adaptiveProbes,
    ],
    ['ultra', true, true, 16, 8],
  )
  assert.deepEqual(
    [settings.tracingResolution, settings.gatherResolution, settings.irradianceFormat],
    [8, 8, 'sh3'],
  )
  assert.deepEqual(
    [
      values.screenProbeAdaptiveFraction,
      settings.spatialFilterPasses,
      values.screenProbeMaxRayIntensity,
    ],
    [0.5, 3, 10],
  )
  assert.deepEqual(
    [
      values.screenProbeScreenTraces,
      values.screenProbeImportanceSampling,
      values.screenProbeTemporal,
      settings.occlusion,
      values.screenProbeMaterialAO,
      values.screenProbeOcclusionTemporal,
    ],
    [true, true, true, true, true, true],
  )
  assert.deepEqual([values.screenProbeSceneTraces, values.screenProbeMaxTraceDistance], [true, 200])
  assert.deepEqual(
    [
      values.screenProbeSurfaceBias,
      values.screenProbeMinTraceDistance,
      values.screenProbeHistoryDistanceThreshold,
      values.screenProbeHistoryDistanceThresholdForFoliage,
      values.screenProbeRelativeSpeedThreshold,
    ],
    [0.05, 0.0001, 0.01, 0.03, 0.005],
  )
  assert.deepEqual(
    [
      settings.fastUpdateInverseFraction,
      values.screenProbeMaxFastUpdate,
      values.screenProbeFastUpdateClamp,
    ],
    [10, 0.9, false],
  )
  assert.deepEqual(
    [
      settings.importanceLighting,
      values.screenProbeProbeRadianceHistory,
      values.screenProbeMinPdfToTrace,
      values.screenProbeSpatialFilterPositionWeightScale,
      values.screenProbeSpatialFilterMaxHitAngle,
    ],
    [true, true, 0.1, 1000, 10],
  )
  assert.deepEqual(
    [
      values.screenProbeDisocclusionMaxFrames,
      values.screenProbeDisocclusionFraction,
      values.screenProbeHistoryDepthTestThickness,
      values.screenProbeRelativeDepthThickness,
      values.screenProbeMaxIterations,
      values.screenProbeFixedJitterIndex,
      values.screenProbeFixedStateFrameIndex,
      values.stochasticLightingFixedStateFrameIndex,
      values.screenProbeShortRangeAODownsampleFactor,
      values.screenProbeIntegrateDownsampleFactor,
    ],
    [4, 0.4, 0.005, 0.02, 50, -1, -1, -1, -1, 1],
  )
  // The reference's own defaults of the interpolation and the occlusion's search, units of the engine.
  assert.deepEqual(
    [
      values.screenProbeInterpolationDepthWeight,
      values.screenProbeInterpolationDepthWeightForFoliage,
      values.screenProbeInterpolationDepthWeightFallback,
      values.screenProbeOcclusionSteps,
      values.screenProbeOcclusionForegroundFraction,
      values.screenProbeOcclusionMaxAlbedo,
      values.screenProbeOcclusionClampScale,
      settings.occlusionSlices,
    ],
    [1, 0.25, 0.1, 3, 0.3, 0.5, 1, 2],
  )
})

test('each level holds its own row of the table, and true and false are the default level and off', () => {
  for (const level of ['high', 'ultra', 'cinematic'] as const) {
    const row = SCREEN_PROBE_LEVEL_KNOBS[level]
    const at = screenProbeSettings({ screenProbes: level })
    assert.deepEqual(
      [at.downsampleFactor, at.adaptiveProbes, at.tracingResolution, at.irradianceFormat],
      [row.downsampleFactor, row.adaptiveProbes, row.tracingResolution, row.irradianceFormat],
      level,
    )
    assert.deepEqual(
      [at.stochasticInterpolation, at.occlusionSlices, at.bentNormal, at.casts],
      [row.stochasticInterpolation, row.occlusionSlices, row.bentNormal, true],
      level,
    )
  }
  assert.deepEqual(
    (['high', 'ultra', 'cinematic'] as const).map(
      (level) => screenProbeSettings({ screenProbes: level }).downsampleFactor,
    ),
    [32, 16, 8],
  )
  // The second level of the reference holds an occlusion row of its own and casts no probe; the first lights nothing.
  const low = screenProbeSettings({ screenProbes: 'low' })
  assert.deepEqual(
    [
      low.casts,
      low.enabled,
      low.occlusionSlices,
      low.occlusionDownsample,
      low.occlusionForegroundPower,
    ],
    [false, true, 1, 1, 1.5],
  )
  assert.deepEqual(
    [
      screenProbeSettings({ screenProbes: 'off' }).enabled,
      screenProbeSettings({ screenProbes: 'off' }).casts,
    ],
    [false, false],
  )
  // The level is read as the anti-aliasing's is: true the default level, false off.
  assert.equal(screenProbeSettings({ screenProbes: true }).level, DEFAULT_SCREEN_PROBE_LEVEL)
  assert.deepEqual(
    [
      screenProbeSettings({ screenProbes: false }).level,
      screenProbeSettings({ screenProbes: false }).enabled,
    ],
    ['off', false],
  )
  // The presets below the top write the levels the reference's scalability levels run: the lowest lights nothing, its bounce off too;
  // the cinematic preset writes the level of its name.
  assert.deepEqual(
    Object.values(SCREEN_PROBE_PRESET_LEVELS).map((preset) => preset.screenProbes),
    ['off', 'low', 'high', 'cinematic'],
  )
  assert.equal(SCREEN_PROBE_PRESET_LEVELS.smooth.bounce, false)
})

test('the short-range occlusion on the pixels with backface diffuse light is whole at the second level, whose world probes light them flatter, and 0.7 above, a setting replacing the row', () => {
  const strength = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeSettings(options).occlusionFoliageStrength
  assert.equal(strength({ screenProbes: 'low' }), 1)
  for (const level of ['high', 'ultra', 'cinematic'] as const)
    assert.equal(strength({ screenProbes: level }), 0.7, level)
  assert.equal(strength({ screenProbes: 'low', screenProbeOcclusionFoliageStrength: 0.4 }), 0.4)
  assert.equal(
    strength({ screenProbes: 'ultra', screenProbeOcclusionFoliageStrength: 0 }),
    0,
    'zero is a strength, not the row',
  )
})

test('the quality scales the rays and the tile, the update speed the history, each as the reference truncates and rounds it', () => {
  assert.equal(screenProbeSettings({ screenProbeQuality: 4 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 100 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 0.05 }).tracingResolution, 4)
  // The product of the square root of the quality and the rays is truncated, then rounded up to a power of two: 8.39 is 8 rays
  // a side, not 16, and 4.38 is 4, not 8.
  assert.equal(screenProbeSettings({ screenProbeQuality: 1.1 }).tracingResolution, 8)
  assert.equal(screenProbeSettings({ screenProbeQuality: 0.3 }).tracingResolution, 4)
  assert.equal(screenProbeSettings({ screenProbeQuality: 1.3 }).tracingResolution, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 5.9 }).downsampleFactor, 16)
  assert.equal(screenProbeSettings({ screenProbeQuality: 6 }).downsampleFactor, 8)
  assert.deepEqual(
    [
      screenProbeSettings().values.screenProbeMaxRayDirections,
      screenProbeSettings({ screenProbeMaxRayDirections: 3 }).values.screenProbeMaxRayDirections,
    ],
    [8, 3],
  )
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 4 }).maxFramesAccumulated, 5)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 1000 }).maxFramesAccumulated, 4)
  assert.equal(screenProbeSettings({ screenProbeUpdateSpeed: 0.001 }).maxFramesAccumulated, 14)
  // A history longer than fifteen frames is the reference's too: the count is coded as a share of it in four bits.
  assert.equal(
    screenProbeSettings({ screenProbeMaxFramesAccumulated: 30, screenProbeUpdateSpeed: 0.5 })
      .maxFramesAccumulated,
    42,
  )
  // The gather's side: the tracing one over the whole number nearest the inverse of the scale (2.5 rounds to 3: 8 / 3 is 2).
  const gather = (screenProbeGatherScale: number, screenProbeQuality = 1) =>
    screenProbeSettings({ screenProbeGatherScale, screenProbeQuality }).gatherResolution
  assert.deepEqual(
    [gather(1), gather(0.5), gather(0.4), gather(0.1), gather(0.5, 4)],
    [8, 4, 2, 1, 8],
  )
  // The light the rays follow needs the importance sampling on.
  assert.equal(
    screenProbeSettings({ screenProbeImportanceSampling: false }).importanceLighting,
    false,
  )
})

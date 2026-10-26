import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'
import { DEFAULT_TEMPORAL_AA_LEVEL } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  RASTER_RULES,
} from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import {
  DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  DEFAULT_STREAMING_MAX_PENDING_PAGES,
  DEFAULT_STREAMING_BANDWIDTH_LIMIT,
  DEFAULT_STREAMING_MAX_REQUESTS,
  DEFAULT_STREAMING_MIN_REQUESTS,
  DEFAULT_STREAMING_NUM_RETRIES,
  DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_SCALE,
} from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { WORLD_STREAMING_RULES } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import { ANIMATION_RULES } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { HIZ_RULES } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { TESSELLATION_RULES } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { BLOOM_RULES } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { FILM_RULES, tonemapperSharpness } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { COLOR_GRADING_RULES } from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { SINGLE_LAYER_WATER_RULES } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { SUBSURFACE_SCATTERING_RULES } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { TRANSLUCENCY_GI_RULES } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { LIGHT_FUNCTION_RULES } from '../../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { SURFACE_CACHE_RULES } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { createWorldSettings } from './settings.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number | string> = {
  pixelError: DEFAULT_PIXEL_ERROR,
  antialiasing: DEFAULT_TEMPORAL_AA_LEVEL, // `WorldOptions.temporalAntialiasing`'s default
  bounce: true, // `world.bounce`'s default
  softwareRaster: RASTER_RULES.softwareRaster.default, // on, the reference's own
  hardwareRasterEdgePixels: DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  depthBucketing: RASTER_RULES.depthBucketing.default, // on, the reference's own
  depthBucketsMinZ: RASTER_RULES.depthBucketsMinZ.default, // 1000 cm of the reference, in metres
  depthBucketsMaxZ: RASTER_RULES.depthBucketsMaxZ.default, // 100000 cm of the reference, in metres
  streamingMaxPendingPages: DEFAULT_STREAMING_MAX_PENDING_PAGES,
  streamingMaxInstallsPerFrame: DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  streamingQualityMinPoolPercent: DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  streamingQualityMaxPoolPercent: DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  streamingQualityMinScale: DEFAULT_STREAMING_QUALITY_MIN_SCALE,
  streamingNumRetries: DEFAULT_STREAMING_NUM_RETRIES,
  streamingMinRequests: DEFAULT_STREAMING_MIN_REQUESTS,
  streamingMaxRequests: DEFAULT_STREAMING_MAX_REQUESTS,
  streamingBandwidthLimit: DEFAULT_STREAMING_BANDWIDTH_LIMIT, // none: no read is simulated slower
  // The partition's streaming and the HLOD warm-up: each its contract's default.
  ...resolveSettings(WORLD_STREAMING_RULES, {}),
  // The cut's occlusion, culls and level-of-detail bias: each its contract's default.
  ...resolveSettings(CUT_RULES, {}),
  // The dynamic resolution's heuristic: the reference's own defaults, the budget the frame cap's.
  ...resolveSettings(DYNAMIC_RESOLUTION_RULES, {}),
  // The animation the GPU plays: each its contract's default.
  ...resolveSettings(ANIMATION_RULES, {}),
  // The material shading's bins: each its contract's default.
  ...resolveSettings(SHADING_RULES, {}),
  // The exposure's bias, range, histogram, shares, speeds and luminance, and the local
  // exposure's contrasts, detail, blur, grey and thresholds: each its contract's default.
  ...resolveSettings(EXPOSURE_RULES, {}),
  // The temporal pass's thin geometry detection: off, its contract's default.
  ...resolveSettings(TEMPORAL_RULES, {}),
  // The tessellation of displaced materials: each its contract's default.
  ...resolveSettings(TESSELLATION_RULES, {}),
  // The depth pyramid's trace, transparent fold and transparent test: each its contract's default.
  ...resolveSettings(HIZ_RULES, {}),
  // The volumetric lightmap: read, its contract's default.
  ...resolveSettings(VOLUMETRIC_LIGHTMAP_RULES, {}),
  // The sky's quality settings: each its rule's default.
  ...resolveSettings(SKY_QUALITY_RULES, {}),
  // The sun's shadows: the distance scale 1, the far-shadow culling on, its reach the merged shells.
  ...resolveSettings(SHADOW_RULES, {}),
  // The motion blur's drawing: the quality `veryHigh`, the half-resolution input on, the rest off.
  ...resolveSettings(MOTION_BLUR_RULES, {}),
  // The bloom's drawing: all six Gaussian levels, no cross, the convolution at half the width, the
  // local exposure applied to the image it reads and its kernel's transform kept.
  ...resolveSettings(BLOOM_RULES, {}),
  // The Gaussian blur's drawing: no blur halved (a threshold of 100), the full reach, 32 reads a pass.
  ...resolveSettings(GAUSSIAN_BLUR_RULES, {}),
  // The film effects: their contract's defaults, the reference's (below).
  ...resolveSettings(FILM_RULES, {}),
  // The colour grading: their contract's defaults, the reference's (below).
  ...resolveSettings(COLOR_GRADING_RULES, {}),
  // The volumetric fog: the quality level `max`, its other settings the contract's defaults.
  ...resolveSettings(VOLUMETRIC_FOG_RULES, {}),
  // The translucency lighting volume: the reference's cascades, blur and history, in metres.
  ...resolveSettings(TRANSLUCENCY_VOLUME_RULES, {}),
  ...resolveSettings(TRANSLUCENCY_GI_RULES, {}),
  ...resolveSettings(SUBSURFACE_SCATTERING_RULES, {}),
  // The single-layer water: the reference's defaults.
  ...resolveSettings(SINGLE_LAYER_WATER_RULES, {}),
  // The screen probes: the level `ultra`, its other settings the contract's defaults.
  ...resolveSettings(SCREEN_PROBE_RULES, {}),
  // The reflections' trace: the reference's 50 screen iterations and 256 steps a ring.
  ...resolveSettings(REFLECTION_RULES, {}),
  // The screen-space ambient occlusion: the reference's post-process defaults, in metres.
  ...resolveSettings(AMBIENT_OCCLUSION_RULES, {}),
  // The light functions: the reference's atlas defaults, the translucent layers off.
  ...resolveSettings(LIGHT_FUNCTION_RULES, {}),
  // The global distance field: the reference's clipmaps, update rhythm and atlas budgets.
  ...resolveSettings(GLOBAL_DISTANCE_FIELD_RULES, {}),
  // The surface cache: the reference's atlas, card law, capture budgets and feedback.
  ...resolveSettings(SURFACE_CACHE_RULES, {}),
  // The distance-field occlusion: the reference's defaults.
  ...resolveSettings(DISTANCE_FIELD_OCCLUSION_RULES, {}),
  // The depth of field's drawing: on, the gather at half size, four rings, the median
  // post-filter, the background's scatter occluding, the recombine at its low quality.
  ...resolveSettings(DEPTH_OF_FIELD_RULES, {}),
}

test('every default is the constant the engine reads today, and a fresh registry resolves it', () => {
  const settings = createWorldSettings()
  assert.deepEqual(Object.keys(WORLD_SETTINGS).sort(), Object.keys(TODAY).sort())
  for (const [name, value] of Object.entries(TODAY)) {
    const key = name as keyof typeof WORLD_SETTINGS
    assert.equal(WORLD_SETTINGS[key].default, value, name)
    assert.equal(settings.get(key), value, name)
  }
})

test('every default lies within its own bounds', () => {
  for (const [name, entry] of Object.entries(WORLD_SETTINGS)) {
    if (entry.kind === 'flag') assert.equal(typeof entry.default, 'boolean', name)
    else if (entry.kind === 'choice')
      assert.ok(
        entry.choices.some((choice) => choice === entry.default),
        `${name} out`,
      )
    else
      assert.ok(entry.default >= entry.range[0] && entry.default <= entry.range[1], `${name} out`)
  }
})

test('the tonemapper’s sharpening is the override from 0 up, the scene’s below it, read from 0 to 10', () => {
  assert.equal(FILM_RULES.tonemapperSharpen.default, -1, 'the scene’s, by default')
  assert.equal(tonemapperSharpness(-1, 0.5), 0.5)
  assert.equal(tonemapperSharpness(0, 0.5), 0, 'an override of 0 turns it off')
  assert.equal(tonemapperSharpness(3, 0.5), 3)
  assert.equal(tonemapperSharpness(20, 0), 10)
  assert.equal(tonemapperSharpness(-1, 20), 10)
})

test('the image effects’ levels write the bloom’s quality and resolution and the Gaussian blur’s threshold and reach, the top level none', () => {
  // The reference's scalability rows: five Gaussian levels at the two coarser presets, the convolution at
  // 25, 35.355 and 50 percent of the width, the fast blur from a radius of 0, 2, 3, the reach at 0.6, 0.7, 0.8.
  const rows = [
    ['smooth', 'high', 25, 0, 0.6],
    ['balanced', 'high', 35.355, 2, 0.7],
    ['fine', 'highest', 50, 3, 0.8],
    ['max', undefined, undefined, undefined, undefined], // the defaults: six levels, half the width, none halved
  ] as const
  const fields = ['bloomQuality', 'bloomScreenPercentage'] as const
  const blur = ['gaussianFastBlurThreshold', 'gaussianSampleScale'] as const
  for (const [level, ...values] of rows) {
    const written: Record<string, unknown> = QUALITY_LEVELS.imageEffects[level]
    assert.deepEqual(
      [...fields, ...blur].map((field) => written[field]),
      values,
      level,
    )
  }
  // The cross, the loop mode and the two switches are no level's.
  const named = Object.keys(QUALITY_LEVELS.imageEffects.smooth)
  assert.deepEqual(
    named.filter((name) => /^(bloom|gaussian)/.test(name)),
    [...fields, ...blur],
  )
})

test('the film effects are the reference’s defaults: the grain, the fringe and the tint off, the vignette and the dither on', () => {
  assert.deepEqual(resolveSettings(FILM_RULES, {}), {
    ...{ filmGrainIntensity: 0, filmGrainIntensityShadows: 1, filmGrainIntensityMidtones: 1 },
    ...{ filmGrainIntensityHighlights: 1, filmGrainShadowsMax: 0.09, filmGrainHighlightsMin: 0.5 },
    ...{ filmGrainHighlightsMax: 1, filmGrainScaleX: 1, filmGrainScaleY: 1 },
    ...{ filmGrainSequenceLength: 97, chromaticAberration: 0, chromaticAberrationStartOffset: 0 },
    ...{ chromaticAberrationQuality: 'high', chromaticAberrationMax: -1 },
    ...{ vignetteType: 'cosineFourthLaw', vignetteColorRed: 0, vignetteColorGreen: 0 },
    ...{ vignetteColorBlue: 0, vignetteCenterX: 0.5, vignetteCenterY: 0.5, vignetteSizeX: 1 },
    ...{ vignetteSizeY: 1, vignetteSoftness: 5, tonemapperQuality: 5, tonemapperSharpen: -1 },
    ...{ sceneColorTintRed: 1, sceneColorTintGreen: 1, sceneColorTintBlue: 1 },
    ...{ quantizationDitheringBits: 0, propagateAlpha: false, primitiveAlphaHoldout: false },
    translucencyHoldoutLocation: 'beforeDepthOfField',
  })
})

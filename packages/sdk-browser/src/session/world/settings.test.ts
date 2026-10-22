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
import { ANIMATION_RULES } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { BLOOM_RULES } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { FILM_RULES, tonemapperSharpness } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { TESSELLATION_RULES } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import {
  DEPTH_OF_FIELD_PRESET_LEVELS,
  DEPTH_OF_FIELD_RULES,
} from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { resolveDepthOfField } from '../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import { circleRatio, planDepthOfField, tilesOf } from '../../post/effects/depthOfField/dofPlan.ts'
import { cocRadiusAt } from '../../post/effects/depthOfField/cocModel.ts'
import type { MeasuredWorld } from '../explorer.ts'
import { sessionOptions } from './options.ts'
import { createWorldSettings } from './settings.ts'
import { worldSwitches } from './switches.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number | string> = {
  pixelError: DEFAULT_PIXEL_ERROR,
  antialiasing: DEFAULT_TEMPORAL_AA_LEVEL, // `WorldOptions.temporalAntialiasing`'s default
  bounce: true, // `world.bounce`'s default
  softwareRaster: RASTER_RULES.softwareRaster.default, // on, the reference's own
  hardwareRasterEdgePixels: DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
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
  // The animation the GPU plays: each its contract's default.
  ...resolveSettings(ANIMATION_RULES, {}),
  // The material shading's bins: each its contract's default.
  ...resolveSettings(SHADING_RULES, {}),
  // The exposure's bias, range, histogram, shares, speeds and luminance, and the local
  // exposure's contrasts, detail, blur, grey and thresholds: each its contract's default.
  ...resolveSettings(EXPOSURE_RULES, {}),
  // The temporal pass's thin geometry detection: off, its contract's default.
  ...resolveSettings(TEMPORAL_RULES, {}),
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
  // The volumetric fog: the quality level `max`, its other settings the contract's defaults.
  ...resolveSettings(VOLUMETRIC_FOG_RULES, {}),
  // The screen probes: the level `ultra`, its other settings the contract's defaults.
  ...resolveSettings(SCREEN_PROBE_RULES, {}),
  // The reflections' trace: the reference's 50 screen iterations and 256 steps a ring.
  ...resolveSettings(REFLECTION_RULES, {}),
  // The screen-space ambient occlusion: the reference's post-process defaults, in metres.
  ...resolveSettings(AMBIENT_OCCLUSION_RULES, {}),
  // The depth of field's drawing: on, the gather at half size, four rings, the median
  // post-filter, the background's scatter occluding, the recombine at its low quality.
  ...resolveSettings(DEPTH_OF_FIELD_RULES, {}),
  // The displaced surfaces' tessellation: on, a micro-triangle two pixels across, five patches a
  // group, two mebi-patches for the splitting queue and for the visible list.
  ...resolveSettings(TESSELLATION_RULES, {}),
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

test('the image effects’ levels write the depth of field’s gather and its accumulation, the top level none', () => {
  const fields = [
    'depthOfFieldQuality',
    'depthOfFieldAccumulator',
    'depthOfFieldRingCount',
    'depthOfFieldForegroundScatter',
    'depthOfFieldBackgroundScatter',
    'depthOfFieldRecombine',
    'depthOfFieldMaxForegroundRadius',
    'depthOfFieldTemporalQuality',
  ] as const
  // The reference's rows: off at the lowest, then fewer rings, less scatter, a smaller circle, the faster accumulation.
  const none = undefined // not written
  const rows = {
    smooth: ['off', none, none, none, none, none, none, none],
    balanced: [none, 'low', 3, 'off', 'off', 'off', 0.006, 'low'],
    fine: [none, 'low', 4, 'additive', 'additive', 'off', 0.012, 'low'],
    max: Array(8).fill(none),
  }
  for (const [level, expected] of Object.entries(rows)) {
    const written: Record<string, unknown> = QUALITY_LEVELS.imageEffects[level as keyof typeof rows]
    const got = fields.map((name) => written[name])
    assert.deepEqual(got, expected, level)
  }
})

test('the depth of field is drawn at the reference’s third level by default, the levels naming its settings only', () => {
  const d = resolveSettings(DEPTH_OF_FIELD_RULES, {})
  assert.deepEqual(
    [d.depthOfFieldQuality, d.depthOfFieldGatherDivisor, d.depthOfFieldAccumulator],
    ['on', 2, 'high'],
  )
  assert.deepEqual(
    [d.depthOfFieldPostfilter, d.depthOfFieldRingCount, d.depthOfFieldRecombine],
    ['median', 4, 'low'],
  )
  assert.deepEqual(
    [d.depthOfFieldForegroundScatter, d.depthOfFieldBackgroundScatter, d.depthOfFieldScatterBokeh],
    ['additive', 'occlusion', true],
  )
  assert.deepEqual([d.depthOfFieldMaxForegroundRadius, d.depthOfFieldScatterMaxRatio], [0.025, 0.1])
  assert.deepEqual([d.depthOfFieldTemporalQuality, d.depthOfFieldBilateralStrength], ['high', 0])
  const temporal = Object.keys(d).filter((name) => name.includes('Temporal'))
  assert.equal(temporal.length, 2, 'no filter size')
  for (const level of Object.values(DEPTH_OF_FIELD_PRESET_LEVELS))
    for (const name of Object.keys(level)) assert.ok(name in DEPTH_OF_FIELD_RULES, name)
})

// The depth of field's drawing is a family by rule (`DEPTH_OF_FIELD_RULES`): written once, in place after.
test('how the depth of field is drawn is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  const setters = { setDepthOfField: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ depthOfFieldQuality: 'off' }, () => runtime, { last: null })
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'off')
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'depthOfFieldQuality'),
    [['depthOfFieldQuality', 'off']],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.depthOfField = { depthOfFieldQuality: 'on' }
  switches.depthOfField = { depthOfFieldQuality: 'on' }
  assert.deepEqual(written, [['depthOfFieldQuality', 'on']], 'once, in place')
  switches.depthOfField = { depthOfFieldQuality: null }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on', 'given back: the preset’s')
  switches.depthOfField = { depthOfFieldQuality: false }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'off')
  switches.depthOfField = { depthOfFieldQuality: true }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on')
  assert.throws(() => (switches.depthOfField = { depthOfFieldQuality: 'high' as never }), /high/)
  switches.settings.set('depthOfFieldQuality', 'off', 'quality')
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on', 'the page over the preset')
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
    quantizationDitheringBits: 0,
  })
})

// What the settings decide of one image's draw: its plan, on a 1920 × 1080 image, a 40-degree field.
const planOf = (options: object, settings: object = {}, drawn: object = {}) =>
  planDepthOfField({
    cotHorizontal: 1.5455,
    cotVertical: 2.7474774,
    volume: resolveDepthOfField(options),
    settings: resolveSettings(DEPTH_OF_FIELD_RULES, settings),
    image: [1920, 1080],
    extent: [1920, 1080],
    display: [1920, 1080],
    near: 0.1,
    temporal: false,
    ...drawn,
  })
test('the plan draws nothing under a pixel of blur, and gathers the layers the circles need', () => {
  assert.equal(planOf({}).idle, true, 'no focus, no depth blur')
  assert.equal(planOf({ depthBlurRadius: 0.02 }).idle, true, 'a blur under 1/20 of a pixel')
  const lens = { focusDistance: 1, aperture: 1.2 }
  const wide = planOf(lens)
  assert.equal(`${wide.gather}/${tilesOf(wide)}/${wide.mips}`, '960,540/120,68/2')
  assert.equal(-cocRadiusAt(wide.coc, 0.1, 960), 24, 'held to the largest')
  assert.equal(wide.convolutions.map((c) => c.layer).join(), 'foreground,hole,slight,background')
  // Circles of 24 texels reach 4 tiles: a pass reads 3, so a second pass spreads the last one.
  assert.equal(
    wide.dilations.map((d) => d.mode + d.radius).join(),
    'minMax3,minMax1,minAbs3,minAbs1',
  )
  assert.equal(planOf({ depthBlurRadius: 6 }).convolutions.length, 3, 'a background alone')
  assert.deepEqual(planOf({ focusDistance: 5, aperture: 32 }).dilations, [
    { mode: 'standalone', radius: 1, multiplier: 1 },
  ])
  const full = planOf(lens, { depthOfFieldGatherDivisor: 1 })
  assert.deepEqual(full.gather, [1920, 1080])
  const up = planOf(lens, {}, { temporal: true, display: [3840, 2160] })
  const sizes = [up.gather, up.pre, up.reduced, circleRatio(up)].join('/')
  assert.equal(sizes, '960,540/1920,1080/1920,1080/0.5')
  const low = planOf(lens, { depthOfFieldAccumulator: 'low' })
  assert.deepEqual([low.mips, low.convolutions[0].quality], [wide.mips + 1, 0])
})

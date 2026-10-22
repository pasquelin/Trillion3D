import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type QualityLevels,
} from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { QUALITY_GROUPS } from '../../../../sdk-core/src/runtime/renderSettings.ts'
import { renderScaleBounds, type RenderScale } from '../../frame/scale/renderScaleOption.ts'
import { createWorldQuality, renderScaleOf, type WorldQualityOptions } from './quality.ts'
import { createWorldSettings } from './settings.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** The engine's table, with the edge smoothing's and the view distance's levels written as a level
 *  of S35 would: the mechanism is proven on values it can see. */
const LEVELS: QualityLevels = {
  ...QUALITY_LEVELS,
  edgeSmoothing: {
    smooth: { antialiasing: 'off' },
    balanced: {},
    fine: {},
    max: {},
  },
  viewDistance: {
    smooth: { ...QUALITY_LEVELS.viewDistance.smooth, pixelError: 8 },
    balanced: { ...QUALITY_LEVELS.viewDistance.balanced, pixelError: 4 },
    fine: { ...QUALITY_LEVELS.viewDistance.fine, pixelError: 1 },
    max: {},
  },
}

function quality(options?: WorldQualityOptions, asked: RenderScale = 'auto') {
  const settings = createWorldSettings()
  const frame = {
    last: null as { renderWidth: number | null; renderHeight: number | null } | null,
  }
  const scale = {
    asked: () => asked,
    ask: (next: RenderScale) => void (asked = next),
    drawn: () => frame.last,
  }
  return { settings, frame, quality: createWorldQuality(settings, scale, options, LEVELS) }
}

test('by default the preset reads max and every setting resolves to its default', () => {
  const { settings, quality: q } = quality()
  assert.equal(q.preset, 'max')
  for (const name of Object.keys(WORLD_SETTINGS) as (keyof typeof WORLD_SETTINGS)[])
    assert.equal(settings.get(name), WORLD_SETTINGS[name].default, name)
  assert.deepEqual(q.resolution, { mode: 'native', dynamic: true }, "R0's 'auto', 50 to 100 %")
})

test('a group the page set holds through every preset change', () => {
  const { settings, quality: q } = quality()
  q.preset = 'balanced'
  assert.equal(settings.get('pixelError'), 4)
  q.set('viewDistance', 'fine')
  q.preset = 'smooth'
  assert.equal(q.get('viewDistance'), 'fine')
  assert.equal(settings.get('pixelError'), 1, 'the page level, over the preset')
  assert.equal(settings.get('antialiasing'), 'off', 'the other groups follow the preset')
  assert.equal(q.preset, 'custom')
  q.set('viewDistance', 'preset')
  assert.equal(q.get('viewDistance'), 'smooth')
  assert.equal(settings.get('pixelError'), 8, 'given back, the group follows the preset')
  assert.equal(q.preset, 'smooth')
})

test('a page level of max writes the defaults over a coarser preset', () => {
  const { settings, quality: q } = quality({ preset: 'smooth', groups: { viewDistance: 'max' } })
  assert.equal(settings.get('pixelError'), WORLD_SETTINGS.pixelError.default)
  assert.equal(settings.get('antialiasing'), 'off')
  q.preset = 'max'
  assert.equal(q.preset, 'max', 'the page level is the preset level: not custom')
})

test('a value the page set by hand is not overwritten by a preset', () => {
  const { settings, quality: q } = quality()
  settings.set('pixelError', 2, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('pixelError'), 2)
  assert.equal(settings.source('pixelError'), 'page')
})

test("the shadows' levels write the sun's shadow distance scale and the edge's three settings, and the page's holds", () => {
  const { settings, quality: q } = quality()
  // The reference's four shadow rows: the scale, the near levels, their overlap, the far field.
  const rows = {
    smooth: [0.6, 1, 0, false],
    balanced: [0.7, 1, 0.25, false],
    fine: [0.85, 4, 0.8, true],
    max: [1, 10, 1, true],
  }
  for (const [preset, row] of Object.entries(rows)) {
    q.preset = preset as keyof typeof rows
    const fields = [
      'shadowDistanceScale',
      'shadowNearLevels',
      'shadowOverlapScale',
      'shadowFarField',
    ]
    assert.deepEqual(
      fields.map((field) => settings.get(field as never)),
      row,
      preset,
    )
  }
  // The culling's switches are no level's: a page's value holds through a group given back.
  settings.set('farShadowCulling', false, 'page')
  settings.set('farShadowCullsAllMeshes', true, 'page')
  q.set('shadows', 'fine')
  assert.equal(settings.get('shadowDistanceScale'), 0.85)
  q.set('shadows', 'preset')
  assert.equal(settings.get('farShadowCulling'), false)
  assert.equal(settings.get('farShadowCullsAllMeshes'), true)
  settings.set('shadowDistanceScale', 1.5, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('shadowDistanceScale'), 1.5, 'the page, over the preset')
})

test("the shadows' levels write the volumetric fog's quality, and each source holds over the one before it", () => {
  const { settings, quality: q } = quality()
  // No volume at the two lowest presets, the grid of the `low` level at `fine`, and the default
  // (`high`) where the top preset writes nothing.
  const levels = { smooth: 'off', balanced: 'off', fine: 'low', max: 'high' }
  for (const [preset, level] of Object.entries(levels)) {
    q.preset = preset as keyof typeof levels
    assert.equal(settings.get('volumetricFogQuality'), level, preset)
  }
  // The fog's other settings are no level's.
  q.preset = 'smooth'
  assert.equal(settings.get('volumetricFogHistoryShare'), 0.9)
  // The scene's value is under the preset's, the page's over it, the editor's over the page's.
  settings.set('volumetricFogQuality', 'ultra', 'scene')
  assert.equal(settings.get('volumetricFogQuality'), 'off', 'the preset, over the scene')
  q.preset = 'max'
  assert.equal(settings.get('volumetricFogQuality'), 'ultra', 'the scene, where no level writes')
  q.preset = 'smooth'
  settings.set('volumetricFogQuality', 'low', 'page')
  assert.equal(settings.get('volumetricFogQuality'), 'low', 'the page, over the preset')
  settings.set('volumetricFogQuality', 'ultra', 'editor')
  assert.equal(settings.get('volumetricFogQuality'), 'ultra', 'the editor, over the page')
})

test("the view distance's levels write the objects' draw distance scale, and the page's holds", () => {
  const { settings, quality: q } = quality()
  const scales = { smooth: 0.4, balanced: 0.6, fine: 0.8, max: 1 }
  for (const [preset, scale] of Object.entries(scales)) {
    q.preset = preset as keyof typeof scales
    assert.equal(settings.get('cutViewDistanceScale'), scale, preset)
  }
  // The cull's switch is no level's: a page's value holds through a group given back.
  settings.set('cutDrawDistanceCulling', false, 'page')
  q.set('viewDistance', 'smooth')
  assert.equal(settings.get('cutViewDistanceScale'), 0.4)
  q.set('viewDistance', 'preset')
  assert.equal(settings.get('cutDrawDistanceCulling'), false)
  settings.set('cutViewDistanceScale', 3, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('cutViewDistanceScale'), 3, 'the page, over the preset')
})

test("the indirect light's levels write the screen probes' level alone, and the page's holds", () => {
  const { settings, quality: q } = quality()
  const levels = { smooth: 'off', balanced: 'off', fine: 'high', max: 'ultra' }
  for (const [preset, level] of Object.entries(levels)) {
    q.preset = preset as keyof typeof levels
    assert.equal(settings.get('screenProbes'), level, preset)
  }
  // The probes' other settings are no level's: the page's value holds through a group given back.
  settings.set('screenProbeMeshTraces', true, 'page')
  q.set('indirectLight', 'smooth')
  assert.equal(settings.get('screenProbes'), 'off')
  q.set('indirectLight', 'preset')
  assert.equal(settings.get('screenProbeMeshTraces'), true)
  settings.set('screenProbes', 'cinematic', 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('screenProbes'), 'cinematic', 'the page, over the preset')
})

test("the image effects' levels write the motion blur's quality and gather, the tonemapper's quality and the fringe's, the page's holds", () => {
  const { settings, quality: q } = quality()
  const levels = {
    smooth: ['off', true, 0, 'off'],
    balanced: ['high', true, 2, 'off'],
    fine: ['high', false, 5, 'high'],
    max: ['veryHigh', false, 5, 'high'],
  }
  const names = [
    'motionBlurQuality',
    'motionBlurHalfResGather',
    'tonemapperQuality',
    'chromaticAberrationQuality',
  ]
  for (const [preset, expected] of Object.entries(levels)) {
    q.preset = preset as keyof typeof levels
    assert.deepEqual(
      names.map((name) => settings.get(name as 'bounce')),
      expected,
      preset,
    )
  }
  // The half-resolution input, the second pass and the drawn spread are no level's.
  settings.set('motionBlurSeparable', true, 'page')
  q.set('imageEffects', 'fine')
  q.set('imageEffects', 'preset')
  assert.equal(settings.get('motionBlurSeparable'), true)
  assert.equal(settings.get('motionBlurHalfResInput'), true)
  settings.set('motionBlurQuality', 'low', 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('motionBlurQuality'), 'low', 'the page, over the preset')
  assert.equal(settings.get('motionBlurHalfResGather'), true, 'the preset, under no page value')
})

test("the image effects' levels write the occlusion's resolutions, ceiling, climb and radius scale, the page's holds", () => {
  const { settings, quality: q } = quality()
  const read = () => [
    settings.get('ambientOcclusionLevels'),
    settings.get('ambientOcclusionMaxQuality'),
    settings.get('ambientOcclusionMipLevelFactor'),
    settings.get('ambientOcclusionRadiusScale'),
  ]
  // The reference's four post-process levels; `max` is the registry's defaults.
  const levels = {
    smooth: [0, 0, 1, 1.2],
    balanced: [-1, 60, 1, 1.5],
    fine: [-1, 100, 0.6, 1.5],
    max: [-1, 100, 0.4, 1],
  }
  for (const [preset, expected] of Object.entries(levels)) {
    q.preset = preset as keyof typeof levels
    assert.deepEqual(read(), expected, preset)
  }
  // The intensity, the radius and the rest are no level's.
  settings.set('ambientOcclusionIntensity', 0.8, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('ambientOcclusionIntensity'), 0.8)
  assert.equal(settings.get('ambientOcclusionRadius'), 2)
  settings.set('ambientOcclusionLevels', 2, 'page')
  assert.equal(settings.get('ambientOcclusionLevels'), 2, 'the page, over the preset')
  assert.equal(settings.get('ambientOcclusionRadiusScale'), 1.2, 'the preset, under no page value')
})

test('the resolution goes through the render scale: a mode fixed, or dynamic below it', () => {
  const { quality: q } = quality()
  q.resolution = { mode: 'fast' }
  assert.deepEqual(renderScaleBounds(renderScaleOf({ mode: 'fast' }), 3840 * 2160), {
    auto: false,
    min: 0.5,
    max: 0.5,
  })
  assert.deepEqual(q.resolution, { mode: 'fast', dynamic: false })
  q.resolution = { mode: 'native', dynamic: true }
  assert.equal(renderScaleOf(q.resolution), 'auto', 'the engine’s own dynamic resolution')
  q.resolution = { mode: 'fast', dynamic: true }
  assert.deepEqual(renderScaleOf(q.resolution), { min: 0.25, max: 0.5 })
  q.resolution = { mode: 'native', scale: 0.8 }
  assert.deepEqual(q.resolution, { mode: 'native', scale: 0.8, dynamic: false })
  assert.throws(() => (q.resolution = { mode: 'ultra' as never }), /QUALITY_RESOLUTION/)
})

test('levels() lists every group and level with the values they resolve to', () => {
  const { quality: q } = quality()
  const table = q.levels()
  assert.deepEqual(table.presets, ['smooth', 'balanced', 'fine', 'max'])
  assert.equal(table.groups.viewDistance.fine.pixelError, 1)
  assert.equal(table.groups.viewDistance.max.pixelError, WORLD_SETTINGS.pixelError.default)
  assert.equal(table.groups.indirectLight.max.bounce, true)
  assert.equal(table.resolution.fast, 0.5)
})

test('an unknown preset, group or level is refused by name', () => {
  const { quality: q } = quality()
  assert.throws(() => (q.preset = 'ultra' as never), /QUALITY_PRESET/)
  assert.throws(() => q.set('sound' as never, 'max'), /QUALITY_GROUP/)
  assert.throws(() => q.set('shadows', 'ultra' as never), /QUALITY_LEVEL/)
})

test('every level writes settings of its own group that a preset may write, within bounds', () => {
  const settings = createWorldSettings()
  for (const group of QUALITY_GROUPS)
    for (const level of QUALITY_PRESETS)
      for (const [name, value] of Object.entries(QUALITY_LEVELS[group][level])) {
        const entry = WORLD_SETTINGS[name as keyof typeof WORLD_SETTINGS]
        assert.equal(entry?.group, group, `${group}.${level}: ${name}`)
        settings.set(name as keyof typeof WORLD_SETTINGS, value as never, 'quality')
      }
  for (const group of QUALITY_GROUPS)
    assert.deepEqual(QUALITY_LEVELS[group].max, {}, `${group}: max is today's defaults`)
})

test('renderSize is the size the last frame says it was drawn at, none before one', () => {
  const { frame, quality: q } = quality()
  assert.equal(q.renderSize, null)
  frame.last = { renderWidth: null, renderHeight: null }
  assert.equal(q.renderSize, null, 'an engine that does not say it')
  frame.last = { renderWidth: 1728, renderHeight: 1112 }
  assert.deepEqual(q.renderSize, { width: 1728, height: 1112 })
})

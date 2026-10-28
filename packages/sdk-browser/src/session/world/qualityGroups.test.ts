import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quality } from './quality.fixture.ts'

test("the shadows' levels write the sun's shadow distance scale and the edge's three settings, and the page's holds", () => {
  const { settings, quality: q } = quality()
  // The reference's five shadow rows: the scale, the near levels, their overlap, the far field.
  const rows = {
    smooth: [0.6, 1, 0, false],
    balanced: [0.7, 1, 0.25, false],
    fine: [0.85, 4, 0.8, true],
    max: [1, 10, 1, true],
    cinematic: [1, 10, 1, true],
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
  // The culling's switch is no level's: a page's value holds through a group given back.
  settings.set('farShadowCulling', false, 'page')
  q.set('shadows', 'fine')
  assert.equal(settings.get('shadowDistanceScale'), 0.85)
  q.set('shadows', 'preset')
  assert.equal(settings.get('farShadowCulling'), false)
  settings.set('shadowDistanceScale', 1.5, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('shadowDistanceScale'), 1.5, 'the page, over the preset')
})

test("the shadows' levels write the volumetric fog's quality, and each source holds over the one before it", () => {
  const { settings, quality: q } = quality()
  // No volume at the two lowest presets, the grid of the `low` level at `fine`, the default
  // (`high`) where the top preset writes nothing, and the finest at `cinematic`.
  const levels = { smooth: 'off', balanced: 'off', fine: 'low', max: 'high', cinematic: 'ultra' }
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
  const scales = { smooth: 0.4, balanced: 0.6, fine: 0.8, max: 1, cinematic: 10 }
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

test("the indirect light's levels write the screen probes' level, the medium one the irradiance field and its rows, and the page's holds", () => {
  const { settings, quality: q } = quality()
  const levels = {
    smooth: 'off',
    balanced: 'high',
    fine: 'high',
    max: 'ultra',
    cinematic: 'cinematic',
  }
  for (const [preset, level] of Object.entries(levels)) {
    q.preset = preset as keyof typeof levels
    assert.equal(settings.get('screenProbes'), level, preset)
    // The lowest level has no diffuse global illumination at all: the bounce is written off with it, and with it alone.
    assert.equal(settings.get('bounce'), preset === 'smooth' ? false : true, `${preset} bounce`)
    // The reference's medium global illumination alone gathers by the irradiance field (`BaseScalability.ini` `GlobalIlluminationQuality@1`: `r.FinalGatherMethod=0`), with its
    // short-range occlusion row and its smaller surface cache; every other level keeps the screen probes and the cache's own rows.
    const medium = preset === 'balanced'
    assert.deepEqual(
      [
        settings.get('finalGatherMethod'),
        settings.get('screenProbeOcclusionSlices'),
        settings.get('screenProbeShortRangeAODownsampleFactor'),
        settings.get('screenProbeOcclusionFoliageStrength'),
        settings.get('surfaceCacheAtlasSize') === 2048,
      ],
      medium ? ['irradianceField', 1, 1, 1, true] : ['screenProbes', -1, -1, -1, false],
      `${preset} medium row`,
    )
  }
  // The probes' other settings are no level's: the page's value holds through a group given back.
  settings.set('screenProbeSceneTraces', false, 'page')
  q.set('indirectLight', 'smooth')
  assert.equal(settings.get('screenProbes'), 'off')
  q.set('indirectLight', 'preset')
  assert.equal(settings.get('screenProbeSceneTraces'), false)
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
    cinematic: ['veryHigh', false, 5, 'high'],
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
  // The reference's five post-process levels; `max` is the registry's defaults.
  const levels = {
    smooth: [0, 0, 1, 1.2],
    balanced: [-1, 60, 1, 1.5],
    fine: [-1, 100, 0.6, 1.5],
    max: [-1, 100, 0.4, 1],
    cinematic: [-1, 100, 0.4, 1],
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

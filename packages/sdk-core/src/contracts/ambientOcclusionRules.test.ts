// The ambient occlusion settings: their rules, their quality levels and where they draw.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
} from './ambientOcclusionOptions.ts'
import { resolveSetting, resolveSettings, type SettingRule } from './settingRules.ts'

test('the ambient occlusion settings read by their rules with the reference’s defaults, its lengths in metres', () => {
  const values = resolveSettings(AMBIENT_OCCLUSION_RULES, {})
  // The reference's post-process defaults (intensity 0.5, radius 200, fade 8000 and 5000 centimetres, power 2, bias 3,
  // quality 50, mip blend 0.6, scale 1.7, threshold 0.01) and the rows of the reference's default quality level (the level-3 row).
  assert.deepEqual(values, {
    ambientOcclusion: true,
    ambientOcclusionIntensity: 0.5,
    ambientOcclusionStaticFraction: 1,
    ambientOcclusionRadius: 2,
    ambientOcclusionRadiusInWorldSpace: false,
    ambientOcclusionFadeDistance: 80,
    ambientOcclusionFadeRadius: 50,
    ambientOcclusionPower: 2,
    ambientOcclusionBias: 3,
    ambientOcclusionQuality: 50,
    ambientOcclusionMipBlend: 0.6,
    ambientOcclusionMipScale: 1.7,
    ambientOcclusionMipThreshold: 0.01,
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 100,
    ambientOcclusionMipLevelFactor: 0.4,
    ambientOcclusionRadiusScale: 1,
    ambientOcclusionWithScreenProbes: false,
    // The pixel passes, the compute pass's smoothing on where it is made, and the reference's method (the disc search) and the horizon search's defaults: its own radius of 200 centimetres, two directions,
    // a 5 × 5 spatial filter, the thickness bias 0.5, both filters on, the temporal share 0.1.
    ambientOcclusionCompute: 0,
    ambientOcclusionComputeSmooth: true,
    ambientOcclusionMethod: 'disc',
    ambientOcclusionHorizonNormals: false,
    ambientOcclusionHorizonFilterWidth: 5,
    ambientOcclusionHorizonThickness: 0.5,
    ambientOcclusionHorizonRadius: 2,
    ambientOcclusionHorizonAngles: 2,
    ambientOcclusionHorizonPauseJitter: false,
    ambientOcclusionHorizonDownsample: false,
    ambientOcclusionHorizonTemporal: true,
    ambientOcclusionHorizonSpatial: true,
    ambientOcclusionHorizonBlend: 0.1,
  })
  for (const [field, value] of [
    ['ambientOcclusionIntensity', 1.5],
    ['ambientOcclusionPower', 0],
    ['ambientOcclusionMipBlend', 0.05],
    ['ambientOcclusionLevels', 4],
    ['ambientOcclusionRadiusScale', 20],
    ['ambientOcclusionCompute', 4],
    ['ambientOcclusionMethod', 'unknown'],
    ['ambientOcclusionHorizonAngles', 17],
    ['ambientOcclusionHorizonBlend', -0.1],
  ] as const)
    assert.throws(
      () => resolveSetting<SettingRule>(AMBIENT_OCCLUSION_RULES[field], value),
      /must be/,
      field,
    )
})

test('the quality levels write the rows of the levels under the default one, the top level none', () => {
  // The reference's default quality level is the top one of ours: `max` writes nothing, `fine` the row of the level under it.
  assert.deepEqual(Object.keys(AMBIENT_OCCLUSION_PRESET_LEVELS), [
    'smooth',
    'balanced',
    'fine',
    'cinematic',
  ])
  assert.deepEqual(AMBIENT_OCCLUSION_PRESET_LEVELS.fine, {
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 100,
    ambientOcclusionMipLevelFactor: 0.6,
    ambientOcclusionRadiusScale: 1.5,
  })
  // The cinematic level, the row above the default one, writes the defaults and the horizon search's four directions.
  assert.deepEqual(AMBIENT_OCCLUSION_PRESET_LEVELS.cinematic, {
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 100,
    ambientOcclusionMipLevelFactor: 0.4,
    ambientOcclusionRadiusScale: 1,
    ambientOcclusionHorizonAngles: 4,
  })
})

test('the ambient occlusion’s quality picks its resolutions and its samples as the reference’s does', () => {
  const settings = (
    options: Parameters<typeof resolveSettings<typeof AMBIENT_OCCLUSION_RULES>>[1],
  ) => resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options))
  // The default quality 50: two resolutions, the medium samples; the radius scaled and in centimetres.
  const normal = settings({})
  assert.deepEqual(
    [normal.quality, normal.levels, normal.shaderQuality, normal.radiusCm, normal.enabled],
    [50, 2, 2, 200, true],
  )
  // Each step of the quality: over 35 and 70 a resolution more, over 5, 25, 55 and 75 a shape more.
  const at = (ambientOcclusionQuality: number) => {
    const { levels, shaderQuality } = settings({ ambientOcclusionQuality })
    return [levels, shaderQuality]
  }
  assert.deepEqual([0, 5, 6, 25, 26, 35, 36, 55, 56, 70, 71, 75, 76, 100].map(at), [
    [1, 0],
    [1, 0],
    [1, 1],
    [1, 1],
    [1, 2],
    [1, 2],
    [2, 2],
    [2, 2],
    [2, 3],
    [2, 3],
    [3, 3],
    [3, 3],
    [3, 4],
    [3, 4],
  ])
  // The ceiling holds the quality down; a negative one names it; the levels name the resolutions.
  assert.equal(
    settings({ ambientOcclusionQuality: 90, ambientOcclusionMaxQuality: 60 }).quality,
    60,
  )
  assert.equal(settings({ ambientOcclusionMaxQuality: -80 }).quality, 80)
  assert.equal(settings({ ambientOcclusionLevels: 3 }).levels, 3)
  assert.equal(settings({ ambientOcclusionLevels: 1, ambientOcclusionQuality: 100 }).levels, 1)
  // The radius scales, in centimetres.
  assert.equal(
    settings({ ambientOcclusionRadius: 3, ambientOcclusionRadiusScale: 1.5 }).radiusCm,
    450,
  )
  // Nothing draws with the switch off, an intensity of 0, no resolution, or a radius under a tenth of a centimetre.
  for (const off of [
    { ambientOcclusion: false },
    { ambientOcclusionIntensity: 0 },
    { ambientOcclusionLevels: 0 },
    { ambientOcclusionRadius: 0.001, ambientOcclusionRadiusScale: 0.5 },
  ])
    assert.equal(settings(off).enabled, false, JSON.stringify(off))
  // The smooth level writes no resolution at all: the reference's first post-process level.
  assert.equal(settings(AMBIENT_OCCLUSION_PRESET_LEVELS.smooth).enabled, false)
  assert.equal(settings(AMBIENT_OCCLUSION_PRESET_LEVELS.balanced).enabled, true)
})

test('the compute pass makes one resolution at most, one where the setting leaves it to the quality, none where it asks none', () => {
  const settings = (
    options: Parameters<typeof resolveSettings<typeof AMBIENT_OCCLUSION_RULES>>[1],
  ) => resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options))
  const compute = (options: object) => settings({ ambientOcclusionCompute: 1, ...options })
  assert.deepEqual(
    [
      { ambientOcclusionQuality: 90 },
      { ambientOcclusionLevels: 3 },
      { ambientOcclusionLevels: 0 },
    ].map((options) => compute(options).levels),
    [1, 1, 0],
  )
  assert.deepEqual(
    [0, 1, 3].map((value) => settings({ ambientOcclusionCompute: value }).compute),
    [false, true, true],
  )
})

test('the ambient occlusion draws where no global illumination is on, or occludes the probes’ light when asked and their own is off', () => {
  const on = resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, {}))
  const asked = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionWithScreenProbes: true }),
  )
  const off = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionIntensity: 0 }),
  )
  assert.equal(ambientOcclusionMode(on, { bounce: false, shortRange: true }), 'scene')
  assert.equal(ambientOcclusionMode(on, { bounce: false, shortRange: false }), 'scene')
  // With the global illumination on, at whatever level of the screen probes, the probes' short-range occlusion replaces it: nothing, by default.
  assert.equal(ambientOcclusionMode(on, { bounce: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(on, { bounce: true, shortRange: false }), 'none')
  // Asked, and the probes' own occlusion off, it occludes their light; their own on, never.
  assert.equal(ambientOcclusionMode(asked, { bounce: true, shortRange: false }), 'probes')
  assert.equal(ambientOcclusionMode(asked, { bounce: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(off, { bounce: false, shortRange: false }), 'none')
})

test('the horizon search reads its filter, its thickness, its directions and its radius as the reference does', () => {
  const horizon = (
    options: Parameters<typeof resolveSettings<typeof AMBIENT_OCCLUSION_RULES>>[1],
  ) => resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options))
  const normal = horizon({ ambientOcclusionMethod: 'horizon' })
  assert.equal(normal.method, 'horizon')
  assert.equal(horizon({}).method, 'disc', 'the default method is the disc search')
  // The thickness is the share `1 − b²` of the horizon a lower sample leaves, held from 0 to 0.99.
  assert.deepEqual(
    [0, 0.5, 1, 3].map((b) => horizon({ ambientOcclusionHorizonThickness: b }).horizon.thickness),
    [0.99, 0.75, 0, 0],
  )
  // The filter's reach: a width of 3 and of 4 as written, any other number the 5 × 5 (a number out of 3 to 5 is no refusal).
  assert.deepEqual(
    [3, 4, 5, 6, 0, 3.5].map((width) => {
      const { filterFirst, filterLast } = horizon({
        ambientOcclusionHorizonFilterWidth: width,
      }).horizon
      return [filterFirst, filterLast]
    }),
    [
      [-1, 1],
      [-1, 2],
      [-2, 2],
      [-2, 2],
      [-2, 2],
      [-2, 2],
    ],
  )
  // The radius is read from 0 (a search that reaches nowhere), the thickness is any number: it is squared.
  const flat = horizon({ ambientOcclusionHorizonRadius: 0, ambientOcclusionHorizonThickness: -2 })
  assert.deepEqual([flat.horizon.radiusCm, flat.horizon.thickness], [0, 0])
  assert.throws(
    () => resolveSetting(AMBIENT_OCCLUSION_RULES.ambientOcclusionHorizonRadius, -1),
    /must be/,
  )
  // The radius is its own, in centimetres, whatever the disc search's is; the half-size search reduces by two.
  const own = horizon({
    ambientOcclusionHorizonRadius: 3,
    ambientOcclusionRadius: 1,
    ambientOcclusionHorizonDownsample: true,
  })
  assert.deepEqual([own.horizon.radiusCm, own.radiusCm, own.horizon.downscale], [300, 100, 2])
  assert.deepEqual(
    [normal.horizon.angles, normal.horizon.temporal, normal.horizon.spatial, normal.horizon.blend],
    [2, true, true, 0.1],
  )
})

test('the fade is resolved once for both methods: its distance, and the multiplier and the addend of the depth', () => {
  const fade = (options: object) => {
    const { fadeDistanceCm, fadeMultiplier, fadeAddend } = resolveAmbientOcclusion(
      resolveSettings(AMBIENT_OCCLUSION_RULES, options),
    )
    return [fadeDistanceCm, fadeMultiplier, fadeAddend]
  }
  // 80 m over the last 50 m, in centimetres: nothing before 30 m, all of it at 80 m.
  assert.deepEqual(fade({}), [8000, 1 / 5000, -0.6])
  // The fade radius is held to a centimetre.
  assert.deepEqual(fade({ ambientOcclusionFadeRadius: 0 }), [8000, 1, -7999])
})

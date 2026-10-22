// The ambient occlusion settings: their rules, their quality levels and where they draw.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
} from './ambientOcclusionOptions.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'

test('the ambient occlusion settings read by their rules with the reference’s defaults, its lengths in metres', () => {
  const values = resolveSettings(AMBIENT_OCCLUSION_RULES, {})
  // The reference's post-process defaults (intensity 0.5, radius 200, fade 8000 and 5000 centimetres, power 2, bias 3,
  // quality 50, mip blend 0.6, scale 1.7, threshold 0.01) and the comparison run's level-3 cvars.
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
  })
  for (const [field, value] of [
    ['ambientOcclusionIntensity', 1.5],
    ['ambientOcclusionPower', 0],
    ['ambientOcclusionMipBlend', 0.05],
    ['ambientOcclusionLevels', 4],
    ['ambientOcclusionRadiusScale', 20],
  ] as const)
    assert.throws(() => resolveSetting(AMBIENT_OCCLUSION_RULES[field], value), /must be/, field)
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

test('the ambient occlusion draws where no screen probes light the pixels, or occludes their light when asked and their own is off', () => {
  const on = resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, {}))
  const asked = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionWithScreenProbes: true }),
  )
  const off = resolveAmbientOcclusion(
    resolveSettings(AMBIENT_OCCLUSION_RULES, { ambientOcclusionIntensity: 0 }),
  )
  assert.equal(ambientOcclusionMode(on, { probes: false, shortRange: true }), 'scene')
  assert.equal(ambientOcclusionMode(on, { probes: false, shortRange: false }), 'scene')
  // With the screen probes, their short-range occlusion replaces it: nothing, by default.
  assert.equal(ambientOcclusionMode(on, { probes: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(on, { probes: true, shortRange: false }), 'none')
  // Asked, and the probes' own occlusion off, it occludes their light; their own on, never.
  assert.equal(ambientOcclusionMode(asked, { probes: true, shortRange: false }), 'probes')
  assert.equal(ambientOcclusionMode(asked, { probes: true, shortRange: true }), 'none')
  assert.equal(ambientOcclusionMode(off, { probes: false, shortRange: false }), 'none')
})

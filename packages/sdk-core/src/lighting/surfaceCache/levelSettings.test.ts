// The surface cache's settings at a level of the global illumination (`levelSettings.ts`): the rows of the reference's scalability levels over
// the settings' defaults, which a setting a host names overrides.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCREEN_PROBE_LEVELS,
  SCREEN_PROBE_PRESET_LEVELS,
  SURFACE_CACHE_LEVEL_ROWS,
} from '../../bounce/screenProbeLevels.ts'
import { resolveSettings, settingFits, type SettingRule } from '../../contracts/settingRules.ts'
import {
  SURFACE_CACHE_RULES,
  type SurfaceCacheSettings,
} from '../../contracts/surfaceCacheOptions.ts'
import { resolveSurfaceCacheSettings } from './levelSettings.ts'

const at = (level: (typeof SCREEN_PROBE_LEVELS)[number], options = {}) =>
  resolveSurfaceCacheSettings(options, level, {} as SurfaceCacheSettings)

test('the defaults are the reference’s highest levels’ row: the ultra and cinematic levels hold no row of their own', () => {
  const defaults = resolveSettings(SURFACE_CACHE_RULES, {})
  assert.deepEqual(at('ultra'), defaults)
  assert.deepEqual(at('cinematic'), defaults)
  assert.deepEqual(at('off'), defaults)
  assert.deepEqual(
    [
      defaults.surfaceCacheAtlasSize,
      defaults.surfaceCacheCardMinResolution,
      defaults.surfaceCacheDirectLightingMaxLightsPerTile,
      defaults.surfaceCacheDirectLightingUpdateFactor,
      defaults.surfaceCacheRadiosityUpdateFactor,
      defaults.surfaceCacheRadiosityProbeSpacing,
      defaults.surfaceCacheRadiosityHemisphereProbeResolution,
    ],
    [4096, 2, 8, 32, 64, 4, 4],
  )
})

test('the rays through the scene’s triangles are the reference’s: radiosity traced, its biases, the self-intersection avoidance, and no level changes them', () => {
  const defaults = resolveSettings(SURFACE_CACHE_RULES, {})
  const traced = {
    surfaceCacheRadiosityHardwareRayTracing: true,
    surfaceCacheRadiosityHardwareRayTracingBias: 0.1,
    surfaceCacheRadiosityHardwareRayTracingNormalBias: 0.1,
    surfaceCacheHardwareRayTracingAvoidSelfIntersections: 3,
    surfaceCacheHardwareRayTracingSkipBackFaceHitDistance: 5,
    surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance: 1,
    surfaceCacheHardwareRayTracingMeshSectionVisibilityTest: true,
    surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache: 10,
    surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias: 10,
  }
  for (const [field, value] of Object.entries(traced)) {
    for (const level of SCREEN_PROBE_LEVELS)
      assert.equal(at(level)[field as keyof SurfaceCacheSettings], value, `${field} at ${level}`)
    assert.equal(defaults[field as keyof SurfaceCacheSettings], value, field)
  }
  // The avoidance mode is a whole number from 0 to 3.
  const rule =
    SURFACE_CACHE_RULES.surfaceCacheHardwareRayTracingAvoidSelfIntersections as SettingRule
  assert.equal(settingFits(rule, 3), true)
  assert.equal(settingFits(rule, 4), false)
  assert.equal(settingFits(rule, 1.5), false)
  assert.equal(settingFits(rule, -1), false)
})

test('the culling of the placements the rays can meet is the reference’s: mode 3, 300 m, 1 degree, the least draw distance and the box distance on, the sky excluded, and no level changes it', () => {
  const culling = {
    rayTracingCulling: 3,
    rayTracingCullingRadius: 30000,
    rayTracingCullingAngle: 1,
    rayTracingCullingUseMinDrawDistance: true,
    rayTracingCullingUseDistanceToBox: true,
    rayTracingExcludeSky: true,
  }
  for (const [field, value] of Object.entries(culling)) {
    for (const level of SCREEN_PROBE_LEVELS)
      assert.equal(at(level)[field as keyof SurfaceCacheSettings], value, `${field} at ${level}`)
  }
  // The mode is a whole number from 0 to 3.
  const mode = SURFACE_CACHE_RULES.rayTracingCulling as SettingRule
  assert.deepEqual(
    [0, 3].map((v) => settingFits(mode, v)),
    [true, true],
  )
  assert.deepEqual(
    [4, -1, 1.5].map((v) => settingFits(mode, v)),
    [false, false, false],
  )
})

test('the high level holds the reference’s row of the atlas, the cards, the lights and the radiosity, and the balanced preset the medium one over it', () => {
  const high = at('high')
  assert.deepEqual(
    [
      high.surfaceCacheAtlasSize,
      high.surfaceCacheCardMinResolution,
      high.surfaceCacheCardMaxResolution,
      high.surfaceCacheDirectLightingMaxLightsPerTile,
      high.surfaceCacheDirectLightingUpdateFactor,
      high.surfaceCacheRadiosityUpdateFactor,
      high.surfaceCacheRadiosityProbeSpacing,
      high.surfaceCacheRadiosityHemisphereProbeResolution,
    ],
    [3584, 4, 512, 4, 64, 128, 8, 3],
  )
  const medium = at(
    'high',
    Object.fromEntries(
      Object.entries(SCREEN_PROBE_PRESET_LEVELS.balanced).filter(([name]) =>
        name.startsWith('surfaceCache'),
      ),
    ),
  )
  assert.deepEqual(
    [
      medium.surfaceCacheAtlasSize,
      medium.surfaceCacheCardTexelDensityScale,
      medium.surfaceCacheCardMaxResolution,
      medium.surfaceCacheDirectLightingUpdateFactor,
      medium.surfaceCacheRadiosityHemisphereProbeResolution,
    ],
    [2048, 50, 256, 128, 3],
  )
})

test('a setting a host names keeps its value over the level’s row, the others follow the row', () => {
  const named = at('high', { surfaceCacheAtlasSize: 1024, surfaceCacheRadiosityProbeSpacing: 2 })
  assert.deepEqual(
    [named.surfaceCacheAtlasSize, named.surfaceCacheRadiosityProbeSpacing],
    [1024, 2],
  )
  assert.equal(named.surfaceCacheDirectLightingUpdateFactor, 64)
  // A setting left out as null is not named.
  assert.equal(at('high', { surfaceCacheAtlasSize: null }).surfaceCacheAtlasSize, 3584)
})

test('every row names settings of the cache and takes values they take', () => {
  const rules = new Map<string, SettingRule>(
    Object.values(SURFACE_CACHE_RULES).map((rule) => [rule.field, rule]),
  )
  for (const level of SCREEN_PROBE_LEVELS)
    for (const [field, value] of Object.entries(SURFACE_CACHE_LEVEL_ROWS[level])) {
      const rule = rules.get(field)
      assert.ok(rule, `${level}: ${field} is a setting of the surface cache`)
      assert.ok(settingFits(rule, value), `${level}: ${field} takes ${String(value)}`)
    }
})

test('a big change of the lighting is followed at once by default, at every level, as the setting says', () => {
  for (const level of SCREEN_PROBE_LEVELS) {
    assert.equal(at(level).surfaceCachePropagateGlobalLightingChange, true, level)
    assert.equal(
      at(level, { surfaceCachePropagateGlobalLightingChange: false })
        .surfaceCachePropagateGlobalLightingChange,
      false,
      level,
    )
  }
})

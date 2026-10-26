// The surface cache's settings at a level of the global illumination (`levelSettings.ts`): the rows of the reference's scalability levels over
// the settings' defaults, which a setting a host names overrides.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SCREEN_PROBE_LEVELS, SURFACE_CACHE_LEVEL_ROWS } from '../../bounce/screenProbeLevels.ts'
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

test('the high and low levels hold the reference’s rows of the atlas, the cards, the lights and the radiosity', () => {
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
  const low = at('low')
  assert.deepEqual(
    [
      low.surfaceCacheAtlasSize,
      low.surfaceCacheCardTexelDensityScale,
      low.surfaceCacheCardMaxResolution,
      low.surfaceCacheDirectLightingUpdateFactor,
      low.surfaceCacheRadiosityHemisphereProbeResolution,
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

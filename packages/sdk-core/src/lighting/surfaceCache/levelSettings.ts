import { resolveSettingsInto } from '../../contracts/settingRules.ts'
import {
  SURFACE_CACHE_RULES,
  type SurfaceCacheOptions,
  type SurfaceCacheSettings,
} from '../../contracts/surfaceCacheOptions.ts'
import {
  SCREEN_PROBE_LEVELS,
  SURFACE_CACHE_LEVEL_ROWS,
  type ScreenProbeLevel,
} from '../../bounce/screenProbeLevels.ts'

/** The rows of the levels as lists of their fields and values, made once: a reading each image allocates nothing. */
const ROWS = Object.fromEntries(
  SCREEN_PROBE_LEVELS.map((level) => [level, Object.entries(SURFACE_CACHE_LEVEL_ROWS[level])]),
) as Record<ScreenProbeLevel, [string, number | boolean][]>

/**
 * The surface cache's settings of `options` at the level of global illumination `level`, written in `into`: each setting a host names as it
 * names it, the others the level's row (`SURFACE_CACHE_LEVEL_ROWS`) where it holds one, else the setting's default, which is the
 * highest levels' row.
 */
export function resolveSurfaceCacheSettings(
  options: SurfaceCacheOptions,
  level: ScreenProbeLevel,
  into: SurfaceCacheSettings,
) {
  resolveSettingsInto(SURFACE_CACHE_RULES, options, into)
  const named = options as Record<string, unknown>
  const out = into as Record<string, number | boolean>
  for (const [field, value] of ROWS[level]) if (named[field] == null) out[field] = value
  return into
}

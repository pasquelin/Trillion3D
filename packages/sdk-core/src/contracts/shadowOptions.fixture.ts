// The sun's shadow settings a quality preset resolves to, which the tests of `shadowOptions.ts` and
// `sunShadowOptions.ts` read.
import { QUALITY_LEVELS } from '../runtime/qualityLevels.ts'
import { resolveSettings } from './settingRules.ts'
import { SHADOW_RULES } from './shadowOptions.ts'

/** The sun's shadow settings a quality preset resolves to: the shadows group's level over the
 *  defaults. */
export const presetShadows = (level: 'smooth' | 'balanced' | 'fine' | 'max') =>
  resolveSettings(SHADOW_RULES, QUALITY_LEVELS.shadows[level] as never)

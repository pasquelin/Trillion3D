/**
 * The quality table, pure data: for each group, what each level writes over the render settings'
 * defaults (`renderSettings.ts`), and the resolution modes. A preset is one level per group, the
 * level of its own name. `max` writes nothing: it is the registry's defaults, today's constants,
 * whatever they become. The other levels write only the settings their group has wired; a level
 * whose settings are not wired yet writes nothing, and reads as `max` would.
 */
import { SKY_PRESET_LEVELS } from '../modules/sky/qualityPresets.ts'
import { QUALITY_GROUPS, type QualityGroup, type RenderSettingValue } from './renderSettings.ts'

/** The presets, coarsest first: each sets every group to the level of its own name. */
export const QUALITY_PRESETS = ['smooth', 'balanced', 'fine', 'max'] as const
/** A preset: every group at the level of its name. */
export type QualityPreset = (typeof QUALITY_PRESETS)[number]
/** A group's level: the levels share the presets' names. */
export type QualityLevel = QualityPreset
/** What one level writes: setting name to value, over the defaults. */
type QualityLevelValues = Readonly<Record<string, RenderSettingValue>>
/** Every level of every group. */
export type QualityLevels = Readonly<
  Record<QualityGroup, Readonly<Record<QualityLevel, QualityLevelValues>>>
>

/** Nothing over the defaults, at every level. */
const UNWIRED: Readonly<Record<QualityLevel, QualityLevelValues>> = {
  smooth: {},
  balanced: {},
  fine: {},
  max: {},
}

/** The engine's quality table. The edge smoothing's levels are the temporal anti-aliasing's
 *  (`TEMPORAL_AA_LEVELS`): `max` writes nothing, the default level `max`, and each coarser preset one level below. */
export const QUALITY_LEVELS: QualityLevels = {
  ...(Object.fromEntries(
    QUALITY_GROUPS.map((group) => [group, UNWIRED]),
  ) as unknown as QualityLevels),
  edgeSmoothing: {
    smooth: { antialiasing: 'low' },
    balanced: { antialiasing: 'medium' },
    fine: { antialiasing: 'high' },
    max: {},
  },
  // The effects' levels write the atmosphere's eleven settings, the image effects' the light shafts'
  // switch, the indirect light's the sky light's intensity factor (`SKY_PRESET_LEVELS`): the
  // reference's levels 0, 1 and 2; the clouds' and the sky light's other settings stay at their
  // defaults at every level.
  effects: { ...SKY_PRESET_LEVELS.effects, max: {} },
  imageEffects: { ...SKY_PRESET_LEVELS.imageEffects, max: {} },
  indirectLight: { ...SKY_PRESET_LEVELS.indirectLight, max: {} },
}

/**
 * The resolution modes: the fraction of the display, per axis, each draws at — the public ratios
 * of the upscalers, 1.5×, 1.7×, 2× and 3× (the D3 names: Native, Sharp, Mixed, Fast, Turbo).
 */
export const RESOLUTION_MODES = {
  native: 1,
  sharp: 1 / 1.5,
  mixed: 1 / 1.7,
  fast: 1 / 2,
  turbo: 1 / 3,
} as const
/** A resolution mode. */
export type ResolutionMode = keyof typeof RESOLUTION_MODES

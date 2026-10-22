/**
 * The quality table, pure data: for each group, what each level writes over the render settings'
 * defaults (`renderSettings.ts`), and the resolution modes. A preset is one level per group, the
 * level of its own name. `max` writes nothing: it is the registry's defaults, today's constants,
 * whatever they become. The other levels write only the settings their group has wired; a level
 * whose settings are not wired yet writes nothing, and reads as `max` would.
 */
import { SCREEN_PROBE_PRESET_LEVELS } from '../bounce/screenProbeLevels.ts'
import { AMBIENT_OCCLUSION_PRESET_LEVELS } from '../contracts/ambientOcclusionOptions.ts'
import { BLOOM_PRESET_LEVELS } from '../contracts/bloomRules.ts'
import { VIEW_DISTANCE_SCALE_LEVELS } from '../contracts/cutOptions.ts'
import { DEPTH_OF_FIELD_PRESET_LEVELS } from '../contracts/depthOfFieldRules.ts'
import { FILM_PRESET_LEVELS } from '../contracts/filmOptions.ts'
import { MOTION_BLUR_PRESET_LEVELS } from '../contracts/motionBlurOptions.ts'
import { VOLUMETRIC_FOG_PRESET_LEVELS } from '../contracts/volumetricFogOptions.ts'
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
  // The view distance's levels write the scale every object's draw distance is multiplied by
  // (`VIEW_DISTANCE_SCALE_LEVELS`); the cut's other settings stay at their defaults at every level.
  viewDistance: {
    smooth: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.smooth },
    balanced: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.balanced },
    fine: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.fine },
    max: {},
  },
  // The image effects' levels write the motion blur's quality and its half-resolution gather
  // (`MOTION_BLUR_PRESET_LEVELS`), the bloom's quality and the convolution's resolution
  // (`BLOOM_PRESET_LEVELS`) and the settings the reference's levels write of the depth of
  // field (`DEPTH_OF_FIELD_PRESET_LEVELS`) and the tonemapper's quality and the colour fringe's
  // (`FILM_PRESET_LEVELS`) and the screen-space occlusion's resolutions, ceiling, depth-pyramid climb and radius
  // scale (`AMBIENT_OCCLUSION_PRESET_LEVELS`); their other switches stay at their defaults at every level.
  imageEffects: {
    smooth: {
      ...MOTION_BLUR_PRESET_LEVELS.smooth,
      ...BLOOM_PRESET_LEVELS.smooth,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.smooth,
      ...FILM_PRESET_LEVELS.smooth,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.smooth,
    },
    balanced: {
      ...MOTION_BLUR_PRESET_LEVELS.balanced,
      ...BLOOM_PRESET_LEVELS.balanced,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.balanced,
      ...FILM_PRESET_LEVELS.balanced,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.balanced,
    },
    fine: {
      ...MOTION_BLUR_PRESET_LEVELS.fine,
      ...BLOOM_PRESET_LEVELS.fine,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.fine,
      ...FILM_PRESET_LEVELS.fine,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.fine,
    },
    max: {},
  },
  // The shadows' levels write the reference's four shadow rows: the sun's shadow distance scale, its
  // count of near levels, the scale on their overlap and whether a far-field shadow follows them
  // (`shadowDistanceScale`, `shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`: the edge of
  // the far-shadow test, `farShadowDistance`), and the volumetric fog's quality level
  // (`VOLUMETRIC_FOG_PRESET_LEVELS`); the culling's switches and the fog's other settings stay at
  // their defaults at every level.
  shadows: {
    smooth: {
      shadowDistanceScale: 0.6,
      shadowNearLevels: 1,
      shadowOverlapScale: 0,
      shadowFarField: false,
      ...VOLUMETRIC_FOG_PRESET_LEVELS.smooth,
    },
    balanced: {
      shadowDistanceScale: 0.7,
      shadowNearLevels: 1,
      shadowOverlapScale: 0.25,
      shadowFarField: false,
      ...VOLUMETRIC_FOG_PRESET_LEVELS.balanced,
    },
    fine: {
      shadowDistanceScale: 0.85,
      shadowNearLevels: 4,
      shadowOverlapScale: 0.8,
      shadowFarField: true,
      ...VOLUMETRIC_FOG_PRESET_LEVELS.fine,
    },
    max: {},
  },
  // The indirect light's levels write the screen probes' level (`SCREEN_PROBE_LEVELS`): the two coarser
  // presets read the world's probes alone (`off`), the one below the top the `high` level, the top the
  // default one; the screen probes' other settings stay at their defaults at every level.
  indirectLight: {
    smooth: SCREEN_PROBE_PRESET_LEVELS.smooth,
    balanced: SCREEN_PROBE_PRESET_LEVELS.balanced,
    fine: SCREEN_PROBE_PRESET_LEVELS.fine,
    max: {},
  },
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

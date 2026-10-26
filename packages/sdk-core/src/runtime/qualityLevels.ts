/**
 * The quality table, pure data: for each group, what each level writes over the render settings'
 * defaults (`renderSettings.ts`), and the resolution modes. A preset is one level per group, the
 * level of its own name. `max` writes nothing: it is the registry's defaults, today's constants,
 * whatever they become. The other levels write only the settings their group has wired; a level
 * whose settings are not wired yet writes nothing, and reads as `max` would. `cinematic` is the
 * level above `max`: each group writes the values of the reference's fifth row for the settings
 * this engine has.
 */
import { SKY_PRESET_LEVELS } from '../modules/sky/qualityPresets.ts'
import { SCREEN_PROBE_PRESET_LEVELS } from '../bounce/screenProbeLevels.ts'
import { AMBIENT_OCCLUSION_PRESET_LEVELS } from '../contracts/ambientOcclusionOptions.ts'
import { BLOOM_PRESET_LEVELS } from '../contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_PRESET_LEVELS } from '../contracts/gaussianBlurRules.ts'
import { COLOR_GRADING_PRESET_LEVELS } from '../contracts/colorGradingOptions.ts'
import { VIEW_DISTANCE_SCALE_LEVELS } from '../contracts/cutOptions.ts'
import { DEPTH_OF_FIELD_PRESET_LEVELS } from '../contracts/depthOfFieldRules.ts'
import { FILM_PRESET_LEVELS } from '../contracts/filmOptions.ts'
import { MOTION_BLUR_PRESET_LEVELS } from '../contracts/motionBlurOptions.ts'
import { REFLECTION_PRESET_LEVELS } from '../contracts/reflectionLevels.ts'
import { SHADOW_PRESET_LEVELS } from '../contracts/shadowOptions.ts'
import { SUBSURFACE_SCATTERING_PRESET_LEVELS } from '../contracts/subsurfaceScatteringOptions.ts'
import { TRANSLUCENCY_VOLUME_PRESET_LEVELS } from '../contracts/translucencyVolumeOptions.ts'
import { VOLUMETRIC_FOG_PRESET_LEVELS } from '../contracts/volumetricFogOptions.ts'
import { QUALITY_GROUPS, type QualityGroup, type RenderSettingValue } from './renderSettings.ts'

/** The presets, coarsest first: each sets every group to the level of its own name. */
export const QUALITY_PRESETS = ['smooth', 'balanced', 'fine', 'max', 'cinematic'] as const
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
  cinematic: {},
}

/** The scale the cinematic level multiplies every object's draw distance by: the reference's last
 *  row, 10, against the 1 of `max` (`VIEW_DISTANCE_SCALE_LEVELS` holds the three below). */
const CINEMATIC_VIEW_DISTANCE_SCALE = 10

/** The engine's quality table. The edge smoothing's levels are the temporal anti-aliasing's
 *  (`TEMPORAL_AA_LEVELS`): `max` writes nothing, the default level `max`, and each coarser preset one level below;
 *  `cinematic` names the level `max` again and keeps the history's colour in half floats
 *  (`temporalHistoryPacked` off), the one setting its row changes in the history; its other
 *  difference, a pre-filter, the engine has no setting for. */
export const QUALITY_LEVELS: QualityLevels = {
  ...(Object.fromEntries(
    QUALITY_GROUPS.map((group) => [group, UNWIRED]),
  ) as unknown as QualityLevels),
  edgeSmoothing: {
    smooth: { antialiasing: 'low' },
    balanced: { antialiasing: 'medium' },
    fine: { antialiasing: 'high' },
    max: {},
    cinematic: { antialiasing: 'max', temporalHistoryPacked: false },
  },
  // The sky's effects levels write the atmosphere's eleven settings (`SKY_PRESET_LEVELS`): the
  // reference's levels 0, 1 and 2, and the fifth; the clouds' and the sky light's other settings stay
  // at their defaults at every level. They write the translucency lighting volume's cells a side and
  // its blur too (`TRANSLUCENCY_VOLUME_PRESET_LEVELS`): the first two levels' alone.
  effects: {
    smooth: {
      ...SKY_PRESET_LEVELS.effects.smooth,
      ...TRANSLUCENCY_VOLUME_PRESET_LEVELS.smooth,
      ...SUBSURFACE_SCATTERING_PRESET_LEVELS.smooth,
    },
    balanced: {
      ...SKY_PRESET_LEVELS.effects.balanced,
      ...TRANSLUCENCY_VOLUME_PRESET_LEVELS.balanced,
      ...SUBSURFACE_SCATTERING_PRESET_LEVELS.balanced,
    },
    fine: {
      ...SKY_PRESET_LEVELS.effects.fine,
      ...TRANSLUCENCY_VOLUME_PRESET_LEVELS.fine,
      ...SUBSURFACE_SCATTERING_PRESET_LEVELS.fine,
    },
    max: {},
    cinematic: {
      ...SKY_PRESET_LEVELS.effects.cinematic,
      ...TRANSLUCENCY_VOLUME_PRESET_LEVELS.cinematic,
      ...SUBSURFACE_SCATTERING_PRESET_LEVELS.cinematic,
    },
  },
  // The view distance's levels write the scale every object's draw distance is multiplied by
  // (`VIEW_DISTANCE_SCALE_LEVELS`, and the cinematic level's); the cut's other settings stay at
  // their defaults at every level.
  viewDistance: {
    smooth: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.smooth },
    balanced: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.balanced },
    fine: { cutViewDistanceScale: VIEW_DISTANCE_SCALE_LEVELS.fine },
    max: {},
    cinematic: { cutViewDistanceScale: CINEMATIC_VIEW_DISTANCE_SCALE },
  },
  // The image effects' levels write the motion blur's quality and its half-resolution gather
  // (`MOTION_BLUR_PRESET_LEVELS`), the bloom's quality and the convolution's resolution
  // (`BLOOM_PRESET_LEVELS`) and the settings the reference's levels write of the depth of
  // field (`DEPTH_OF_FIELD_PRESET_LEVELS`) and the tonemapper's quality and the colour fringe's
  // (`FILM_PRESET_LEVELS`) and the screen-space occlusion's resolutions, ceiling, depth-pyramid climb and radius
  // scale (`AMBIENT_OCCLUSION_PRESET_LEVELS`), and the light shafts' switch (`SKY_PRESET_LEVELS`); the
  // cinematic level also writes the Gaussian blur's two settings (`GAUSSIAN_BLUR_PRESET_LEVELS`) and the
  // colour table's size and shaper (`COLOR_GRADING_PRESET_LEVELS`); their other switches stay at their
  // defaults at every level.
  imageEffects: {
    smooth: {
      ...MOTION_BLUR_PRESET_LEVELS.smooth,
      ...BLOOM_PRESET_LEVELS.smooth,
      ...GAUSSIAN_BLUR_PRESET_LEVELS.smooth,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.smooth,
      ...FILM_PRESET_LEVELS.smooth,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.smooth,
      ...SKY_PRESET_LEVELS.imageEffects.smooth,
    },
    balanced: {
      ...MOTION_BLUR_PRESET_LEVELS.balanced,
      ...BLOOM_PRESET_LEVELS.balanced,
      ...GAUSSIAN_BLUR_PRESET_LEVELS.balanced,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.balanced,
      ...FILM_PRESET_LEVELS.balanced,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.balanced,
      ...SKY_PRESET_LEVELS.imageEffects.balanced,
    },
    fine: {
      ...MOTION_BLUR_PRESET_LEVELS.fine,
      ...BLOOM_PRESET_LEVELS.fine,
      ...GAUSSIAN_BLUR_PRESET_LEVELS.fine,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.fine,
      ...FILM_PRESET_LEVELS.fine,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.fine,
      ...SKY_PRESET_LEVELS.imageEffects.fine,
    },
    max: {},
    cinematic: {
      ...MOTION_BLUR_PRESET_LEVELS.cinematic,
      ...BLOOM_PRESET_LEVELS.cinematic,
      ...GAUSSIAN_BLUR_PRESET_LEVELS.cinematic,
      ...DEPTH_OF_FIELD_PRESET_LEVELS.cinematic,
      ...FILM_PRESET_LEVELS.cinematic,
      ...AMBIENT_OCCLUSION_PRESET_LEVELS.cinematic,
      ...COLOR_GRADING_PRESET_LEVELS.cinematic,
      ...SKY_PRESET_LEVELS.imageEffects.cinematic,
    },
  },
  // The shadows' levels write the shadow rules' rows (`SHADOW_PRESET_LEVELS`: the sun's distance
  // scale, near levels, overlap and far-field shadow, which shape the edge of the far-shadow test,
  // and the shadow maps' resolution biases, radius threshold, ray and sample counts, page pool,
  // local coarse marking and quality) and the volumetric fog's quality level
  // (`VOLUMETRIC_FOG_PRESET_LEVELS`); the culling's switches and the fog's other settings stay at
  // their defaults at every level.
  shadows: {
    smooth: { ...SHADOW_PRESET_LEVELS.smooth, ...VOLUMETRIC_FOG_PRESET_LEVELS.smooth },
    balanced: { ...SHADOW_PRESET_LEVELS.balanced, ...VOLUMETRIC_FOG_PRESET_LEVELS.balanced },
    fine: { ...SHADOW_PRESET_LEVELS.fine, ...VOLUMETRIC_FOG_PRESET_LEVELS.fine },
    max: {},
    cinematic: { ...SHADOW_PRESET_LEVELS.cinematic, ...VOLUMETRIC_FOG_PRESET_LEVELS.cinematic },
  },
  // The indirect light's levels write the screen probes' level (`SCREEN_PROBE_LEVELS`) and the sky light's intensity factor (`SKY_PRESET_LEVELS`): the two coarser
  // presets read the world's probes alone (`off`), the one below the top the `high` level, the top the
  // default one; and the reflections' level (`REFLECTION_LEVELS`): the two coarser presets trace none (`off`),
  // the one below the top the `high` level, the top the default one; the cinematic preset writes the level of
  // its own name for both; the other settings of both stay at their defaults at every level.
  indirectLight: {
    smooth: {
      ...SCREEN_PROBE_PRESET_LEVELS.smooth,
      ...SKY_PRESET_LEVELS.indirectLight.smooth,
      ...REFLECTION_PRESET_LEVELS.smooth,
    },
    balanced: {
      ...SCREEN_PROBE_PRESET_LEVELS.balanced,
      ...SKY_PRESET_LEVELS.indirectLight.balanced,
      ...REFLECTION_PRESET_LEVELS.balanced,
    },
    fine: {
      ...SCREEN_PROBE_PRESET_LEVELS.fine,
      ...SKY_PRESET_LEVELS.indirectLight.fine,
      ...REFLECTION_PRESET_LEVELS.fine,
    },
    max: {},
    cinematic: {
      ...SCREEN_PROBE_PRESET_LEVELS.cinematic,
      ...SKY_PRESET_LEVELS.indirectLight.cinematic,
      ...REFLECTION_PRESET_LEVELS.cinematic,
    },
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

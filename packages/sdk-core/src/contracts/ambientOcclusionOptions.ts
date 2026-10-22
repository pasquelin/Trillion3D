import { CENTIMETRES_PER_METRE } from '../page/format.ts'
import {
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The screen-space ambient occlusion of a view: the contact shadow that the light reaching a crease,
 * a corner or the foot of a wall loses, found in the depth the image drew. Each pixel searches the
 * depth round it for what rises above its surface — a few samples of a disc, at a handful of
 * distances, read from the depth's furthest-depth pyramid (`lighting/ao/`) —, and keeps the share of
 * the sky it still sees. The search runs at the image's size and at its half and quarter sizes, the
 * coarse results blended into the finer ones, so that a wide, soft occlusion and a fine one meet in one
 * texture of one byte a pixel; the image's own jitter turns the samples from image to image.
 *
 * Where it applies. The texture occludes what the base pass left in the picture and the sky light's
 * diffuse, the light that comes from all round and from nowhere in particular; never the declared lights,
 * which have their own shadows. It runs only where no screen probes light the pixels: the probes
 * carry their own short-range occlusion (`screenProbeShortRangeOcclusion`), and the two never meet,
 * unless `ambientOcclusionWithScreenProbes` is on and that occlusion is off, when it occludes the
 * probes' light and nothing else (`ambientOcclusionMode`).
 *
 * Lengths are in metres, the reference's centimetres over a hundred; a setting that is a share of the
 * depth (the bias) or of the image keeps its own number. Run-time settings, as `./settingRules.ts`
 * says: read again at each image, never written in a manifest.
 */

/** The reference's lengths are in centimetres: one metre of ours is this many. */
const CM = CENTIMETRES_PER_METRE
const NO_LIMIT = Number.MAX_VALUE

/**
 * The settings by field, each with the reference's default:
 * - `ambientOcclusion` (on): the master switch; off, no occlusion is drawn;
 * - `ambientOcclusionIntensity` (0.5), from 0 to 1: how much of the occlusion shows; 0 is off;
 * - `ambientOcclusionStaticFraction` (1), from 0 to 1: the share of what the base pass left in the
 *   picture — a surface's emission — that the occlusion darkens;
 * - `ambientOcclusionRadius` (2 m): how far from a point a surface may be and occlude it; in the
 *   default view-space mode it is the radius at 4 m from the eye and grows with the distance, so that
 *   its share of the image holds; with `ambientOcclusionRadiusInWorldSpace` (off) it is the radius in
 *   the world, at any distance;
 * - `ambientOcclusionFadeDistance` (80 m) and `ambientOcclusionFadeRadius` (50 m): the occlusion
 *   fades to nothing over the last `radius` metres before `distance`, from the eye;
 * - `ambientOcclusionPower` (2) and `ambientOcclusionBias` (3): the exponent the occlusion is raised
 *   to, from 0.1, and how far the point is lifted off its surface along the normal, in thousandths of its depth;
 * - `ambientOcclusionQuality` (50), from 0 up, 100 the usual best: how many resolutions the search runs at and how
 *   many samples it takes (`ambientOcclusionLevels`, `ambientOcclusionMaxQuality` hold it down or up);
 * - `ambientOcclusionMipBlend` (0.6), `ambientOcclusionMipScale` (1.7) and
 *   `ambientOcclusionMipThreshold` (0.01): how much of the coarser result is blended into the finer,
 *   how the radius grows over the coarser resolutions, and the depth step (per centimetre, over the
 *   resolution) under which the neighbours of the setup's halving count as one surface;
 * - `ambientOcclusionLevels` (-1): the resolutions searched, 1 to 3, 0 none; -1 follows the quality;
 * - `ambientOcclusionMaxQuality` (100): a ceiling on the quality — a negative value forces the quality
 *   it names, its absolute value, whatever the setting says;
 * - `ambientOcclusionMipLevelFactor` (0.4): how fast the samples move to the coarser levels of the depth
 *   pyramid along the search; 0 always reads the finest;
 * - `ambientOcclusionRadiusScale` (1): a scale on the radius;
 * - `ambientOcclusionWithScreenProbes` (off): occlude the screen probes' light too, when their own
 *   short-range occlusion is off.
 */
export const AMBIENT_OCCLUSION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('ambientOcclusion', true),
    number('ambientOcclusionIntensity', 0.5, [0, 1]),
    number('ambientOcclusionStaticFraction', 1, [0, 1]),
    number('ambientOcclusionRadius', 200 / CM, [0.1 / CM, NO_LIMIT]),
    flag('ambientOcclusionRadiusInWorldSpace', false),
    nonNegative('ambientOcclusionFadeDistance', 8000 / CM),
    nonNegative('ambientOcclusionFadeRadius', 5000 / CM),
    number('ambientOcclusionPower', 2, [0.1, NO_LIMIT]),
    nonNegative('ambientOcclusionBias', 3),
    number('ambientOcclusionQuality', 50, [0, NO_LIMIT]),
    number('ambientOcclusionMipBlend', 0.6, [0.1, NO_LIMIT]),
    number('ambientOcclusionMipScale', 1.7, [0.5, NO_LIMIT]),
    nonNegative('ambientOcclusionMipThreshold', 0.01),
    integer('ambientOcclusionLevels', -1, [-1, 3]),
    number('ambientOcclusionMaxQuality', 100, [-100, 100]),
    number('ambientOcclusionMipLevelFactor', 0.4, [0, 100]),
    number('ambientOcclusionRadiusScale', 1, [0.1, 15]),
    flag('ambientOcclusionWithScreenProbes', false),
  ] as const))()
/** The field of one setting of the ambient occlusion. */
export type AmbientOcclusionField = keyof typeof AMBIENT_OCCLUSION_RULES
/** The settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type AmbientOcclusionOptions = SettingOptions<typeof AMBIENT_OCCLUSION_RULES>
/** The settings with every field set: the defaults for those a host leaves out. */
export type AmbientOcclusionValues = SettingValues<typeof AMBIENT_OCCLUSION_RULES>

/**
 * What each quality level below the top writes: the resolutions, the ceiling of the quality, how fast
 * the samples climb the depth pyramid and the scale of the radius — the reference's own four post-process
 * levels. `smooth` searches none (no occlusion), `balanced` and `fine` follow the quality at the
 * larger radius; `max` writes nothing, the defaults (`runtime/qualityLevels.ts`).
 */
export const AMBIENT_OCCLUSION_PRESET_LEVELS = {
  smooth: {
    ambientOcclusionLevels: 0,
    ambientOcclusionMaxQuality: 0,
    ambientOcclusionMipLevelFactor: 1,
    ambientOcclusionRadiusScale: 1.2,
  },
  balanced: {
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 60,
    ambientOcclusionMipLevelFactor: 1,
    ambientOcclusionRadiusScale: 1.5,
  },
  fine: {
    ambientOcclusionLevels: -1,
    ambientOcclusionMaxQuality: 100,
    ambientOcclusionMipLevelFactor: 0.6,
    ambientOcclusionRadiusScale: 1.5,
  },
} as const

/** The smallest radius that draws, in centimetres, once scaled: under it no occlusion is made. */
const LEAST_RADIUS_CM = 0.1

/** What the passes read of the settings: every number in the centimetres the search works in, and the
 *  counts the quality fixes. */
export interface AmbientOcclusionSettings {
  /** Whether the occlusion draws at all: on, with an intensity, a radius and a resolution to search. */
  enabled: boolean
  intensity: number
  staticFraction: number
  /** The radius, scaled, in centimetres, and whether it is the world's rather than the view's. */
  radiusCm: number
  radiusInWorldSpace: boolean
  fadeDistanceCm: number
  fadeRadiusCm: number
  power: number
  bias: number
  mipBlend: number
  mipScale: number
  mipThreshold: number
  /** How fast the samples climb the depth pyramid, held from 0 to 100. */
  mipLevelFactor: number
  /** The quality in percent the levels and the samples follow. */
  quality: number
  /** The resolutions searched, 0 to 3, and the samples' count and shape, 0 to 4 (`shaderQuality`). */
  levels: number
  shaderQuality: number
  withScreenProbes: boolean
}

/** The quality in percent: the setting under the ceiling; a negative ceiling names it, in absolute value. */
const ambientOcclusionQuality = (quality: number, maxQuality: number) =>
  maxQuality < 0 ? -maxQuality : Math.min(maxQuality, quality)

/** The resolutions a quality searches: the setting (0 to 3) when it is not negative, else one more for each step
 *  of the quality over 35 and over 70. */
const ambientOcclusionLevels = (levels: number, quality: number) =>
  levels >= 0 ? levels : 1 + +(quality > 70) + +(quality > 35)

/** The samples' shape a quality picks, 0 (the fewest) to 4: one more for each step over 5, 25, 55 and 75. */
const ambientOcclusionShaderQuality = (quality: number) =>
  +(quality > 75) + +(quality > 55) + +(quality > 25) + +(quality > 5)

/**
 * The numbers the passes run on, from the settings: the radius scaled and in centimetres, the quality
 * the ceiling leaves, the resolutions and the samples it picks, and whether anything draws — on, with an
 * intensity, a radius of at least a tenth of a centimetre and a resolution to search; the other
 * clauses the reference asks of the view (a sky light, reflections, the base pass's share) all hold
 * in every view this engine draws, so none is read.
 */
export function resolveAmbientOcclusion(values: AmbientOcclusionValues): AmbientOcclusionSettings {
  const quality = ambientOcclusionQuality(
    values.ambientOcclusionQuality,
    values.ambientOcclusionMaxQuality,
  )
  const levels = ambientOcclusionLevels(values.ambientOcclusionLevels, quality)
  const radiusCm = values.ambientOcclusionRadius * CM * values.ambientOcclusionRadiusScale
  return {
    enabled:
      values.ambientOcclusion &&
      values.ambientOcclusionIntensity > 0 &&
      radiusCm >= LEAST_RADIUS_CM &&
      levels > 0,
    intensity: values.ambientOcclusionIntensity,
    staticFraction: values.ambientOcclusionStaticFraction,
    radiusCm,
    radiusInWorldSpace: values.ambientOcclusionRadiusInWorldSpace,
    fadeDistanceCm: values.ambientOcclusionFadeDistance * CM,
    fadeRadiusCm: values.ambientOcclusionFadeRadius * CM,
    power: values.ambientOcclusionPower,
    bias: values.ambientOcclusionBias,
    mipBlend: values.ambientOcclusionMipBlend,
    mipScale: values.ambientOcclusionMipScale,
    mipThreshold: values.ambientOcclusionMipThreshold,
    mipLevelFactor: values.ambientOcclusionMipLevelFactor,
    quality,
    levels,
    shaderQuality: ambientOcclusionShaderQuality(quality),
    withScreenProbes: values.ambientOcclusionWithScreenProbes,
  }
}

/** How an image applies the occlusion: `none`; `scene`, where no screen probes light it, to the
 *  surfaces' emission and the sky light's diffuse; `probes`, to the probes' light. */
export type AmbientOcclusionMode = 'none' | 'scene' | 'probes'

/** What an image knows of its indirect light: whether the screen probes light its pixels, and the
 *  setting `screenProbeShortRangeOcclusion` as written (the occlusion's strength read apart). */
export interface IndirectLightState {
  probes: boolean
  shortRange: boolean
}

/**
 * Where, and whether, the image draws the occlusion. With no screen probes it is drawn for the
 * scene. With them it is drawn only when the host asks for it (`withScreenProbes`) and the probes' own
 * short-range occlusion is off — the one that replaces it —, and then it occludes their light alone.
 * Nothing is drawn when the settings draw nothing (`AmbientOcclusionSettings.enabled`).
 */
export function ambientOcclusionMode(
  settings: Pick<AmbientOcclusionSettings, 'enabled' | 'withScreenProbes'>,
  { probes, shortRange }: IndirectLightState,
): AmbientOcclusionMode {
  if (!settings.enabled) return 'none'
  if (!probes) return 'scene'
  return settings.withScreenProbes && !shortRange ? 'probes' : 'none'
}

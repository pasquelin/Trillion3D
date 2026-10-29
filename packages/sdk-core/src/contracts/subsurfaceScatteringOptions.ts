import {
  atLeast,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The screen-space subsurface scattering of a view: the light that enters a surface of the subsurface
 * profile model (`subsurfaceProfile`, a material's parameter) and leaves it again nearby, found in the
 * image the lights drew. Each pixel of such a surface holds its diffuse light apart from its specular
 * light (the lit image's alpha is the diffuse light's luminance); the diffuse light is spread over the
 * neighbouring pixels of the same profile by the profile's scattering — by default sampled, a few
 * samples a pixel drawn from the profile's own distribution and a variance-driven count (`'importance
 * sampling'`), or by two separable passes for a profile that asks for them —, then multiplied by the
 * surface's colour and added to the specular light again (`lighting/subsurface/`). The pass runs on the
 * lit image, before the sky, the fog and the transparents.
 *
 * Each setting has the default of the reference's fourth quality level (the one its engine starts at),
 * not the one its variable holds before a level is applied: the quality levels of ours write the other
 * rows of its table (`SUBSURFACE_SCATTERING_PRESET_LEVELS`), `max` writes nothing.
 * Run-time settings, as `./settingRules.ts` says: read again at each image, never written in a manifest.
 */

/**
 * The settings by field, each with the reference's default:
 * - `subsurfaceScattering` (on): the master switch; off, a subsurface-profile surface is lit as a
 *   plain one;
 * - `subsurfaceScale` (1): a scale on every profile's scatter radius; 0 is off, below 1 a narrower
 *   scattering, above 1 a wider one;
 * - `subsurfaceHalfResolution` (off): scatter at half the image's size (lower quality, faster);
 * - `subsurfaceHalfResolutionSeparable` (on): in the half-resolution mode, scatter every profile with the
 *   separable passes, whatever the profile asks for; off, the profile's own choice stands;
 * - `subsurfaceRecombineQuality` (1), -1 to 1: how the lit image is reconstructed and recombined — 0 low,
 *   1 high (sharper details), -1 automatic: high; an image that is accumulated in time (the temporal
 *   resolve of a super resolution is low quality's enemy) is recombined high whatever this says;
 * - `subsurfaceFilter` (on): bilinear sampling of the scattered image (off: point);
 * - `subsurfaceSampleSet` (2), 0 to 2: the samples of the separable passes — 0 lowest (6 a side), 1 medium
 *   (9), 2 high (13);
 * - `subsurfaceCheckerboard` (2): the surface lighting of a subsurface-profile pixel in a checkerboard
 *   (the diffuse light on one pixel of two, the specular on the other) — 0 off, 1 on, 2 automatic: off,
 *   the lit image having an alpha channel to hold the diffuse light's luminance;
 * - `subsurfaceCheckerboardNeighborValidation` (off): with the checkerboard on, a neighbour that is not a
 *   subsurface-profile pixel adds nothing to the reconstruction (a sharper border, a pixel more read);
 * - `subsurfaceBurleyQuality` (1), 0 or 1: 0 scatters every profile with the separable passes (the transmission
 *   stays the profile's own); 1 automatic: the sampled scattering, the separable passes only in half
 *   resolution;
 * - `subsurfaceBurleySamples` (0): a count of samples a pixel for the sampled scattering; 0 lets the
 *   pixel's variance choose it;
 * - `subsurfaceBurleyProfileIdCache` (on): the profile of each pixel kept in a texture of the scattering's
 *   resolution, read by the passes in place of the surfaces;
 * - `subsurfaceBurleyBilateralKernel` (1), 0 or 1: how a sample weighs against the pixel — 0 by depth alone
 *   (faster), 1 by depth and normal (better at the eyelids);
 * - `subsurfaceBurleyMipsMinTileCount` (4000): the count of tiles of sampled scattering from which the
 *   mip chain of the diffuse light is made (0: always);
 * - `subsurfaceSubpixelThreshold` (1): the share of the scattering inside the pixel's own footprint above which
 *   a tile is not scattered at all;
 * - `subsurfaceSamplingChannel` (1), 0 or 1: which channel of a profile steers the sampled scattering — 0 the
 *   largest diffuse mean free path, 1 the largest mean free path;
 * - `subsurfaceColorTransmittanceDistance` (0.15), 0.05 to 1: the distance, in the normalised units of the
 *   light's travel, at which a subsurface-model surface's colour is the transmittance of the light through it
 *   (the thin subsurface model's transmission takes its hue shift from it);
 * - `subsurfaceDebugPixel` (off): the pixel under `sampledLightsDebugCursorX` / `…Y` written on the image, at full
 *   resolution, with the reconstruction and the recombine of its lighting (the `subsurface-profiles` view draws
 *   the profile map).
 */
export const SUBSURFACE_SCATTERING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('subsurfaceScattering', true),
    number('subsurfaceScale', 1, atLeast(0)),
    flag('subsurfaceHalfResolution', false),
    flag('subsurfaceHalfResolutionSeparable', true),
    integer('subsurfaceRecombineQuality', 1, [-1, 1]),
    flag('subsurfaceFilter', true),
    integer('subsurfaceSampleSet', 2, [0, 2]),
    integer('subsurfaceCheckerboard', 2, [0, 2]),
    flag('subsurfaceCheckerboardNeighborValidation', false),
    integer('subsurfaceBurleyQuality', 1, [0, 1]),
    integer('subsurfaceBurleySamples', 0, atLeast(0)),
    flag('subsurfaceBurleyProfileIdCache', true),
    integer('subsurfaceBurleyBilateralKernel', 1, [0, 1]),
    integer('subsurfaceBurleyMipsMinTileCount', 4000, atLeast(0)),
    number('subsurfaceSubpixelThreshold', 1, atLeast(0)),
    integer('subsurfaceSamplingChannel', 1, [0, 1]),
    number('subsurfaceColorTransmittanceDistance', 0.15, [0.05, 1]),
    flag('subsurfaceDebugPixel', false),
  ] as const))()
/** The field of one setting of the subsurface scattering. */
export type SubsurfaceScatteringField = keyof typeof SUBSURFACE_SCATTERING_RULES
/** The settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type SubsurfaceScatteringOptions = SettingOptions<typeof SUBSURFACE_SCATTERING_RULES>
/** The settings with every field set: the defaults for those a host leaves out. */
export type SubsurfaceScatteringValues = SettingValues<typeof SUBSURFACE_SCATTERING_RULES>

/**
 * What each quality level below the top writes: the scale, the separable passes' samples, the recombine's
 * quality and the half-resolution mode — the reference's own rows. `max` writes nothing, the defaults;
 * `cinematic` writes its fifth row, which is the fourth again.
 */
export const SUBSURFACE_SCATTERING_PRESET_LEVELS = {
  smooth: {
    subsurfaceScale: 0,
    subsurfaceSampleSet: 0,
    subsurfaceRecombineQuality: 0,
    subsurfaceHalfResolution: true,
  },
  balanced: {
    subsurfaceScale: 0.75,
    subsurfaceSampleSet: 0,
    subsurfaceRecombineQuality: 0,
    subsurfaceHalfResolution: true,
  },
  fine: {
    subsurfaceScale: 1,
    subsurfaceSampleSet: 1,
    subsurfaceRecombineQuality: -1,
    subsurfaceHalfResolution: true,
  },
  cinematic: {
    subsurfaceScale: 1,
    subsurfaceSampleSet: 2,
    subsurfaceRecombineQuality: 1,
    subsurfaceHalfResolution: false,
  },
} as const

/** The kernel range of the separable passes' sampled offsets, in kernel units (the profile table holds it). */
export const SUBSURFACE_KERNEL_SIZE = 3
/** The most a profile's scatter offsets are stored over (the table's alpha is the offset over this). */
export const SUBSURFACE_RADIUS_SCALE = 1024

/** What the passes read of the settings: the resolution, the passes the settings run, the counts and the switches. */
export interface SubsurfaceScatteringSettings {
  /** Whether the pass runs at all (the master switch on and a scale above 0). */
  enabled: boolean
  /** Whether the pass scatters at half the image's size. */
  half: boolean
  /** The scale on every profile's radius. */
  scale: number
  /** Whether every profile is scattered with the separable passes. */
  forceSeparable: boolean
  /** The recombine's quality as written: -1 follows the image's accumulation. */
  recombineQuality: number
  filter: boolean
  /** The separable passes' kernel: 0, 1 or 2. */
  sampleSet: number
  checkerboard: number
  neighborValidation: boolean
  burleySamples: number
  profileIdCache: boolean
  bilateralKernel: number
  mipsMinTileCount: number
  subpixelThreshold: number
  samplingChannel: number
  /** The distance at which the subsurface model's colour is the light's transmittance. */
  colorTransmittanceDistance: number
  /** Whether the pixel under the debug cursor is written on the image. */
  debugPixel: boolean
}

/** The settings the passes read, from the resolved values. */
export function resolveSubsurfaceScattering(
  values: SubsurfaceScatteringValues,
): SubsurfaceScatteringSettings {
  const scale = Math.max(0, values.subsurfaceScale)
  const half = values.subsurfaceHalfResolution
  return {
    enabled: values.subsurfaceScattering && scale > 0,
    half,
    scale,
    // Run in separable mode under two conditions: the fallback of the sampled scattering, and the half resolution.
    forceSeparable:
      values.subsurfaceBurleyQuality === 0 || (half && values.subsurfaceHalfResolutionSeparable),
    recombineQuality: values.subsurfaceRecombineQuality,
    filter: values.subsurfaceFilter,
    sampleSet: values.subsurfaceSampleSet,
    checkerboard: values.subsurfaceCheckerboard,
    neighborValidation: values.subsurfaceCheckerboardNeighborValidation,
    burleySamples: values.subsurfaceBurleySamples,
    profileIdCache: values.subsurfaceBurleyProfileIdCache,
    bilateralKernel: values.subsurfaceBurleyBilateralKernel,
    mipsMinTileCount: values.subsurfaceBurleyMipsMinTileCount,
    subpixelThreshold: values.subsurfaceSubpixelThreshold,
    samplingChannel: values.subsurfaceSamplingChannel,
    colorTransmittanceDistance: values.subsurfaceColorTransmittanceDistance,
    debugPixel: values.subsurfaceDebugPixel,
  }
}

/** Whether the lit image holds a subsurface-profile pixel's diffuse light and its specular light on the two
 *  pixels of a checkerboard: asked (1); the automatic choice (2) turns it off, the lit image having an alpha
 *  channel for the diffuse light's luminance. */
export const subsurfaceCheckerboardOn = (
  settings: Pick<SubsurfaceScatteringSettings, 'checkerboard'>,
) => settings.checkerboard === 1

/** Whether the lighting is reconstructed and recombined at the high quality: an image accumulated in time
 *  always is, an image that is not follows the setting (0 low; 1 and the automatic -1 high). */
export const subsurfaceRecombineHigh = (
  settings: Pick<SubsurfaceScatteringSettings, 'recombineQuality'>,
  accumulates: boolean,
) => accumulates || settings.recombineQuality !== 0

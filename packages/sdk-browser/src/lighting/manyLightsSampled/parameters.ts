import type { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import type { SettingValues } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** The view's sampled lighting settings, every one resolved (`sampledLightsOptions.ts`). */
export type SampledLightsSettings = SettingValues<typeof SAMPLED_LIGHTS_RULES>

/** What the sampled lighting lights: the opaque surfaces, the hair strands, the nearest translucent layer. */
export type SampledInput = 'surface' | 'hair' | 'frontTranslucency'

/**
 * The settings an input is processed with: the nearest translucent layer takes its own filters, screen traces and fast clear; the surfaces' stand as they are.
 * (The hair strands' downsample, samples and fast clear are read where they are used: `sampledDownsampleFactor`, `sampledSamplesForInput`.)
 */
export const sampledSettingsOf = (
  settings: SampledLightsSettings,
  input: SampledInput,
): SampledLightsSettings =>
  input === 'frontTranslucency'
    ? {
        ...settings,
        sampledLightsTemporal: settings.sampledLightsFrontLayerTemporal,
        sampledLightsSpatial: settings.sampledLightsFrontLayerSpatial,
        sampledLightsScreenTraces: settings.sampledLightsFrontLayerScreenTraces,
        sampledLightsFastClear: settings.sampledLightsFrontLayerFastClear,
      }
    : settings

/** Whether an area light's penumbra is sampled for `input`. */
export const sampledSoftShadows = (settings: SampledLightsSettings, input: SampledInput) =>
  input !== 'frontTranslucency' || settings.sampledLightsFrontLayerSoftShadows

/** The pixels of the view that one sampled pixel covers, along x and y. */
export function sampledDownsampleFactor(
  settings: SampledLightsSettings,
  input: SampledInput,
): readonly [number, number] {
  const mode =
    input === 'hair' ? settings.sampledLightsHairDownsample : settings.sampledLightsDownsample
  return mode === 0 ? [1, 1] : mode === 1 ? [2, 1] : [2, 2]
}

/** The samples of one sampled pixel along x and y: 4 or more take 2 by 2, 2 or 3 take 2 by 1, less 1 by 1. */
function sampledSamplesPerPixel2d(count: number): readonly [number, number] {
  return count >= 4 ? [2, 2] : count >= 2 ? [2, 1] : [1, 1]
}

/** The samples of one sampled pixel of `input`, along x and y. */
export const sampledSamplesForInput = (settings: SampledLightsSettings, input: SampledInput) =>
  sampledSamplesPerPixel2d(
    input === 'hair'
      ? settings.sampledLightsHairSamplesPerPixel
      : settings.sampledLightsSamplesPerPixel,
  )

/** The samples of one sampled voxel along x, y and z: 4 or more take 2 by 2 by 1, less 2 by 1 by 1. */
export const sampledSamplesPerVoxel3d = (count: number): readonly [number, number, number] =>
  count >= 4 ? [2, 2, 1] : [2, 1, 1]

/** The fog cells one drawn cell covers along each axis: 2 when the setting says 2, else 1. */
export const sampledVolumeDownsampleFactor = (settings: SampledLightsSettings) =>
  settings.sampledLightsVolumeDownsample === 2 ? 2 : 1

/** The value assumed for the transmission when a sample is weighed: none when the transmission is off. */
export const sampledTransmissionSampleWeight = (settings: SampledLightsSettings) =>
  settings.sampledLightsTransmission ? settings.sampledLightsTransmissionSampleWeight : 0

/** The weight under which a sample is skipped, scaled by the base colour luminance the culling assumes. */
export const sampledMinSampleWeightEstimate = (settings: SampledLightsSettings) =>
  settings.sampledLightsAttenuationFalloff > 0
    ? settings.sampledLightsMinSampleWeight / settings.sampledLightsAttenuationFalloff
    : 0

/** The tile types, numbered as the shaders read them. */
export const SAMPLED_TILE = {
  simple: 0,
  complex: 1,
  simpleRect: 2,
  complexRect: 3,
  simpleRectTextured: 4,
  complexRectTextured: 5,
  empty: 6,
  single: 7,
  singleRect: 8,
  singleRectTextured: 9,
} as const

/** The edge, in pixels, of a tile of the classification and of a tile of the visible lights' hash. */
export const SAMPLED_TILE_SIZE = 8

/** The tiles of a view's classification: the modes above, the empty one included. */
export const SAMPLED_TILE_MODES = 10

import {
  flagSetting as flag,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time setting of the volumetric lightmap (`packages/sdk-browser/src/lighting/volumetricLightmap/`):
 * the precomputed indirect light a baked scene carries
 * (`../lighting/volumetricLightmapFile.ts`). A run-time setting, as `./settingRules.ts` says; the
 * lightmap itself is a product of the build, present or not.
 */

/** The lightmap's setting by field: `volumetricLightmap`, on — whether the precomputed light is
 *  read at all, by the fog's static term and the lighting of movable objects; off, every read
 *  answers black, as a scene without a lightmap does. */
export const VOLUMETRIC_LIGHTMAP_RULES = /* @__PURE__ */ (() =>
  rulesOf([flag('volumetricLightmap', true)] as const))()
/** The field of the lightmap's setting. */
export type VolumetricLightmapField = keyof typeof VOLUMETRIC_LIGHTMAP_RULES
/** The lightmap's setting as a host writes it: its value, or nothing for its default. */
export type VolumetricLightmapOptions = SettingOptions<typeof VOLUMETRIC_LIGHTMAP_RULES>
/** The lightmap's setting as resolved. */
export type VolumetricLightmapValues = SettingValues<typeof VOLUMETRIC_LIGHTMAP_RULES>

import {
  flagSetting as flag,
  numberSetting as number,
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

/** The lightmap's settings by field: `volumetricLightmap`, on — whether the precomputed light is
 *  read at all, by the fog's static term and the lighting of movable objects; off, every read
 *  answers black, as a scene without a lightmap does —, `volumetricLightmapLoadingRange`, the
 *  distance in metres around the view within which the cells of the finest bricks are loaded (64:
 *  the reference's 6400 cm) —, and `volumetricLightmapBrickMemory`, the memory in megabytes the
 *  loaded finest bricks may take (30: the reference's limit); the cells nearest the view win it. */
export const VOLUMETRIC_LIGHTMAP_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('volumetricLightmap', true),
    number('volumetricLightmapLoadingRange', 64, [1, 100000]),
    number('volumetricLightmapBrickMemory', 30, [1, 65536]),
  ] as const))()
/** The field of the lightmap's setting. */
export type VolumetricLightmapField = keyof typeof VOLUMETRIC_LIGHTMAP_RULES
/** The lightmap's setting as a host writes it: its value, or nothing for its default. */
export type VolumetricLightmapOptions = SettingOptions<typeof VOLUMETRIC_LIGHTMAP_RULES>
/** The lightmap's setting as resolved. */
export type VolumetricLightmapValues = SettingValues<typeof VOLUMETRIC_LIGHTMAP_RULES>

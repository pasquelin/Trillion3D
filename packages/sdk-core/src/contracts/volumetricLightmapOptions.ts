import {
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
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
 *  loaded finest bricks may take (30: the reference's limit); the cells nearest the view win it —,
 *  and the view of the samples: `volumetricLightmapVisualize`, off — a sphere is drawn as an unlit surface at
 *  every sample of the lightmap, lit by the harmonics stored there —, `volumetricLightmapVisualizeRadiusScale`,
 *  0.01 — the sphere's radius as a fraction of the world size of the brick it belongs to —, and
 *  `volumetricLightmapVisualizeMinScreenFraction`, 0.001 — the least share of the screen a sphere takes,
 *  measured with the projection's horizontal scale (the width), so that a far one does not alias. */
export const VOLUMETRIC_LIGHTMAP_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('volumetricLightmap', true),
    number('volumetricLightmapLoadingRange', 64, [1, 100000]),
    number('volumetricLightmapBrickMemory', 30, [1, 65536]),
    flag('volumetricLightmapVisualize', false),
    nonNegative('volumetricLightmapVisualizeRadiusScale', 0.01),
    nonNegative('volumetricLightmapVisualizeMinScreenFraction', 0.001),
  ] as const))()
/** The field of the lightmap's setting. */
export type VolumetricLightmapField = keyof typeof VOLUMETRIC_LIGHTMAP_RULES
/** The lightmap's setting as a host writes it: its value, or nothing for its default. */
export type VolumetricLightmapOptions = SettingOptions<typeof VOLUMETRIC_LIGHTMAP_RULES>
/** The lightmap's setting as resolved. */
export type VolumetricLightmapValues = SettingValues<typeof VOLUMETRIC_LIGHTMAP_RULES>

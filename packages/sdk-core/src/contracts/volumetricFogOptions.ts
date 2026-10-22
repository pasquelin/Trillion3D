import {
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the fog's volume (`SceneVolumetricFog`,
 * `../scene/core/fogVolumetric.ts`): how finely its grid cuts the screen and the distance, and the
 * switches of the way it is lit and kept from one image to the next. The scene says whether the
 * volume is on and what it is made of; these are the engine's own, read again at each image, as
 * `./settingRules.ts` says of run-time settings.
 *
 * The grid is the quality. A level names the cell's side in pixels, the cells along the depth and
 * the lighting samples a cell takes where its history is missing, `off` none: no volume at all,
 * the analytic fog alone. The default is `high`, the finest of the regular levels, as the other
 * families take theirs — the engines' own grid without scalability is `low`'s, 16 pixels and 64
 * slices. Every other number is a setting of its own with its default, so that none is a
 * constant: the history's share, the moving samples, the spread of the depth slices, how far a
 * cell's sample is lifted off the depth buffer. The quality presets write the
 * level (`../runtime/qualityLevels.ts`).
 */

/** The volume's quality levels, `off` first, then coarsest to finest. */
export const VOLUMETRIC_FOG_LEVELS = ['off', 'low', 'high', 'ultra'] as const
/** A quality level of the volume. */
export type VolumetricFogLevel = (typeof VOLUMETRIC_FOG_LEVELS)[number]
/** The level the engine draws at when none is named. */
export const DEFAULT_VOLUMETRIC_FOG_LEVEL = 'high' satisfies VolumetricFogLevel

/** What a level fixes: the side of a cell in pixels, the cells along the depth, and the lighting
 *  samples a cell takes where its history is missing (1, 4, 8 or 16). */
export interface VolumetricFogKnobs {
  readonly cellSize: number
  readonly sliceCount: number
  readonly rebuildSamples: number
}

/** The knobs of each level that draws a volume; `off` draws none. */
export const VOLUMETRIC_FOG_LEVEL_KNOBS = {
  low: { cellSize: 16, sliceCount: 64, rebuildSamples: 4 },
  high: { cellSize: 8, sliceCount: 128, rebuildSamples: 4 },
  ultra: { cellSize: 4, sliceCount: 128, rebuildSamples: 16 },
} as const satisfies Record<Exclude<VolumetricFogLevel, 'off'>, VolumetricFogKnobs>

/** The knobs of a level: none for `off`. */
export const volumetricFogKnobs = (level: VolumetricFogLevel): VolumetricFogKnobs | undefined =>
  level === 'off' ? undefined : VOLUMETRIC_FOG_LEVEL_KNOBS[level]

/** The filters a surface may read the volume through: the plain trilinear one, a cubic one in the
 *  plane of the screen, or in the depth too. */
export const VOLUMETRIC_FOG_FILTERS = ['trilinear', 'bicubic', 'tricubic'] as const

/** The volume's run-time settings by field, each with the engines' default:
 *  `volumetricFogQuality`, the level (`VOLUMETRIC_FOG_LEVELS`), `high`;
 *  `volumetricFogReadFilter`, how a surface reads the volume, `trilinear`;
 *  `volumetricFogUsesHistory`, on — the volume of the image before is blended into this one;
 *  `volumetricFogMovesSamples`, on — each image's lighting samples sit elsewhere in the cell, the blend
 *  averaging them;
 *  `volumetricFogHistoryShare`, 0.9 — the share of the history kept, from 0 to 1;
 *  `volumetricFogSliceSpread`, 32 — how the slices are spread along the depth, more of
 *  them near the eye the smaller it is;
 *  `volumetricFogGlow`, on — the fog's own light is read;
 *  `volumetricFogSkipHidden`, on — a cell wholly behind the surfaces of its pixels is not
 *  lit;
 *  `volumetricFogLampSoftening`, 1 — the share of a cell's size added to the distance a local
 *  light's inverse-square falloff is taken at, against the spike near the light;
 *  `volumetricFogSampleScatter`, 0 — a random offset, in cells, added to each lighting sample;
 *  `volumetricFogSurfaceLift`, 0.5 — in cells, how far a cell's sample is moved out of the
 *  depth buffer along the depth, −1 not at all;
 *  `volumetricFogLiftRange`, 1 — in cells, how far a sample behind the depth buffer is still
 *  brought forward;
 *  `volumetricFogVoxelizationSlicesPerPass`, 8 — the slices of an object voxelised into the volume
 *  (`../scene/volume/contracts.ts`) that make one pass, at least 1;
 *  `volumetricFogVoxelizationShowOnlyPass`, −1 — from 0, the one pass of each object that is
 *  voxelised, to see where the passes lie; −1 all of them. */
export const VOLUMETRIC_FOG_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('volumetricFogQuality', DEFAULT_VOLUMETRIC_FOG_LEVEL, VOLUMETRIC_FOG_LEVELS),
    choice('volumetricFogReadFilter', 'trilinear', VOLUMETRIC_FOG_FILTERS),
    flag('volumetricFogUsesHistory', true),
    flag('volumetricFogMovesSamples', true),
    number('volumetricFogHistoryShare', 0.9, [0, 1]),
    positive('volumetricFogSliceSpread', 32, 'a finite number above 0'),
    flag('volumetricFogGlow', true),
    flag('volumetricFogSkipHidden', true),
    nonNegative('volumetricFogLampSoftening', 1),
    nonNegative('volumetricFogSampleScatter', 0),
    number('volumetricFogSurfaceLift', 0.5, [-1, Number.MAX_VALUE]),
    nonNegative('volumetricFogLiftRange', 1),
    count('volumetricFogVoxelizationSlicesPerPass', 8, 1),
    integer('volumetricFogVoxelizationShowOnlyPass', -1, [-1, Number.MAX_SAFE_INTEGER]),
  ] as const))()
/** The field of one setting of the volume. */
export type VolumetricFogField = keyof typeof VOLUMETRIC_FOG_RULES
/** The volume's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type VolumetricFogOptions = SettingOptions<typeof VOLUMETRIC_FOG_RULES>
/** The volume's settings with every field set: the defaults for those a host leaves out. */
export type VolumetricFogValues = SettingValues<typeof VOLUMETRIC_FOG_RULES>

/** What each quality level below the top writes of the quality level: no volume at `smooth` and
 *  `balanced`, the low level at `fine`; `max` writes nothing, the default level
 *  (`runtime/qualityLevels.ts`). */
export const VOLUMETRIC_FOG_PRESET_LEVELS = {
  smooth: { volumetricFogQuality: 'off' },
  balanced: { volumetricFogQuality: 'off' },
  fine: { volumetricFogQuality: 'low' },
} as const satisfies Record<string, { volumetricFogQuality: VolumetricFogLevel }>

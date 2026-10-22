import {
  ANY_NUMBER,
  choiceSetting as choice,
  flagSetting as flag,
  nonZeroSetting as nonZero,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the fog (`SceneHeightFog`, `../scene/core/fogHeight.ts`) and of its
 * volume (`SceneVolumetricFog`, `../scene/core/fogVolumetric.ts`): how finely the volume's grid cuts
 * the screen and the distance, the switches of the way it is lit and kept from one image to the
 * next, and the switches of the fog as a whole. The scene says whether the volume is on and what it
 * is made of; these are the engine's own, read again at each image, as `./settingRules.ts` says of
 * run-time settings.
 *
 * The grid is the quality. A level names the cell's side in pixels, the cells along the depth and
 * the lighting samples a cell takes where its history is missing, `off` none: no volume at all,
 * the analytic fog alone. The default is `high`, the level every quality group starts at (the
 * third of four, as the other families take theirs): 8 pixels, 128 slices, 4 samples. Every other
 * number is a setting of its own with its default, so that none is a
 * constant: the history's share, the moving samples, the spread of the depth slices, how far a
 * cell's sample is lifted off the depth buffer. The quality presets write the
 * level (`../runtime/qualityLevels.ts`).
 *
 * Four switches are the fog's as a whole, not the volume's: whether any fog is drawn, whether the
 * atmosphere's light adds to it, whether it is made to match the volume, and whether an orthographic
 * view measures its height from the view's own. The engines that fixed them keep the last three as
 * project settings that choose a program; here they are read at each image, which a program that
 * had been chosen would answer the same. Of the others those engines keep around the volume, none
 * applies here, each for the same reason, a system the engine has not: a function of light that
 * modulates a lamp's scattering by a material, a texture on a rectangle's face, the injection of
 * lights the GPU traces rays for, and the screen-space blur of the fog.
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
 *  `volumetricFogHistoryShare`, 0.9 — the share of the history kept, any number: a share past 1
 *  or below 0 extrapolates the history, as the engines that fixed it let it;
 *  `volumetricFogSliceSpread`, 32 — how the slices are spread along the depth, more of
 *  them near the eye the smaller it is, any number but 0 (the slices divide by it; a negative one
 *  puts them nearer the far end);
 *  `volumetricFogGlow`, on — the fog's own light is read;
 *  `volumetricFogSkipHidden`, on — a cell wholly behind the surfaces of its pixels is not
 *  lit;
 *  `volumetricFogLampSoftening`, 1 — the share of a cell's size added to the distance a local
 *  light's inverse-square falloff is taken at, against the spike near the light;
 *  `volumetricFogSampleScatter`, 0 — a random offset, in cells, added to each lighting sample;
 *  `volumetricFogSurfaceLift`, 0.5 — in cells, how far a cell's sample is moved out of the
 *  depth buffer along the depth, any negative number not at all;
 *  `volumetricFogLiftRange`, 1 — in cells, how far a sample behind the depth buffer is still
 *  brought forward;
 *  `volumetricFogEdgeFade`, 0 — where above 0, the edge of a spot's cone and of a rectangle's
 *  plane fade over that many cells, so that they flicker less;
 *  `volumetricFogReadJitter`, 0 — a random offset, in cells, of the point a surface reads the
 *  volume at, which hides the cells' pixelisation;
 *  `fogEnabled`, on — any fog at all, the analytic one, the volume and the atmosphere's haze over
 *  the surfaces included;
 *  `fogReadsAtmosphere`, on — the atmosphere's sky and its sun on the ground add to the fog's
 *  colour and lobe;
 *  `fogMatchesVolume`, off — the fog's colour, its lobe's phase and its albedo are the volume's;
 *  `fogOrthoHeightAdjustment`, on — an orthographic view measures the fog from the height its own
 *  position gives, not from its eye. */
export const VOLUMETRIC_FOG_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('volumetricFogQuality', DEFAULT_VOLUMETRIC_FOG_LEVEL, VOLUMETRIC_FOG_LEVELS),
    choice('volumetricFogReadFilter', 'trilinear', VOLUMETRIC_FOG_FILTERS),
    flag('volumetricFogUsesHistory', true),
    flag('volumetricFogMovesSamples', true),
    number('volumetricFogHistoryShare', 0.9, ANY_NUMBER),
    nonZero('volumetricFogSliceSpread', 32, 'a finite number but 0, which the slices divide by'),
    flag('volumetricFogGlow', true),
    flag('volumetricFogSkipHidden', true),
    number('volumetricFogLampSoftening', 1, ANY_NUMBER),
    number('volumetricFogSampleScatter', 0, ANY_NUMBER),
    number('volumetricFogSurfaceLift', 0.5, ANY_NUMBER),
    number('volumetricFogLiftRange', 1, ANY_NUMBER),
    number('volumetricFogEdgeFade', 0, ANY_NUMBER),
    number('volumetricFogReadJitter', 0, ANY_NUMBER),
    flag('fogEnabled', true),
    flag('fogReadsAtmosphere', true),
    flag('fogMatchesVolume', false),
    flag('fogOrthoHeightAdjustment', true),
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

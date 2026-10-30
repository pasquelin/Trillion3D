import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  ANY_NUMBER,
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonZeroSetting as nonZero,
  positiveSetting as positive,
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
 * Five switches are the fog's as a whole, not the volume's: whether any fog is drawn, whether the
 * atmosphere's light adds to it, whether it is made to match the volume, whether an orthographic
 * view measures its height from the view's own, and whether the sky light's capture lights it. The
 * engines that fixed them keep the last four as project settings that choose a program; here they
 * are read at each image, which a program that had been chosen would answer the same. Rectangle lights light the volume by their form factor and
 * darken it by their shadow map (`volumetricFogLocalShadows`), and the functions of light multiply
 * the colour of the sun and, where `lightFunctionFog` is set, of each local light
 * (`./lightFunctionOptions.ts`). Of the systems those engines keep around the volume,
 * the local fog volumes' culling has two the engine's not: its run on a queue of its own — the pass runs with the frame's
 * others — and the debug view of each tile's count of volumes; no setting stands for either.
 */

/** The volume's quality levels, `off` first, then coarsest to finest. */
const VOLUMETRIC_FOG_LEVELS = ['off', 'low', 'high', 'ultra'] as const
/** A quality level of the volume. */
export type VolumetricFogLevel = (typeof VOLUMETRIC_FOG_LEVELS)[number]
/** The level the engine draws at when none is named. */
const DEFAULT_VOLUMETRIC_FOG_LEVEL = 'high' satisfies VolumetricFogLevel

/** What a level fixes: the side of a cell in pixels, the cells along the depth, and the lighting
 *  samples a cell takes where its history is missing (1, 4, 8 or 16). */
export interface VolumetricFogKnobs {
  readonly cellSize: number
  readonly sliceCount: number
  readonly rebuildSamples: number
}

/** The knobs of each level that draws a volume; `off` draws none. */
const VOLUMETRIC_FOG_LEVEL_KNOBS = {
  low: { cellSize: 16, sliceCount: 64, rebuildSamples: 4 },
  high: { cellSize: 8, sliceCount: 128, rebuildSamples: 4 },
  ultra: { cellSize: 4, sliceCount: 128, rebuildSamples: 16 },
} as const satisfies Record<Exclude<VolumetricFogLevel, 'off'>, VolumetricFogKnobs>

/** The knobs of a level: none for `off`. */
export const volumetricFogKnobs = (level: VolumetricFogLevel): VolumetricFogKnobs | undefined =>
  level === 'off' ? undefined : VOLUMETRIC_FOG_LEVEL_KNOBS[level]

/** The ways the fog may be drawn into textures of its own: when the scene asks for it, never, always. */
export const FOG_SEPARATE_COMPOSITION = ['auto', 'off', 'on'] as const

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
 *  `volumetricFogVoxelizationSlicesPerPass`, 8 — the slices of an object voxelised into the volume
 *  (`../scene/volume/contracts.ts`) that make one pass, at least 1;
 *  `volumetricFogVoxelizationShowOnlyPass`, −1 — from 0, the one pass of each object that is
 *  voxelised, to see where the passes lie; −1 all of them;
 *  `volumetricFogEdgeFade`, 0 — where above 0, the edge of a spot's cone and of a rectangle's
 *  plane fade over that many cells, so that they flicker less;
 *  `volumetricFogReadJitter`, 0 — a random offset, in cells, of the point a surface reads the
 *  volume at, which hides the cells' pixelisation;
 *  `volumetricFogLocalShadows`, on — a point, spot or rectangle light whose shadow darkens the fog (its
 *  `shadowsFog`) reads its shadow map in the volume; off, every local light lights it whole, the sun
 *  keeping its own;
 *  `volumetricFogInjectRaytracedLights`, off — the sun and the local lights that cast their shadow by rays (`rayTracedShadows`,
 *  `castRayTracedShadow`) are shadowed in the volume by a ray from each cell's first sample through the scene's triangles (the first 32 lights of the light buffer),
 *  the sun's ray multiplying its other shadows, a local light's replacing its shadow map;
 *  `volumetricFogRectLightTexture`, off — a rectangle light that names a picture (`SceneLight.sourceTexture`) tints its light in the
 *  volume by the picture's colour where the ray from the cell meets the face;
 *  `localFogVolumeSupport`, on — the project switch of the local fog volumes (`../scene/localFog/contracts.ts`),
 *  read once when the session opens (changing it later changes nothing): off, no program holds any of
 *  their code, and no pass, buffer or block is made for them; the objects can still be declared;
 *  `localFogVolumes`, on — the local fog volumes of the scene are drawn;
 *  `localFogVolumeInVolume`, on — where the scene's fog has a volume, the local fog volumes are
 *  voxelised into it, under its light, and the analytic law draws only what lies past the volume's far
 *  end; off, they are drawn by the analytic law alone, whole, over the finished fog, the volume's light
 *  too;
 *  `localFogVolumeMaxVolumeDensity`, 1 — the most extinction a local fog volume gives a cell of the
 *  volume, per metre, 0 or more (held to it): the engines that fixed it write 0.01 per centimetre, the
 *  density of a volume's bottom, where its height law is steepest, making the volume's history leak;
 *  `localFogVolumeStartDistance`, 10 — the distance from the eye, metres, before which no local fog
 *  volume shows, whatever its own: 1000 centimetres of the engines that fixed it, held to 0.1 or more;
 *  `localFogVolumeMaxCount`, 32 — the most local fog volumes a view draws, the nearest and those of the
 *  highest priority kept, held to 1…256;
 *  `localFogVolumeTileSize`, 128 — the side, in pixels, of the tiles of the screen the local fog volumes
 *  are culled by: each tile keeps the list of the volumes over it, and a pixel or a cell walks the list
 *  of its tile alone; held to 8…512, the lists made for the tile grid the view cuts and only while a
 *  view draws a volume;
 *  `localFogVolumeUsesDepthPyramid`, on — a tile's list drops a volume that lies wholly behind the
 *  surfaces the depth pyramid holds over the volume's footprint; off, or with no pyramid for the image, the
 *  tile's frustum alone culls;
 *  `localFogVolumeOnTranslucent`, off — the translucent surfaces are fogged by the local fog volumes too;
 *  `fogEnabled`, on — any fog at all, the analytic one, the volume and the atmosphere's haze over
 *  the surfaces included;
 *  `fogReadsAtmosphere`, on — the atmosphere's sky and its sun on the ground add to the fog's
 *  colour and lobe;
 *  `fogMatchesVolume`, off — the fog's colour, its lobe's phase and its albedo are the volume's;
 *  `fogOrthoHeightAdjustment`, on — an orthographic view measures the fog from the height its own
 *  position gives, not from its eye;
 *  `fogReadsSkyLight`, off — the project switch of the sky light lighting the height fog: only with
 *  it on does the fog's `skyLightScattering` (`../scene/core/fogHeight.ts`) read the sky light's
 *  cube;
 *  `fogSeparateComposition`, `auto` — whether the fog is drawn into textures of its own and laid over the
 *  image by a last pass: `auto` when the scene's fog asks for the screen-space scattering
 *  (`SceneHeightFog.screenSpaceScattering`) and the setting below is on, `off` never, `on` always;
 *  `fogScreenSpaceScattering`, on — the screen-space scattering of the fog is allowed; off, the fog
 *  that asks for it is drawn plainly;
 *  `fogScreenSpaceScatteringMaxLuminance`, 10 — the most luminance a texel holds when the
 *  scattering blurs it, above 0 (held to 0.1 or more), so the blur does not saturate on the sun's disc;
 *  `fogScreenSpaceScatteringTemporal`, on — the blur chain's second level is the first level filtered in
 *  time (a history of its own, the camera's motion from the depth, the history held to the box of the
 *  pixel and its neighbours) instead of a box of it, so the blurred fog does not flicker; off, the box;
 *  `fogScreenSpaceScatteringTemporalWeight`, 0.04 — the weight of the new image in that filter, in 0…1:
 *  low values blur and ghost, high ones leave the jitter showing. */
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
    count('volumetricFogVoxelizationSlicesPerPass', 8, 1),
    integer('volumetricFogVoxelizationShowOnlyPass', -1, [-1, Number.MAX_SAFE_INTEGER]),
    number('volumetricFogEdgeFade', 0, ANY_NUMBER),
    number('volumetricFogReadJitter', 0, ANY_NUMBER),
    flag('volumetricFogLocalShadows', true),
    flag('volumetricFogRectLightTexture', false),
    flag('volumetricFogInjectRaytracedLights', false),
    flag('localFogVolumeSupport', true),
    flag('localFogVolumes', true),
    flag('localFogVolumeInVolume', true),
    number('localFogVolumeMaxVolumeDensity', 1, ANY_NUMBER),
    number('localFogVolumeStartDistance', 10, ANY_NUMBER),
    count('localFogVolumeMaxCount', 32, 0),
    count('localFogVolumeTileSize', 128, 0),
    flag('localFogVolumeUsesDepthPyramid', true),
    flag('localFogVolumeOnTranslucent', false),
    flag('fogEnabled', true),
    flag('fogReadsAtmosphere', true),
    flag('fogMatchesVolume', false),
    flag('fogOrthoHeightAdjustment', true),
    flag('fogReadsSkyLight', false),
    choice('fogSeparateComposition', 'auto', FOG_SEPARATE_COMPOSITION),
    flag('fogScreenSpaceScattering', true),
    positive('fogScreenSpaceScatteringMaxLuminance', 10),
    flag('fogScreenSpaceScatteringTemporal', true),
    number('fogScreenSpaceScatteringTemporalWeight', 0.04, [0, 1]),
  ] as const))()
/** The field of one setting of the volume. */
export type VolumetricFogField = keyof typeof VOLUMETRIC_FOG_RULES
/** The volume's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type VolumetricFogOptions = SettingOptions<typeof VOLUMETRIC_FOG_RULES>
/** The volume's settings with every field set: the defaults for those a host leaves out. */
export type VolumetricFogValues = SettingValues<typeof VOLUMETRIC_FOG_RULES>

/** The least a local fog volume's global start distance is held to, metres: 10 centimetres. */
const LOCAL_FOG_LEAST_START_DISTANCE = 0.1
/** The most local fog volumes a view may draw: a volume's index is kept in a byte. */
export const LOCAL_FOG_MOST_VOLUMES = 256
/** The side of a local fog volumes' culling tile, pixels, held between the least and the most. */
const LOCAL_FOG_TILE_PIXELS = { least: 8, most: 512 } as const

/** The local fog volumes' settings held to their ranges (`localFogLimits`). */
export interface LocalFogLimits {
  startDistance: number
  maxVolumeDensity: number
  maxCount: number
  tileSize: number
}

/** The local fog volumes' settings as the frame holds them to their ranges, which the settings take
 *  as any number, the way the engines that fixed them clamp what they read: the start distance from
 *  `LOCAL_FOG_LEAST_START_DISTANCE`, the density cap from 0, the count to 1…`LOCAL_FOG_MOST_VOLUMES`, the
 *  tile's side to `LOCAL_FOG_TILE_PIXELS`. Written into `out` where one is given (an image allocates
 *  none), else into a new object. */
export function localFogLimits<T extends Partial<LocalFogLimits> = object>(
  values: Pick<
    VolumetricFogValues,
    | 'localFogVolumeStartDistance'
    | 'localFogVolumeMaxVolumeDensity'
    | 'localFogVolumeMaxCount'
    | 'localFogVolumeTileSize'
  >,
  out: T = {} as T,
): T & LocalFogLimits {
  const held = out as T & LocalFogLimits
  held.startDistance = Math.max(LOCAL_FOG_LEAST_START_DISTANCE, values.localFogVolumeStartDistance)
  held.maxVolumeDensity = Math.max(0, values.localFogVolumeMaxVolumeDensity)
  held.maxCount = clamp(values.localFogVolumeMaxCount, 1, LOCAL_FOG_MOST_VOLUMES)
  held.tileSize = clamp(
    values.localFogVolumeTileSize,
    LOCAL_FOG_TILE_PIXELS.least,
    LOCAL_FOG_TILE_PIXELS.most,
  )
  return held
}

/** What each quality level below the top writes of the quality level: no volume at `smooth` and
 *  `balanced`, the low level at `fine`; `max` writes nothing, the default level
 *  (`runtime/qualityLevels.ts`); `cinematic` the finest, whose grid is the fifth row's: cells of 4
 *  pixels, 128 slices, 16 samples. */
export const VOLUMETRIC_FOG_PRESET_LEVELS = {
  smooth: { volumetricFogQuality: 'off' },
  balanced: { volumetricFogQuality: 'off' },
  fine: { volumetricFogQuality: 'low' },
  cinematic: { volumetricFogQuality: 'ultra' },
} as const satisfies Record<string, { volumetricFogQuality: VolumetricFogLevel }>

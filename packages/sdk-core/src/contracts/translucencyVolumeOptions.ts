import {
  atLeast,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the translucency lighting volume (`packages/sdk-browser/src/lighting/translucency/`):
 * a field of the direct light around the camera, in two nested cascades of cells, that the
 * see-through surfaces whose material says so (`Material.translucencyLighting`: `'volume'`,
 * `'volumetric'`, `'volumetricNonDirectional'`) read in place of lighting each pixel by every light. Each
 * image the lights are injected into the cells — the sun and every local light, each by its own
 * shadow map read at the cell —, the cells are blended with the image before where asked, then blurred, and
 * the surfaces read them by trilinear fetches; a surface past the outer cascade reads the sun's light unshadowed and no
 * local light's. Run-time settings, as `./settingRules.ts` says. The reference's switch for the
 * sun's legacy cascaded shadow in the injection has no setting: the engine has the virtual shadow
 * maps alone, which the injection always reads.
 *
 * Each cascade is a cube of `translucencyVolumeDim` cells a side that follows the camera: the inner one holds the
 * view out to `translucencyVolumeInnerDistance` metres, the outer one the stretch from there to
 * `translucencyVolumeOuterDistance`. Their centres are snapped to a whole number of cells, so the light does not
 * crawl as the camera moves; a cascade's size follows a field of view of 45 degrees and a square view, unless
 * `translucencyVolumeAdaptToPerspective` takes the camera's own (at least `translucencyVolumeMinFov` degrees, rounded
 * up to a multiple of `translucencyVolumeFovSnap`, which makes the volume jump in steps as the field animates).
 *
 * The quality presets write the cells' count and the blur (`TRANSLUCENCY_VOLUME_PRESET_LEVELS`): the two
 * coarsest presets use fewer cells and no blur.
 */

/** The volume's run-time settings by field, each with the reference's default:
 *  `translucencyVolume`, on — the volume is made at all; off, every surface that reads it reads black;
 *  `translucencyVolumeDim`, 64 — the cells a side of a cascade, 4 to 2048, held to the device's 3D texture limit;
 *  `translucencyVolumeInnerDistance`, 15 — the metres from the camera the inner cascade ends at;
 *  `translucencyVolumeOuterDistance`, 50 — the metres from the camera the outer cascade ends at;
 *  `translucencyVolumeBlur`, on — the spatial filter: each cell is the mean of eight trilinear reads round it;
 *  `translucencyVolumeTemporal`, off — each cell is blended with the same point of the volume of the image
 *  before, ahead of the spatial filter, which then blurs the blended volume;
 *  `translucencyVolumeHistoryWeight`, 0.9 — the share of that history kept, 0 to 1;
 *  `translucencyVolumePositionOffsetRadius`, 0 — cells, the radius of a noise that moves the point a
 *  surface reads the volume at, a pixel at a time, against the cells' squares; 0 none;
 *  `translucencyVolumeAdaptToPerspective`, off — the cascades follow the camera's field of view and aspect;
 *  `translucencyVolumeMinFov`, 45 — degrees, the least field of view they follow;
 *  `translucencyVolumeFovSnap`, 10 — degrees, the field is rounded up to a multiple of it;
 *  `translucencyVolumeMarkVoxels`, off — the cells the see-through surfaces read are marked in a pass of their own before the volume
 *  is made, and only those (and the corners round them) are lit and filtered; the others hold nothing. */
export const TRANSLUCENCY_VOLUME_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('translucencyVolume', true),
    integer('translucencyVolumeDim', 64, [4, 2048]),
    nonNegative('translucencyVolumeInnerDistance', 15),
    nonNegative('translucencyVolumeOuterDistance', 50),
    flag('translucencyVolumeBlur', true),
    flag('translucencyVolumeTemporal', false),
    number('translucencyVolumeHistoryWeight', 0.9, [0, 1]),
    nonNegative('translucencyVolumePositionOffsetRadius', 0),
    flag('translucencyVolumeAdaptToPerspective', false),
    number('translucencyVolumeMinFov', 45, atLeast(0)),
    number('translucencyVolumeFovSnap', 10, atLeast(0.001)),
    flag('translucencyVolumeMarkVoxels', false),
  ] as const))()
/** The field of one setting of the volume. */
export type TranslucencyVolumeField = keyof typeof TRANSLUCENCY_VOLUME_RULES
/** The volume's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type TranslucencyVolumeOptions = SettingOptions<typeof TRANSLUCENCY_VOLUME_RULES>
/** The volume's settings with every field set. */
export type TranslucencyVolumeValues = SettingValues<typeof TRANSLUCENCY_VOLUME_RULES>

/** What each quality preset below the top writes: the reference's effects levels 0 and 1 hold 24 and 32
 *  cells a side and no blur; the levels above, and `cinematic`, write nothing (`runtime/qualityLevels.ts`). */
export const TRANSLUCENCY_VOLUME_PRESET_LEVELS = {
  smooth: { translucencyVolumeDim: 24, translucencyVolumeBlur: false },
  balanced: { translucencyVolumeDim: 32, translucencyVolumeBlur: false },
  fine: {},
  cinematic: {},
} as const satisfies Record<string, Partial<TranslucencyVolumeValues>>

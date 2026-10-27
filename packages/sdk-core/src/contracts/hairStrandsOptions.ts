import { SHADOW_RAY_COUNT_MAX } from './shadowMapOptions.ts'
import {
  ANY_NUMBER,
  atLeast,
  choiceSetting as choice,
  contextReader,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the hair strands: curves a scene file carries (the compiler reads them
 * from its curve nodes into the strands section of the manifest, `docs/FORMAT.md`), drawn as
 * ribbons that face the camera, seen through a visibility buffer of several samples a pixel, and
 * shadowed by the shadow maps (the hair pixels mark and read them like a surface) and by a sparse
 * volume of voxels that counts the strands a light's ray crosses. Run-time settings, as
 * `./settingRules.ts` says; the quality levels write none of them. Each default is a new
 * project's.
 *
 * THE SWITCH. `hairStrands`, off: the strands are neither drawn nor shadowed, and a scene that
 * carries curves loads them as it loads any other object. One switch stands for the three that
 * gate the strands of a new project (the feature's presence, the whole hair system, the strands
 * among its forms): the last two are on and add no state of their own, the first is off until a
 * scene asks for the feature, so the switch is off. The hair that is a card or a mesh is a
 * surface this engine already draws.
 *
 * THE VISIBILITY. The strands are drawn into a buffer that holds several samples a pixel.
 * `hairVisibilitySamplesPerPixel` is the most a pixel holds: 2, 4 or 8, a value between rounded up
 * to the next (the samples are at the standard multisample positions of that count, and a
 * compute raster writes them whatever the device's own multisample counts);
 * `hairVisibilityMeanSamplesPerPixel` scales the memory kept for them (0 to 1). A pixel counts
 * as fully covered from `hairVisibilityFullCoverageThreshold`;
 * `hairVisibilitySortByDepth` orders the samples of a pixel by depth and gives them their coverage
 * from the ordered transmittance; `hairVisibilityResolutionScaleAware` scales the strands with the
 * resolution scale.
 * `hairRasterizationScale` scales the least width a strand is drawn with, in the share of a pixel
 * the samples of the visibility leave it (the width that snaps a strand to a sample of its pixel);
 * `hairStableRasterizationScale`, held to 1 at least, is that scale for a groom drawn stable, whose
 * width then does not follow the samples' share. The samples of a pixel are listed by strand: the
 * settings that would merge those whose depth and tangent are close, map the hair count to a coverage,
 * set the distance from which the opaque depth is injected into the hair count, and scale the strands
 * drawn for their velocity or in a shadow view, come with the passes that read them.
 *
 * THE STRANDS' MATERIAL. A strand takes the default strand material's colour and roughness: no
 * material a groom names reads the colours and roughness its file may carry. `hairStableRasterization`
 * draws the strands at the stable width (`hairStableRasterizationScale`), `hairScatterSceneLighting`
 * lets them light the scene behind them (the surfaces they cover keep their own surface), and
 * `hairCastContactShadow` lets the surfaces they cover cast contact shadows.
 *
 * THE STRANDS OUT OF VIEW. `hairCastShadowWhenOutOfView` keeps a groom that lies outside the
 * camera's frustum in the macro groups, to cast its shadow, when a light that casts reaches it;
 * `hairOutOfViewShadowDistance` is, in metres, how far along a sun's direction the groom's bounds
 * are extended before they are tested against the view.
 *
 * THE VOXELS. `hairVoxelization` builds the volume the shadow ray crosses; `hairVoxelizationAabbScale`
 * scales the box of a group of strands. `hairVoxelDensityScale` scales the density the strands
 * give a voxel, and `hairVoxelDensityScaleShadow` replaces it for the shadow where it is 0 or
 * more. `hairVoxelDepthBiasScaleShadow` moves the start of the shadow ray toward the light, in
 * voxels. `hairVoxelSteppingScale` (1 to 10) scales the march's step and
 * `hairVoxelSteppingScaleShadow` replaces it for the shadow where it is 0 or more, held to 1 to 10.
 * The volume is a grid of pages of `hairVoxelPageResolution` voxels a side (rounded up to a power of
 * two), `hairVoxelPageCountPerDim` of them a side, each voxel `hairVoxelWorldSize` centimetres
 * wide at least and as many pixels `hairVoxelSizeInPixel` says; `hairVoxelAdaptive` follows the
 * pages the view needs (`hairVoxelAdaptiveCorrectionSpeed`, `hairVoxelAdaptiveCorrectionThreshold`),
 * `hairVoxelGpuDriven` allocates them on the GPU with page indices of
 * `hairVoxelGpuDrivenMinPageIndexResolution` and `hairVoxelGpuDrivenMaxPageIndexResolution` a side,
 * and `hairVoxelInvalidateEmptyPageIndex` leaves the empty ones out. `hairVoxelInjectOpaqueDepth`
 * writes the opaque surface into the volume as an occluder, `hairVoxelInjectOpaqueBiasCount` voxels
 * under it and `hairVoxelInjectOpaqueMarkCount` voxels deep. `hairVoxelJitter` is how the
 * voxelization and the march are jittered.
 *
 * THE SHADOW RAYS. `shadowSmrtSamplesPerRayHair` is the rays a pixel of the strands casts toward a
 * light, held to the number the light casts.
 */

/** How the voxelization and the march are jittered, the default first. */
const VOXEL_JITTERS = ['randomized', 'none', 'constant'] as const

/** The hair strands' run-time settings by field, each with its default. */
export const HAIR_STRANDS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('hairStrands', false),
    integer('hairVisibilitySamplesPerPixel', 8, [2, 8]),
    number('hairVisibilityMeanSamplesPerPixel', 0.75, [0, 1]),
    number('hairVisibilityFullCoverageThreshold', 0.98, [0.1, 1]),
    flag('hairVisibilitySortByDepth', false),
    flag('hairVisibilityResolutionScaleAware', true),
    flag('hairStableRasterization', false),
    flag('hairScatterSceneLighting', false),
    flag('hairCastContactShadow', true),
    nonNegative('hairRasterizationScale', 0.5),
    number('hairStableRasterizationScale', 1, atLeast(1)),
    flag('hairCastShadowWhenOutOfView', true),
    nonNegative('hairOutOfViewShadowDistance', 20),
    flag('hairVoxelization', true),
    number('hairVoxelizationAabbScale', 1, [0.01, 10]),
    nonNegative('hairVoxelDensityScale', 2),
    number('hairVoxelDensityScaleShadow', -1, ANY_NUMBER),
    nonNegative('hairVoxelDepthBiasScaleShadow', 2),
    number('hairVoxelSteppingScale', 1.15, [1, 10]),
    number('hairVoxelSteppingScaleShadow', -1, ANY_NUMBER),
    number('hairVoxelWorldSize', 0.3, [0.01, 100]),
    integer('hairVoxelPageResolution', 32, [2, 256]),
    count('hairVoxelPageCountPerDim', 14, 1),
    integer('hairVoxelSizeInPixel', 1, [1, 50]),
    flag('hairVoxelAdaptive', true),
    number('hairVoxelAdaptiveCorrectionSpeed', 0.1, [0, 1]),
    number('hairVoxelAdaptiveCorrectionThreshold', 0.9, [0, 1]),
    flag('hairVoxelGpuDriven', true),
    count('hairVoxelGpuDrivenMinPageIndexResolution', 32, 1),
    count('hairVoxelGpuDrivenMaxPageIndexResolution', 64, 1),
    flag('hairVoxelInvalidateEmptyPageIndex', true),
    flag('hairVoxelInjectOpaqueDepth', true),
    count('hairVoxelInjectOpaqueBiasCount', 3, 0),
    count('hairVoxelInjectOpaqueMarkCount', 6, 0),
    choice('hairVoxelJitter', 'randomized', VOXEL_JITTERS),
    integer('shadowSmrtSamplesPerRayHair', 1, [1, SHADOW_RAY_COUNT_MAX]),
  ] as const))()
/** The hair strands setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readHairStrandsSetting = /* @__PURE__ */ contextReader(HAIR_STRANDS_RULES)
/** The field of one setting of the hair strands. */
export type HairStrandsField = keyof typeof HAIR_STRANDS_RULES
/** The hair strands' settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type HairStrandsOptions = SettingOptions<typeof HAIR_STRANDS_RULES>

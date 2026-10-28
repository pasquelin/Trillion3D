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
 * to the next (the samples are at the standard multisample positions of that count);
 * `hairVisibilityComputeRaster` picks who writes them: off, the device's own rasterizer draws the
 * ribbons into a four-sample target, a pass for each four samples; on, a compute raster does, whatever
 * the device's own multisample counts;
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
 * drawn for their velocity, come with the pass that reads them.
 *
 * THE STRANDS' MATERIAL. A strand takes the default strand material's colour and roughness: no
 * material a groom names reads the colours and roughness its file may carry. `hairStableRasterization`
 * draws the strands at the stable width (`hairStableRasterizationScale`), `hairScatterSceneLighting`
 * lets them light the scene behind them (the surfaces they cover keep their own surface), and
 * `hairCastContactShadow` lets the surfaces they cover cast contact shadows. The first two are the
 * project's setting; a compile job sets them for a group of a groom (`hairGroups`,
 * `hairGroupsOptions.ts`), the group a job names keeping its own.
 *
 * THE STRANDS OUT OF VIEW. `hairCastShadowWhenOutOfView` keeps a groom that lies outside the
 * camera's frustum in the macro groups, to cast its shadow, when a light that casts reaches it;
 * `hairOutOfViewShadowDistance` is, in metres, how far along a sun's direction the groom's bounds
 * are extended before they are tested against the view.
 *
 * WHERE THE STRANDS GO. `hairStrandsComposition` puts the lit strands on the image after the transparents
 * (`afterTranslucent`, the default), before them (`beforeTranslucent`), or after the separate translucency
 * (`afterSeparateTranslucent`, `afterTranslucentBeforeDepthOfField`); the fog along the way to them is taken in
 * wherever they are put. `hairScatterSceneLighting` lets the strands of a group flagged to scatter the scene's light
 * (`hairGroups`) take it from the lit image instead of the sky's.
 *
 * THE VOXELS. `hairVoxelization` builds the volume the shadow ray crosses; `hairVoxelizationAabbScale`
 * scales the box of a group of strands. `hairVoxelDensityScale` scales the density the strands
 * give a voxel, and `hairVoxelDensityScaleShadow` replaces it for the shadow where it is 0 or
 * more. `hairVoxelDepthBiasScaleShadow` moves the start of the shadow ray toward the light, in
 * voxels. `hairVoxelSteppingScale` (1 to 10) scales the march's step and
 * `hairVoxelSteppingScaleShadow` replaces it for the shadow where it is 0 or more, held to 1 to 10.
 * The transmittance toward a light reads its own: `hairVoxelDensityScaleTransmittance` and
 * `hairVoxelSteppingScaleTransmittance` replace the density and the stepping where they are 0 or more,
 * `hairVoxelDepthBiasScaleTransmittance` moves the start of the ray toward the light, in voxels;
 * `hairTransmittanceSuperSampling` takes eight rays a sample, `hairTransmittanceMipTraversal` marches
 * through the levels of the pages. A light that casts hair deep shadows (`castHairDeepShadow`, off) is
 * drawn into an atlas of `hairDeepShadowResolution` texels a side (tiles of `hairDeepShadowMinResolution`
 * at least), its frustum held to `hairDeepShadowMaxFrustumAngle` degrees and its box scaled by
 * `hairDeepShadowAabbScale`, the strands at the width `hairShadowRasterizationScale` snaps them to;
 * `hairDeepShadowKernelType` (0 none, 1 2x2, 2 6x6, 3 soft with `hairDeepShadowKernelAperture` degrees, 4 none)
 * filters the layers, `hairDeepShadowDensityScale` scales their count and `hairDeepShadowDepthBiasScale`
 * biases their depth. The shadow the strands cast on the surfaces, in the classic shadow mode, is filtered by `hairDeepShadowMaskKernelType`
 * (0 a 2x2 filter, 1 a 4x4 one, 2 and 3 Gaussians of 8 and 16 taps, 4 a Gaussian of 8 taps on the hair count of the layers, the default) and, when the voxels give it, its rays
 * are jittered by `hairDeepShadowRandomType` (0 the interleaved gradient noise, 1 the same with the second pair, 2 the blue noise, the default); it reads
 * the voxel densities and stepping of the shadow (`hairVoxelDensityScaleShadow`, `hairVoxelSteppingScaleShadow`) and the bias `hairVoxelDepthBiasScaleShadow`. `hairVoxelForceTransmittanceAndShadow` takes the transmittance and the shadow
 * from the voxels alone, no deep shadow drawn.
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
 * THE ENVIRONMENT'S LIGHT. `hairEnvironmentIntegration` is how the strands take it: `sh`, the default, the sky's diffuse light weighed by the fibre's response (or, with
 * the bounce, the radiance cache's along the direction the fibre is seen from); `adhoc`, the reflected direction and the fibre's multiple scattering gathered from
 * the cache or the sky, the hair on the way counted in the voxels; `uniform`, directions spread evenly over the sphere, each weighed by the fibre's response and the voxels' visibility.
 * `hairSkyLightingSampleCount` is the directions a point casts, `hairSkyLightingDistanceThreshold` the centimetres the voxels are searched,
 * `hairSkyLightingScreenTraceOcclusion` whether the screen occludes the directions (`uniform`, and `sh` with the cache), and
 * `hairVoxelDensityScaleEnvironment` (the voxel density where below 0) the density the strands give a voxel there.
 *
 * THE SKY'S OCCLUSION. `hairSkyAO` lets the strands darken the ambient occlusion of the surfaces about them: `hairSkyAOSampleCount` rays
 * a pixel are marched through the voxels as far as `hairSkyAODistanceThreshold` centimetres, with the density `hairVoxelDensityScaleAO` (the
 * voxel density where it is below 0), the stepping `hairVoxelSteppingScaleEnvironment` (the voxel stepping where below 0) and the start of the
 * rays moved `hairVoxelDepthBiasScaleEnvironment` voxels along them.
 *
 * THE SHADOW RAYS. `shadowSmrtSamplesPerRayHair` is the rays a pixel of the strands casts toward a
 * light, held to the number the light casts.
 */

/** How the strands integrate the environment's light, the default first. */
const ENVIRONMENT_INTEGRATIONS = ['sh', 'adhoc', 'uniform'] as const

/** Where the strands are laid on the image, the default first: after the transparents drawn in the lit image, before the transparents, after the
 *  separate translucency, or after the transparents but before the translucency composed after the depth of field. */
const COMPOSITIONS = [
  'afterTranslucent',
  'beforeTranslucent',
  'afterSeparateTranslucent',
  'afterTranslucentBeforeDepthOfField',
] as const

/** How the voxelization and the march are jittered, the default first. */
const VOXEL_JITTERS = ['randomized', 'none', 'constant'] as const

/** The settings of the strands' visibility, their raster and their composition. */
const visibilityRules = () =>
  [
    flag('hairStrands', false),
    integer('hairVisibilitySamplesPerPixel', 8, [2, 8]),
    number('hairVisibilityMeanSamplesPerPixel', 0.75, [0, 1]),
    number('hairVisibilityFullCoverageThreshold', 0.98, [0.1, 1]),
    flag('hairVisibilitySortByDepth', false),
    flag('hairVisibilityResolutionScaleAware', true),
    flag('hairVisibilityComputeRaster', false),
    flag('hairStableRasterization', false),
    flag('hairScatterSceneLighting', false),
    choice('hairStrandsComposition', 'afterTranslucent', COMPOSITIONS),
    flag('hairCastContactShadow', true),
    nonNegative('hairRasterizationScale', 0.5),
    nonNegative('hairShadowRasterizationScale', 1),
    number('hairStableRasterizationScale', 1, atLeast(1)),
    flag('hairCastShadowWhenOutOfView', true),
    nonNegative('hairOutOfViewShadowDistance', 20),
  ] as const

/** The settings of the voxel volume and of the strands' lighting of the environment. */
const volumeRules = () =>
  [
    flag('hairVoxelization', true),
    number('hairVoxelizationAabbScale', 1, [0.01, 10]),
    nonNegative('hairVoxelDensityScale', 2),
    number('hairVoxelDensityScaleShadow', -1, ANY_NUMBER),
    nonNegative('hairVoxelDepthBiasScaleShadow', 2),
    number('hairVoxelSteppingScale', 1.15, [1, 10]),
    number('hairVoxelSteppingScaleShadow', -1, ANY_NUMBER),
    number('hairVoxelDensityScaleTransmittance', -1, ANY_NUMBER),
    nonNegative('hairVoxelDepthBiasScaleTransmittance', 3),
    number('hairVoxelSteppingScaleTransmittance', -1, ANY_NUMBER),
    number('hairVoxelDensityScaleAO', -1, ANY_NUMBER),
    nonNegative('hairVoxelDepthBiasScaleEnvironment', 1.8),
    number('hairVoxelSteppingScaleEnvironment', -1, ANY_NUMBER),
    choice('hairEnvironmentIntegration', 'sh', ENVIRONMENT_INTEGRATIONS),
    integer('hairSkyLightingSampleCount', 16, [1, 256]),
    number('hairSkyLightingDistanceThreshold', 10, atLeast(1)),
    flag('hairSkyLightingScreenTraceOcclusion', false),
    number('hairVoxelDensityScaleEnvironment', -1, ANY_NUMBER),
  ] as const

/** The settings of the sky occlusion, the fibre's table, the deep shadows and the volume's pages. */
const lightRules = () =>
  [
    flag('hairSkyAO', true),
    integer('hairSkyAOSampleCount', 4, [1, 256]),
    number('hairSkyAODistanceThreshold', 10, atLeast(1)),
    flag('hairTransmittanceSuperSampling', false),
    flag('hairTransmittanceMipTraversal', true),
    flag('hairVoxelForceTransmittanceAndShadow', false),
    count('hairLutIncidentAngleCount', 64, 1),
    count('hairLutRoughnessCount', 64, 1),
    count('hairLutAbsorptionCount', 16, 1),
    count('hairLutSampleCountScale', 1, 1),
    flag('hairComponentR', true),
    flag('hairComponentTT', true),
    flag('hairComponentTRT', true),
    flag('hairComponentLocalScattering', true),
    flag('hairComponentGlobalScattering', true),
    flag('hairComponentTTModel', false),
    integer('hairDeepShadowResolution', 2048, [64, 8192]),
    integer('hairDeepShadowMinResolution', 64, [16, 8192]),
    number('hairDeepShadowMaxFrustumAngle', 90, [10, 170]),
    nonNegative('hairDeepShadowAabbScale', 1),
    integer('hairDeepShadowKernelType', 2, [0, 4]),
    integer('hairDeepShadowMaskKernelType', 4, [0, 4]),
    integer('hairDeepShadowRandomType', 2, [0, 2]),
    number('hairDeepShadowKernelAperture', 1, ANY_NUMBER),
    nonNegative('hairDeepShadowDensityScale', 2),
    nonNegative('hairDeepShadowDepthBiasScale', 0.05),
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
  ] as const

/** The hair strands' run-time settings by field, each with its default. */
export const HAIR_STRANDS_RULES = /* @__PURE__ */ (() =>
  rulesOf([...visibilityRules(), ...volumeRules(), ...lightRules()] as const))()
/** The hair strands setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readHairStrandsSetting = /* @__PURE__ */ contextReader(HAIR_STRANDS_RULES)
/** The field of one setting of the hair strands. */
export type HairStrandsField = keyof typeof HAIR_STRANDS_RULES
/** The hair strands' settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type HairStrandsOptions = SettingOptions<typeof HAIR_STRANDS_RULES>

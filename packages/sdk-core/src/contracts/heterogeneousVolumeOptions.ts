import {
  ANY_NUMBER,
  contextReader,
  flagSetting as flag,
  gatedFlagSetting as gatedFlag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings that gate the heterogeneous volumes (`../scene/heterogeneousVolume/`):
 * volumes of a sparse texture (`packages/sdk-browser/src/lighting/heterogeneousVolumes/`) whose
 * medium is read by the sample. Run-time settings, as `./settingRules.ts` says; the quality levels
 * write none of them. Each default is the reference's (`HeterogeneousVolumes.cpp:19-48`).
 *
 * `heterogeneousVolumes`, on — whether the volumes are drawn at all (`r.HeterogeneousVolumes`,
 * `HeterogeneousVolumes.cpp:19`). `heterogeneousVolumesAllowed`, on — whether the device profile
 * allows them (`r.HeterogeneousVolumes.Allowed`, `:26`, a scalability switch: a profile turns it
 * off where the volumes are too dear); both must be on (`IsHeterogeneousVolumesEnabled`, `:358`).
 * `heterogeneousVolumesShadows`, off — whether the volumes cast shadows onto the scene
 * (`r.HeterogeneousVolumes.Shadows`, `:33`). `heterogeneousVolumesTranslucency`, off — whether the
 * volumes are composited with the translucent surfaces, the order of the two being the volumes'
 * own (`r.Translucency.HeterogeneousVolumes`, `:40`); off, the volumes are composited after the
 * translucency (`GetHeterogeneousVolumesComposition`, `:403`). The beer shadow map the cast shadows are read from
 * has a face of `…ShadowsResolution` texels a side, 512 (`HeterogeneousVolumesVoxelGridPipeline.cpp:253`), a
 * `…ShadowsPrecision` of 0 (16 bits a channel) or 1 (32 bits, `LiveShadingPipeline.cpp:2427`), rays starting
 * `…ShadowsNearClippingDistance` from a local light, 1 (`LiveShadingPipeline.cpp:152`), and marched by `…ShadowsStepSize`
 * local units, 2 (`VoxelGridPipeline.cpp:260`).
 *
 * `heterogeneousVolumesComposition`, 0 — where the volumes are composited relative to the translucency, 0 before it, 1 after it (`HeterogeneousVolumes.cpp:63`); it counts
 * only while `heterogeneousVolumesTranslucency` is on, else the volumes are composited after the translucency (`GetHeterogeneousVolumesComposition`, `:403`).
 * `heterogeneousVolumesVelocity`, off — whether the pixel where a volume turns opaque writes the velocity of the point it
 * shows, for the temporal pass (`r.HeterogeneousVolumes.Velocity`, `HeterogeneousVolumes.cpp:333`, read `:761`; only at the highest
 * scalability, `LiveShadingPipeline.usf:396`).
 *
 * The live shading pipeline's settings (`r.HeterogeneousVolumes.*`, `HeterogeneousVolumes.cpp`):
 * `…DownsampleFactor`, 1 — the image is rendered at 1 over this many pixels a side, 1 to 8 (`:56`,
 * clamped `:564`) —; `…Jitter`, on — the march's start is jittered by blue noise (`:159`) —;
 * `…MaxStepCount`, 512 (`:166`); `…StepSize`, -1 — the march's step in local units, none (-1) takes
 * the voxel's (`:263`) — and `…ShadowStepSize` (`:228`); `…MaxTraceDistance` and
 * `…MaxShadowTraceDistance`, 30000 (`:173`, `:180`); `…LightingCache`, 2 — 0 none, 1 caches the
 * transmittance, 2 the in-scattering (`:270`) — and its `…DownsampleFactor`, 0 — the volume's
 * resolution over this (0 takes the volume's own, `:287`) —; `…DepthSort`, on (`:296`); the fog
 * applied to the volumes, `…HeightFog` and `…VolumetricFog` on (`:303`, `:310`) and
 * `…FogInscattering` 2 — 0 none, 1 the reference, 2 a linear approximation (`:317`) —;
 * `…IndirectLightingMode`, 0 — 0 none, 1 in the lighting cache, 2 by single scattering (`:138`) — and
 * `…IndirectLighting`, 0, its factor (`:130`, held at 0 or more): the mode counts while the image made a translucency
 * volume (`HeterogeneousVolumesLiveShadingPipeline.cpp:1430`); `…Scalability`, 3 — 0 low, 1 high, 2 higher, 3 cinematic
 * (`LiveShadingPipeline.cpp:77`): below 3 the fog's in-scattering is the linear approximation and the indirect light the
 * lighting cache's (level 2) or none (`LiveShadingPipeline.usf:410-470`);
 * `…UseExistenceMask`, on — a mask, dilated, of the voxels with extinction culls the lighting cache (cinematic scalability) and the occlusion where there is none
 * (`HeterogeneousVolumesLiveShadingPipeline.cpp:137`);
 * `…AmbientOcclusion`, off — whether the indirect light is darkened by an occlusion computed in the volume (`HeterogeneousVolumesAmbientOcclusionPipeline.cpp:23`), at
 * a voxel resolution of the volume's over `…AmbientOcclusionDownsampleFactor`, 4 (`:30`), by `…RayCountX` x `…RayCountY` rays, 4 x 4 (`:37`, `:44`),
 * each marched to `…MaxTraceDistance`, 1000 (`:51`), in at most `…MaxStepCount` steps, 64 (`:58`);
 * the occlusion's rays count 1 to 8 a side (`HeterogeneousVolumesAmbientOcclusionPipeline.cpp:67-71`), its downsample is held to 0.125-32 (`:61`), its
 * farthest ray to `…MaxShadowTraceDistance` (`:76`) and its most steps to `…MaxStepCount` (`:81`);
 * the continuous level of detail, `…CLOD`, on (`HeterogeneousVolumes.cpp:340`), coarsens a volume's lighting cache, its occlusion, its baked grid
 * and its march's steps with its distance, biased by `…CLODBias`, 0 (`:347`); `…VolumeResolutionX`, `…Y`, `…Z`, 0, each override the resolution
 * the preshading, the lighting and the occlusion take from the volume where above 0 (`:200-226`, `GetVolumeResolution` `:594`);
 * the preshading, `…Preshading`, off (`:186`), bakes the volume's material into three 3D textures, its extinction, albedo and emission, before the
 * march reads them in place of the material (`HeterogeneousVolumesPreshadingPipeline.cpp:1642`); `…PreshadingMipLevel`, 0, the level they are
 * read at (`:193`; the levels above 0 are made by the filter the reference writes and never runs, so the setting acts: a fixed reference bug); `…PreshadingPixelFormat`, 2, the texels they keep: 0 the red channel alone, 1 to 3 three or four channels (`Preshading.cpp:21`);
 * `…PreshadingCLOD`, 1, the baked grid's resolution: 0 the volume's, 1 over the level of detail's factor, 2 the lighting cache's (`:1295`);
 * the kinds of light that light the volumes, `…LightDirectional`, `…LightPoint`, `…LightSpot`, `…LightRect`, all
 * on (`HeterogeneousVolumesLiveShadingPipeline.cpp:88-115`, `SupportsLightType` `:189`);
 * the image rendered below the view's size is brought back by `…Upsample`, 2 — 0 off, 1 nearest, 2
 * bilinear (`:73`) —, then smoothed by `…Filter`, 2 — 0 off, 1 bilateral, 2 Gaussian 3x3, 3
 * Gaussian 5x5 (`:83`) — of `…FilterWidth`, 3, the bilateral kernel's width (`:94`, held to 0-11).
 *
 * The voxel grid pipeline's settings (`HeterogeneousVolumesVoxelGridPipeline.cpp:65-360`, `HeterogeneousVolumes.cpp:109`, `:234-260`):
 * `…ShadowsPipeline`, 0 — 0 shades the volumes live for their shadows, 1 builds the voxel grids and traces the shadows through them
 * (`HeterogeneousVolumes.cpp:109`) —; the frustum grid, `…FrustumGrid` on, its `…ShadingRate` 4 pixels, `…NearPlaneDistance` 1,
 * `…FarPlaneDistance` -1 (the volumes' own), `…DepthSliceCount` 512 (`:65-98`); the ortho grid, `…OrthoGrid` on and its
 * `…ShadingRate` 4 (`:107-114`); the grids' cells, `…BottomLevelGridResolution` 4 (held to 1-4, `:155`) with an indirection grid
 * of `…IndirectionGridResolution` 4 (`:204-218`) when `…IndirectionGrid` is on; the smallest voxel, `…MinimumVoxelSizeInFrustum` 0.1
 * and `…MinimumVoxelSizeOutsideFrustum` 100 (`:169-183`); `…FarPlaneAutoTransition` on (`:218`); `…TopLevelBitmask` off (`:225`);
 * `…MajorantGrid` on and `…MajorantGridMax` off (`:232-239`). The sparse voxels, `…SparseVoxel` off, its `…GenerationMipBias` 0
 * (held to 0-10), `…PerTileCulling` off and `…Refinement` off (`HeterogeneousVolumes.cpp:234-260`). The volumetric shadow map built
 * from the grids: `…ShadowsCameraDownsampleFactor` 2, `…ShadowsMaxSampleCount` 8, `…ShadowsAbsoluteErrorThreshold` 0,
 * `…ShadowsRelativeErrorThreshold` 0.05, `…ShadowsUseAvsmCompression` on, `…ShadowsDebugTweak` 0, `…ShadowsShadingRate` 1,
 * `…ShadowsOutOfFrustumShadingRate` 2, `…ShadowsJitter` off (`VoxelGridPipeline.cpp:245-320`).
 * The bottom level's memory, `…OrthoGridMaxBottomLevelMemoryInMegabytes` and `…FrustumGridMaxBottomLevelMemoryInMegabytes`, 128 each (`:130`, `:100`); a region of a
 * bottom level whose extinction hardly varies is stored as one voxel, `…BottomLevelGridHomogeneousAggregation` on, below the relative error
 * `…BottomLevelGridHomogeneousAggregationThreshold`, 0.001 (`:190-197`). The kinds of light that cast a volumetric shadow,
 * `…ShadowsLightDirectional`, `…ShadowsLightPoint`, `…ShadowsLightSpot`, `…ShadowsLightRect`, all on (`:322-361`, `SupportsShadowForLightType`
 * `:557`). `…Debug`, 0 — 1 to 9 replace the volumes' image by the transmittance through the ortho and frustum grids, by one of nine ways of
 * marching them: 1 the walk through the grid (DDA), 2 to 5 by samples (steps, the majorant, the greatest majorant, the majorant walked by DDA),
 * 6 to 9 by tracking (delta, ratio, spectral ratio, the majorant walked by DDA) (`HeterogeneousVolumes.cpp:116`, `:1145`).
 *
 * `…ShadowsType`, 1 — the map the volumes' cast shadows are kept in: 0 the adaptive volumetric shadow map (a list of samples a texel,
 * `HeterogeneousVolumes.cpp:100`), 1 the beer shadow map. `…HardwareRayTracing`, off (`:123`) — with the preshading on, the march
 * visits only the spans of the sparse voxels a ray meets, found in a hierarchy of boxes built over them (no ray tracing hardware is
 * needed: the hierarchy is walked by a compute pass).
 */
export const HETEROGENEOUS_VOLUME_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('heterogeneousVolumes', true),
    flag('heterogeneousVolumesAllowed', true),
    flag('heterogeneousVolumesShadows', false),
    flag('heterogeneousVolumesTranslucency', false),
    flag('heterogeneousVolumesVelocity', false),
    integer('heterogeneousVolumesComposition', 0, [0, 1]),
    integer('heterogeneousVolumesShadowsResolution', 512, [1, 4096]),
    integer('heterogeneousVolumesShadowsPrecision', 0, [0, 1]),
    number('heterogeneousVolumesShadowsNearClippingDistance', 1, [0, 1e6]),
    number('heterogeneousVolumesShadowsStepSize', 2, [0.001, 1e6]),
    integer('heterogeneousVolumesDownsampleFactor', 1, [1, 8]),
    flag('heterogeneousVolumesJitter', true),
    integer('heterogeneousVolumesMaxStepCount', 512, [1, 65536]),
    number('heterogeneousVolumesStepSize', -1, ANY_NUMBER),
    number('heterogeneousVolumesShadowStepSize', -1, ANY_NUMBER),
    number('heterogeneousVolumesMaxTraceDistance', 30000, [0, 1e9]),
    number('heterogeneousVolumesMaxShadowTraceDistance', 30000, [0, 1e9]),
    integer('heterogeneousVolumesLightingCache', 2, [0, 2]),
    integer('heterogeneousVolumesLightingCacheDownsampleFactor', 0, [0, 64]),
    flag('heterogeneousVolumesDepthSort', true),
    flag('heterogeneousVolumesHeightFog', true),
    flag('heterogeneousVolumesVolumetricFog', true),
    integer('heterogeneousVolumesFogInscattering', 2, [0, 2]),
    integer('heterogeneousVolumesIndirectLightingMode', 0, [0, 2]),
    number('heterogeneousVolumesIndirectLighting', 0, [0, 1e6]),
    integer('heterogeneousVolumesScalability', 3, [0, 3]),
    flag('heterogeneousVolumesUseExistenceMask', true),
    flag('heterogeneousVolumesAmbientOcclusion', false),
    number('heterogeneousVolumesAmbientOcclusionDownsampleFactor', 4, [0.125, 32]),
    integer('heterogeneousVolumesAmbientOcclusionRayCountX', 4, [1, 8]),
    integer('heterogeneousVolumesAmbientOcclusionRayCountY', 4, [1, 8]),
    number('heterogeneousVolumesAmbientOcclusionMaxTraceDistance', 1000, [0, 1e9]),
    integer('heterogeneousVolumesAmbientOcclusionMaxStepCount', 64, [1, 65536]),
    flag('heterogeneousVolumesPreshading', false),
    integer('heterogeneousVolumesPreshadingMipLevel', 0, [0, 10]),
    integer('heterogeneousVolumesPreshadingPixelFormat', 2, [0, 3]),
    integer('heterogeneousVolumesPreshadingCLOD', 1, [0, 2]),
    flag('heterogeneousVolumesCLOD', true),
    number('heterogeneousVolumesCLODBias', 0, ANY_NUMBER),
    integer('heterogeneousVolumesVolumeResolutionX', 0, [0, 1024]),
    integer('heterogeneousVolumesVolumeResolutionY', 0, [0, 1024]),
    integer('heterogeneousVolumesVolumeResolutionZ', 0, [0, 1024]),
    flag('heterogeneousVolumesLightDirectional', true),
    flag('heterogeneousVolumesLightPoint', true),
    flag('heterogeneousVolumesLightSpot', true),
    flag('heterogeneousVolumesLightRect', true),
    integer('heterogeneousVolumesUpsample', 2, [0, 2]),
    integer('heterogeneousVolumesFilter', 2, [0, 3]),
    integer('heterogeneousVolumesFilterWidth', 3, [0, 11]),
    integer('heterogeneousVolumesShadowsPipeline', 0, [0, 1]),
    flag('heterogeneousVolumesFrustumGrid', true),
    number('heterogeneousVolumesFrustumGridShadingRate', 4, [0.1, 1e6]),
    number('heterogeneousVolumesFrustumGridNearPlaneDistance', 1, ANY_NUMBER),
    number('heterogeneousVolumesFrustumGridFarPlaneDistance', -1, ANY_NUMBER),
    integer('heterogeneousVolumesFrustumGridDepthSliceCount', 512, [1, 65536]),
    flag('heterogeneousVolumesOrthoGrid', true),
    number('heterogeneousVolumesOrthoGridShadingRate', 4, [0.1, 1e6]),
    integer('heterogeneousVolumesBottomLevelGridResolution', 4, [1, 4]),
    flag('heterogeneousVolumesIndirectionGrid', true),
    integer('heterogeneousVolumesIndirectionGridResolution', 4, [1, 4]),
    number('heterogeneousVolumesMinimumVoxelSizeInFrustum', 0.1, [0.01, 1e9]),
    number('heterogeneousVolumesMinimumVoxelSizeOutsideFrustum', 100, [0.01, 1e9]),
    flag('heterogeneousVolumesFarPlaneAutoTransition', true),
    flag('heterogeneousVolumesTopLevelBitmask', false),
    flag('heterogeneousVolumesMajorantGrid', true),
    flag('heterogeneousVolumesMajorantGridMax', false),
    flag('heterogeneousVolumesSparseVoxel', false),
    integer('heterogeneousVolumesSparseVoxelGenerationMipBias', 0, [0, 10]),
    flag('heterogeneousVolumesSparseVoxelPerTileCulling', false),
    flag('heterogeneousVolumesSparseVoxelRefinement', false),
    integer('heterogeneousVolumesShadowsCameraDownsampleFactor', 2, [1, 16]),
    integer('heterogeneousVolumesShadowsMaxSampleCount', 8, [1, 64]),
    number('heterogeneousVolumesShadowsAbsoluteErrorThreshold', 0, [0, 1e6]),
    number('heterogeneousVolumesShadowsRelativeErrorThreshold', 0.05, [0, 1e6]),
    flag('heterogeneousVolumesShadowsUseAvsmCompression', true),
    integer('heterogeneousVolumesShadowsDebugTweak', 0, [0, 1024]),
    number('heterogeneousVolumesShadowsShadingRate', 1, [0.1, 1e6]),
    number('heterogeneousVolumesShadowsOutOfFrustumShadingRate', 2, [0.1, 1e6]),
    flag('heterogeneousVolumesShadowsJitter', false),
    integer('heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes', 128, [1, 4096]),
    integer('heterogeneousVolumesFrustumGridMaxBottomLevelMemoryInMegabytes', 128, [1, 4096]),
    flag('heterogeneousVolumesBottomLevelGridHomogeneousAggregation', true),
    number('heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold', 0.001, [0, 1e6]),
    flag('heterogeneousVolumesShadowsLightDirectional', true),
    flag('heterogeneousVolumesShadowsLightPoint', true),
    flag('heterogeneousVolumesShadowsLightSpot', true),
    flag('heterogeneousVolumesShadowsLightRect', true),
    integer('heterogeneousVolumesDebug', 0, [0, 9]),
    integer('heterogeneousVolumesShadowsType', 1, [0, 1]),
    gatedFlag('heterogeneousVolumesHardwareRayTracing', false, 'rayTracingEnable'),
  ] as const))()
/** The heterogeneous volume setting `field` of a runtime's context (`contextReader`): its default
 *  where the context holds none. */
export const readHeterogeneousVolumeSetting = /* @__PURE__ */ contextReader(
  HETEROGENEOUS_VOLUME_RULES,
)
/** The field of one setting of the heterogeneous volumes. */
export type HeterogeneousVolumeField = keyof typeof HETEROGENEOUS_VOLUME_RULES
/** The heterogeneous volume settings as a host writes them, by their fields. */
export type HeterogeneousVolumeOptions = SettingOptions<typeof HETEROGENEOUS_VOLUME_RULES>

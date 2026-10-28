import {
  ANY_NUMBER,
  contextReader,
  flagSetting as flag,
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
 * volume (`HeterogeneousVolumesLiveShadingPipeline.cpp:1430`); `…Scalability`, 3 — 0 low, 1 high, 2 epic, 3 cinematic
 * (`LiveShadingPipeline.cpp:77`): below 3 the fog's in-scattering is the linear approximation and the indirect light the
 * lighting cache's (epic) or none (`LiveShadingPipeline.usf:410-470`);
 * `…UseExistenceMask`, on — a mask, dilated, of the voxels with extinction culls the lighting cache (cinematic scalability) and the occlusion where there is none
 * (`HeterogeneousVolumesLiveShadingPipeline.cpp:137`);
 * `…AmbientOcclusion`, off — whether the indirect light is darkened by an occlusion computed in the volume (`HeterogeneousVolumesAmbientOcclusionPipeline.cpp:23`), at
 * a voxel resolution of the volume's over `…AmbientOcclusionDownsampleFactor`, 4 (`:30`), by `…RayCountX` x `…RayCountY` rays, 4 x 4 (`:37`, `:44`),
 * each marched to `…MaxTraceDistance`, 1000 (`:51`), in at most `…MaxStepCount` steps, 64 (`:58`);
 * the kinds of light that light the volumes, `…LightDirectional`, `…LightPoint`, `…LightSpot`, `…LightRect`, all
 * on (`HeterogeneousVolumesLiveShadingPipeline.cpp:88-115`, `SupportsLightType` `:189`);
 * the image rendered below the view's size is brought back by `…Upsample`, 2 — 0 off, 1 nearest, 2
 * bilinear (`:73`) —, then smoothed by `…Filter`, 2 — 0 off, 1 bilateral, 2 Gaussian 3x3, 3
 * Gaussian 5x5 (`:83`) — of `…FilterWidth`, 3, the bilateral kernel's width (`:94`, held to 0-11).
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
    number('heterogeneousVolumesAmbientOcclusionDownsampleFactor', 4, [0.125, 64]),
    integer('heterogeneousVolumesAmbientOcclusionRayCountX', 4, [1, 32]),
    integer('heterogeneousVolumesAmbientOcclusionRayCountY', 4, [1, 32]),
    number('heterogeneousVolumesAmbientOcclusionMaxTraceDistance', 1000, [0, 1e9]),
    integer('heterogeneousVolumesAmbientOcclusionMaxStepCount', 64, [1, 65536]),
    flag('heterogeneousVolumesLightDirectional', true),
    flag('heterogeneousVolumesLightPoint', true),
    flag('heterogeneousVolumesLightSpot', true),
    flag('heterogeneousVolumesLightRect', true),
    integer('heterogeneousVolumesUpsample', 2, [0, 2]),
    integer('heterogeneousVolumesFilter', 2, [0, 3]),
    integer('heterogeneousVolumesFilterWidth', 3, [0, 11]),
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

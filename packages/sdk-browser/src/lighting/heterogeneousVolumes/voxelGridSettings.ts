import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { HETEROGENEOUS_VOLUME_GRID_VIEWS } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import type { FrustumGridSettings } from './voxelGrid/frustumGridBuild.ts'
import type { GridBuildOptions } from './voxelGrid/gridPlan.ts'
import type { OrthoGridSettings } from './voxelGrid/orthoGridBuild.ts'

type Settings = (field: HeterogeneousVolumeField) => number

/** The cells along a side of a bottom level, from the setting: held to a power of two (a cell is found by the Morton order of its place, which
 *  a side of three would leave holes in: it takes two). */
export const bottomLevelResolutionOf = (settings: Settings) =>
  2 ** Math.floor(Math.log2(Math.max(settings('heterogeneousVolumesBottomLevelGridResolution'), 1)))

/** The settings the plan of the grids reads (`gridPlan.ts`), the reference's cvars. */
const planOf = (settings: Settings) => ({
  maxTraceDistance: settings('heterogeneousVolumesMaxTraceDistance'),
  downsampleFactor: settings('heterogeneousVolumesDownsampleFactor'),
  minimumVoxelSizeInFrustum: settings('heterogeneousVolumesMinimumVoxelSizeInFrustum'),
  minimumVoxelSizeOutsideFrustum: settings('heterogeneousVolumesMinimumVoxelSizeOutsideFrustum'),
  bottomLevelGridResolution: bottomLevelResolutionOf(settings),
  indirectionGrid: !!settings('heterogeneousVolumesIndirectionGrid'),
  indirectionGridResolution: settings('heterogeneousVolumesIndirectionGridResolution'),
  frustumGridShadingRate: settings('heterogeneousVolumesFrustumGridShadingRate'),
  orthoGrid: !!settings('heterogeneousVolumesOrthoGrid'),
  orthoGridShadingRate: settings('heterogeneousVolumesOrthoGridShadingRate'),
  frustumGridDepthSliceCount: settings('heterogeneousVolumesFrustumGridDepthSliceCount'),
  farPlaneAutoTransition: !!settings('heterogeneousVolumesFarPlaneAutoTransition'),
})

/** The settings of the ortho grid's build. */
export const orthoSettingsOf = (settings: Settings): OrthoGridSettings => ({
  ...planOf(settings),
  bottomLevelMemoryMegabytes: settings(
    'heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes',
  ),
  homogeneousThreshold: settings('heterogeneousVolumesBottomLevelGridHomogeneousAggregation')
    ? settings('heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold')
    : undefined,
  majorantGrid: !!settings('heterogeneousVolumesMajorantGrid'),
  majorantGridMax: !!settings('heterogeneousVolumesMajorantGridMax'),
  topLevelBitmask: !!settings('heterogeneousVolumesTopLevelBitmask'),
})

/** The settings of the frustum grid's build. */
export const frustumSettingsOf = (settings: Settings): FrustumGridSettings => ({
  ...planOf(settings),
  nearPlaneDistance: settings('heterogeneousVolumesFrustumGridNearPlaneDistance'),
  farPlaneDistance: settings('heterogeneousVolumesFrustumGridFarPlaneDistance'),
  bottomLevelMemoryMegabytes: settings(
    'heterogeneousVolumesFrustumGridMaxBottomLevelMemoryInMegabytes',
  ),
})

/**
 * What the grids are built for in the shadows phase (`HeterogeneousVolumes.cpp:997-1004`): the shading rates of the shadows in and out of the view, the
 * voxel sized by its distance from the camera, the ortho grid built and the frustum grid not (the reference builds it for the path tracer alone).
 */
export const SHADOW_GRID_BUILD = { orthoGrid: true, frustumGrid: false } as const

export const shadowGridOptionsOf = (settings: Settings): GridBuildOptions => ({
  shadingRateInFrustum: settings('heterogeneousVolumesShadowsShadingRate'),
  shadingRateOutOfFrustum: settings('heterogeneousVolumesShadowsOutOfFrustumShadingRate'),
  useProjectedPixelSize: true,
})

/** Whether the volumes' shadows are made through the voxel grids (`HeterogeneousVolumes::EShadowPipeline::VoxelGrid`). */
export const usesVoxelGrids = (settings: Settings) =>
  settings('heterogeneousVolumesShadowsPipeline') === 1

/**
 * The way the image of the volumes is replaced by the transmittance through the grids: the diagnostic view asked (its number is the debug mode's), else
 * the setting (`r.HeterogeneousVolumes.Debug`, `heterogeneousVolumesDebug`). 0 for none; the permutation of the program is the number less one.
 */
export const gridDebugModeOf = (diagnostic: string, settings: Settings) =>
  (HETEROGENEOUS_VOLUME_GRID_VIEWS as Record<string, number>)[diagnostic] ??
  settings('heterogeneousVolumesDebug')

import {
  HETEROGENEOUS_VOLUME_RULES,
  type HeterogeneousVolumeField,
} from '../contracts/heterogeneousVolumeOptions.ts'

const R = HETEROGENEOUS_VOLUME_RULES

/** What each setting of the heterogeneous volumes means (`../contracts/heterogeneousVolumeOptions.ts`):
 *  volumes whose medium is a sparse texture read by the sample. */
export const HETEROGENEOUS_VOLUME_MEANINGS: Readonly<Record<HeterogeneousVolumeField, string>> =
  /* @__PURE__ */ (() => ({
    heterogeneousVolumes: `Whether the heterogeneous volumes (volumes of a sparse texture a scene declares) are drawn; ${R.heterogeneousVolumes.default} by default.`,
    heterogeneousVolumesAllowed: `Whether the device profile allows the heterogeneous volumes; a profile turns it off where they cost too much, and they are drawn only while this and heterogeneousVolumes are both on (${R.heterogeneousVolumesAllowed.default} by default).`,
    heterogeneousVolumesShadows: `Whether the heterogeneous volumes cast shadows onto the scene; ${R.heterogeneousVolumesShadows.default} by default.`,
    heterogeneousVolumesTranslucency: `Whether the heterogeneous volumes are composited with the translucent surfaces, in the order they ask; off, they are composited after the translucency (${R.heterogeneousVolumesTranslucency.default} by default).`,
    heterogeneousVolumesUseExistenceMask: `Whether the lighting cache and the occlusion of a volume skip the voxels away from any extinction, found by a dilated mask of where the volume has some; ${R.heterogeneousVolumesUseExistenceMask.default} by default.`,
    heterogeneousVolumesAmbientOcclusion: `Whether the indirect light in a volume is darkened by an occlusion computed in the volume, from rays marched through it; ${R.heterogeneousVolumesAmbientOcclusion.default} by default.`,
    heterogeneousVolumesAmbientOcclusionDownsampleFactor: `How many times coarser the occlusion's voxels are than the volume's (${R.heterogeneousVolumesAmbientOcclusionDownsampleFactor.default} by default).`,
    heterogeneousVolumesAmbientOcclusionRayCountX: `The rays of the occlusion of a voxel, along the first side of their square (${R.heterogeneousVolumesAmbientOcclusionRayCountX.default} by default).`,
    heterogeneousVolumesAmbientOcclusionRayCountY: `The rays of the occlusion of a voxel, along the second side of their square (${R.heterogeneousVolumesAmbientOcclusionRayCountY.default} by default).`,
    heterogeneousVolumesAmbientOcclusionMaxTraceDistance: `The farthest an occlusion ray is marched, in metres (${R.heterogeneousVolumesAmbientOcclusionMaxTraceDistance.default} by default).`,
    heterogeneousVolumesAmbientOcclusionMaxStepCount: `The most steps of an occlusion ray (${R.heterogeneousVolumesAmbientOcclusionMaxStepCount.default} by default).`,
    heterogeneousVolumesComposition: `Where the volumes are composited relative to the translucent surfaces when they are composited with them: 0 before the translucency, 1 after it (${R.heterogeneousVolumesComposition.default} by default).`,
    heterogeneousVolumesVelocity: `Whether the pixel where a volume turns opaque writes the velocity of the point it shows, so the temporal pass follows a moving volume; ${R.heterogeneousVolumesVelocity.default} by default.`,
    heterogeneousVolumesShadowsResolution: `The side, in texels, of a face of the beer shadow map the volumes' cast shadows are read from (${R.heterogeneousVolumesShadowsResolution.default} by default).`,
    heterogeneousVolumesShadowsPrecision: `The precision of the beer shadow map: 0 sixteen bits a channel, 1 thirty-two (${R.heterogeneousVolumesShadowsPrecision.default} by default).`,
    heterogeneousVolumesShadowsNearClippingDistance: `The distance from a local light at which the rays of its beer shadow map start, in metres (${R.heterogeneousVolumesShadowsNearClippingDistance.default} by default).`,
    heterogeneousVolumesShadowsStepSize: `The step, in local units, of the rays that build the beer shadow map (${R.heterogeneousVolumesShadowsStepSize.default} by default).`,
    heterogeneousVolumesDownsampleFactor: `The image of the heterogeneous volumes is rendered at 1 over this many pixels a side, from 1 to 8, and upsampled (${R.heterogeneousVolumesDownsampleFactor.default} by default).`,
    heterogeneousVolumesJitter: `Whether the march of a volume starts at a point jittered by blue noise; ${R.heterogeneousVolumesJitter.default} by default.`,
    heterogeneousVolumesMaxStepCount: `The most steps of a march through a volume (${R.heterogeneousVolumesMaxStepCount.default} by default); the step is lengthened where the volume would take more.`,
    heterogeneousVolumesStepSize: `The march's step in the volume's local units; -1, the default, takes the voxel's size times the volume's step factor.`,
    heterogeneousVolumesShadowStepSize: `The step of a shadow ray in local units; -1, the default, takes the voxel's size times the volume's shadow step factor.`,
    heterogeneousVolumesMaxTraceDistance: `The farthest a view ray is marched, in metres (${R.heterogeneousVolumesMaxTraceDistance.default} by default).`,
    heterogeneousVolumesMaxShadowTraceDistance: `The farthest a shadow ray is marched, in metres (${R.heterogeneousVolumesMaxShadowTraceDistance.default} by default).`,
    heterogeneousVolumesLightingCache: `What a volume caches before it is marched: 0 nothing, 1 the transmittance toward each light, 2 the in-scattered light (${R.heterogeneousVolumesLightingCache.default} by default).`,
    heterogeneousVolumesLightingCacheDownsampleFactor: `How many times coarser the lighting cache is than the volume's resolution; 0, the default, takes the volume's own factor.`,
    heterogeneousVolumesDepthSort: `Whether the volumes are drawn from the nearest to the farthest by the distance of their centre; ${R.heterogeneousVolumesDepthSort.default} by default.`,
    heterogeneousVolumesHeightFog: `Whether the height fog is applied to the volumes; ${R.heterogeneousVolumesHeightFog.default} by default.`,
    heterogeneousVolumesVolumetricFog: `Whether the volumetric fog is applied to the volumes; ${R.heterogeneousVolumesVolumetricFog.default} by default.`,
    heterogeneousVolumesFogInscattering: `How the fog's in-scattering is applied through a volume: 0 not at all, 1 at each step, 2 by a linear approximation between the two ends of the march (${R.heterogeneousVolumesFogInscattering.default} by default).`,
    heterogeneousVolumesLightDirectional: `Whether the directional light lights the heterogeneous volumes; ${R.heterogeneousVolumesLightDirectional.default} by default.`,
    heterogeneousVolumesLightPoint: `Whether the point lights light the heterogeneous volumes; ${R.heterogeneousVolumesLightPoint.default} by default.`,
    heterogeneousVolumesLightSpot: `Whether the spot lights light the heterogeneous volumes; ${R.heterogeneousVolumesLightSpot.default} by default.`,
    heterogeneousVolumesLightRect: `Whether the rectangle lights light the heterogeneous volumes; ${R.heterogeneousVolumesLightRect.default} by default.`,
    heterogeneousVolumesUpsample: `How the image of the volumes, rendered at a lower size, is brought back to the view's: 0 not at all, 1 nearest pixel, 2 bilinear (${R.heterogeneousVolumesUpsample.default} by default); read only while the downsample factor is above 1.`,
    heterogeneousVolumesFilter: `The smoothing applied while upsampling: 0 none, 1 bilateral, 2 Gaussian 3x3, 3 Gaussian 5x5 (${R.heterogeneousVolumesFilter.default} by default).`,
    heterogeneousVolumesFilterWidth: `The width of the bilateral smoothing kernel, in pixels (${R.heterogeneousVolumesFilterWidth.default} by default).`,
    heterogeneousVolumesIndirectLighting: `The factor on the indirect light of the heterogeneous volumes, 0 or more (${R.heterogeneousVolumesIndirectLighting.default} by default: none).`,
    heterogeneousVolumesScalability: `The scalability of the heterogeneous volumes: 0 low, 1 high, 2 epic, 3 cinematic (${R.heterogeneousVolumesScalability.default} by default). Below cinematic the fog's in-scattering is the linear approximation and the indirect light the lighting cache's (epic) or none; at cinematic the settings of the fog and the indirect light apply.`,
    heterogeneousVolumesIndirectLightingMode: `Where the indirect light enters a volume: 0 not at all, 1 in the lighting cache, 2 at each step (${R.heterogeneousVolumesIndirectLightingMode.default} by default).`,
  }))()

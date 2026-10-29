import { HAIR_STRANDS_RULES, type HairStrandsField } from '../contracts/hairStrandsOptions.ts'

const R = HAIR_STRANDS_RULES

/** The first half of the meanings: the visibility, the voxels and the deep shadows' settings. */
const visibilityMeanings = () => ({
  hairStrands:
    'Whether the hair strands (the curves a scene file carries) are drawn and shadowed; false by default, a new project having the feature off. Off, a scene that carries curves loads them as any other object and draws nothing of them.',
  hairVisibilitySamplesPerPixel: `Samples a pixel of the strands visibility buffer holds, a whole number from 2 to 8: 2, 4 or 8, a value between taken as the next one up (${R.hairVisibilitySamplesPerPixel.default} by default). More samples resolve thinner strands and cost more memory and time.`,
  hairVisibilityMeanSamplesPerPixel: `Scale from 0 to 1 on the samples kept for the strands visibility buffer, to limit its memory (${R.hairVisibilityMeanSamplesPerPixel.default} by default).`,
  hairVisibilityFullCoverageThreshold: `Coverage from 0.1 to 1 from which a pixel counts as fully covered by strands (${R.hairVisibilityFullCoverageThreshold.default} by default).`,
  hairVisibilitySortByDepth:
    'Whether the samples of a pixel are sorted by depth and given their coverage from the ordered transmittance; false by default.',
  hairVisibilityResolutionScaleAware:
    'Whether the strands are scaled with the resolution scale of the view; true by default.',
  hairVisibilityComputeRaster:
    'Whether the samples of the visibility are written by a compute raster (the segments binned in tiles of the image, each tile drawn by a group of threads; hairVisibilityNaiveRaster draws a thread a segment instead) instead of the device rasterizer drawing the ribbons into a four-sample target, a pass for each four samples; false by default.',
  hairVisibilityComputeRasterForward:
    "Whether the strands are drawn by the forward compute raster instead of the visibility buffer: every control point of the strands is lit once, then a tiled compute raster bins the segments between the points in tiles of 32 pixels, sorts them front to back and shades them, blending the lit points' colours along each segment, straight into the image. It takes the place of hairVisibilityComputeRaster when both are on, keeps no sample a pixel and has no sorted or mapped coverage; false by default.",
  hairVisibilityComputeRasterNumBinners: `Workgroups that bin the segments of the compute rasters (the visibility's and the forward one) into tiles, from 1 to 256 (${R.hairVisibilityComputeRasterNumBinners.default} by default). More bin faster and spread the segments over more counters.`,
  hairVisibilityComputeRasterNumRasterizers: `Workgroups that draw or shade the binned tiles of the compute rasters (the visibility's and the forward one), from 1 to 1024 (${R.hairVisibilityComputeRasterNumRasterizers.default} by default); each takes tile after tile until none is left.`,
  hairVisibilityComputeRasterMaxTiles: `Most tiles the compute rasters keep (1024 segments each for the forward one, 256 for the visibility's), from 1024 to 262144 (${R.hairVisibilityComputeRasterMaxTiles.default} by default); a device whose storage binding holds fewer takes the most it holds. Segments past them are not drawn.`,
  hairVisibilityNaiveRaster:
    'Whether the compute raster draws the segments a thread a segment, the ribbons that span more than a tile shared by a group of threads, instead of binning them into tiles first; false by default (the segments are binned). It reads only while hairVisibilityComputeRaster is on.',
  hairVisibilityTileCompaction:
    'Whether the tiles the binners made in the same cell of the image, most of them partly filled, are merged into full tiles before they are drawn; false by default. It reads only while the compute raster bins the segments.',
  hairVisibilityClassification:
    'Whether the compute raster first sorts the segments into the small ones (the tiles, or with hairVisibilityNaiveRaster the thread-a-segment raster, draw them) and the larger ones (drawn a thread a segment, the largest shared by a group of threads); false by default.',
  hairVisibilityComputeRasterTileSize: `Side in pixels, from 8 to 32, of the tiles the compute raster bins the segments into (${R.hairVisibilityComputeRasterTileSize.default} by default); rounded down to a power of two.`,
  hairVisibilityNumClassifiers: `Workgroups that sort the segments of the compute raster's classification, from 1 to 256 (${R.hairVisibilityNumClassifiers.default} by default).`,
  hairVisibilityComputeRasterNumRasterizersNaive: `Workgroups of the thread-a-segment compute raster, from 1 to 1024 (${R.hairVisibilityComputeRasterNumRasterizersNaive.default} by default); each takes batch after batch of segments until none is left.`,
  hairVisibilityCoverageMapping:
    'Whether the share of a pixel the strands cover comes from their count and their mean width, mapped through a table of the coverage of that many strands of that width placed at random, instead of the product of what each strand lets through; false by default. The tiles with strands, their coverage and the view transmittance follow it.',
  hairVelocityType:
    "How a pixel of strands takes its velocity from the velocity of its samples (closest, average or max): the nearest sample's, the mean of the samples', or the largest of them; closest by default. The temporal pass and the motion blur read it.",
  hairVelocityThreshold: `Velocity, from 0 to 512, in the reference\'s pixel unit (a quarter pixel at 1: the unit is one half over the smaller side of the image in the screen\'s -1 to 1 span), above which a sample of strands marks its pixel to be resolved at once by the temporal pass, which keeps no history of it, sharper but noisier (${R.hairVelocityThreshold.default} by default).`,
  hairVisibilityWriteVelocityCoverageThreshold: `Share of a pixel, from 0 to 1, the strands must cover for the pixel to write the strands\' velocity over the surface\'s; ${R.hairVisibilityWriteVelocityCoverageThreshold.default} by default, every pixel with strands.`,
  renderCurve:
    "Whether the curve raster pipeline runs: the strands' curves are cut into segments, binned into tiles of 32 pixels by the depth of the scene in each tile, and compacted into depth slices for a software raster; false by default, experimental. Today the pipeline culls the strands' instances and clusters against the view and the scene's depth, bins their segments into the tiles and compacts each tile's segments into depth slices; the raster that draws them is not there yet.",
  renderCurveSwRaster: `Whether the curve raster runs its software path, which bins and compacts the segments (${R.renderCurveSwRaster.default} by default); the device has no mesh shader, so there is no hardware path, and with this off the pipeline does nothing. Needs renderCurve.`,
  renderCurveRasterNumBinners: `Binners the binning pass of the curve raster uses, from 1 to 256: each bins the segments of its own share of the clusters and has its own layers of counts (${R.renderCurveRasterNumBinners.default} by default). Needs renderCurve.`,
  renderCurveRasterNumRasterizers: `Rasterizers the raster pass of the curve raster uses, from 1 to 1024 (${R.renderCurveRasterNumRasterizers.default} by default). Needs renderCurve.`,
  renderCurveRasterMinCoverage: `Coverage, from 0 to 1, under which a raster step of the curve raster stops: a pixel that lets through less than this is done (${R.renderCurveRasterMinCoverage.default} by default). Needs renderCurve.`,
  hairRenderCustomDepth:
    'Whether the strands render custom depth: the depth of their first sample of a pixel is written into a custom depth target of the view, which stays 0 where there is none; false by default.',
  hairCustomDepthCoverageThreshold: `Share of a pixel, from 0 to 1, the strands must cover for it to write the custom depth (${R.hairCustomDepthCoverageThreshold.default} by default, every pixel with strands). Needs hairRenderCustomDepth.`,
  hairRasterizationScale: `Scale, from 0, on the least width a strand is drawn with, in the share of a pixel the samples of the visibility buffer leave it: it snaps a strand to the samples of its pixel (${R.hairRasterizationScale.default} by default). Larger strands cover more of a pixel and look thicker and steadier, smaller ones thinner and noisier.`,
  hairStableRasterizationScale: `Scale, from 1, on the least width of a groom drawn stable, whose width does not follow the samples' share of a pixel (${R.hairStableRasterizationScale.default} by default).`,
  hairStableRasterization:
    'Whether the strands are drawn at the stable width (hairStableRasterizationScale) rather than the width that follows the samples of a pixel; false by default, and set for a group of a groom by the compile job hairGroups.',
  hairScatterSceneLighting:
    "Whether the strands that scatter the scene's light take it from the lit image, weighed by the average forward scattering of the fibre, in place of the sky's; the surfaces they cover keep their own meanwhile. False by default, and set for a group of a groom by the compile job hairGroups.",
  hairStrandsComposition:
    "Where the lit strands are laid on the image: 'afterTranslucent' (default) after the transparents drawn in the lit image, 'beforeTranslucent' before them, 'afterSeparateTranslucent' and 'afterTranslucentBeforeDepthOfField' after them too (the separate translucency is composed after the depth of field). The fog along the way to the strands is taken in wherever they are put.",
  hairCastContactShadow:
    'Whether the surfaces the strands cover cast contact shadows; true by default.',
  hairCastShadowWhenOutOfView:
    "Whether a groom outside the camera's frustum still takes part in the macro groups, so that its shadow stays on what the camera sees, when a light that casts reaches it; true by default.",
  hairOutOfViewShadowDistance: `Metres, from 0: how far along a sun\'s direction the bounds of a groom outside the view are extended before they are tested against the view, to find the grooms whose shadow falls into it (${R.hairOutOfViewShadowDistance.default} by default).`,
  hairVoxelization:
    'Whether the strands are voxelized into the volume a light ray crosses to count the strands in its way; true by default. Off, the strands shade the surfaces they stand over only through the shadow maps.',
  hairVoxelizationAabbScale: `Scale from 0.01 to 10 on the box of a group of strands the voxels are allocated in (${R.hairVoxelizationAabbScale.default} by default).`,
  hairVoxelDensityScale: `Scale, from 0, on the density the strands give a voxel (${R.hairVoxelDensityScale.default} by default).`,
  hairVoxelDensityScaleShadow: `Scale on the density for the shadow: 0 or more replaces hairVoxelDensityScale, below 0 (${R.hairVoxelDensityScaleShadow.default} by default) leaves it.`,
  hairVoxelDepthBiasScaleShadow: `Voxels, from 0: the start of a shadow ray is moved this far toward the light (${R.hairVoxelDepthBiasScaleShadow.default} by default).`,
  hairVoxelSteppingScale: `Scale from 1 to 10 on the step of the march through the voxels (${R.hairVoxelSteppingScale.default} by default).`,
  hairVoxelSteppingScaleShadow: `Scale on the march's step for the shadow: 0 or more, held to 1 to 10, replaces hairVoxelSteppingScale; below 0 (${R.hairVoxelSteppingScaleShadow.default} by default) leaves it.`,
  hairVoxelDensityScaleTransmittance: `Scale on the density for the transmittance toward a light: 0 or more replaces hairVoxelDensityScale, below 0 (${R.hairVoxelDensityScaleTransmittance.default} by default) leaves it.`,
  hairVoxelDepthBiasScaleTransmittance: `Voxels, from 0: the start of a transmittance ray is moved this far toward the light (${R.hairVoxelDepthBiasScaleTransmittance.default} by default).`,
  hairVoxelSteppingScaleTransmittance: `Scale on the march's step for the transmittance: 0 or more, held to 1 to 10, replaces hairVoxelSteppingScale; below 0 (${R.hairVoxelSteppingScaleTransmittance.default} by default) leaves it.`,
  hairTransmittanceSuperSampling:
    'Whether the transmittance toward a light takes eight rays a sample instead of one: slower, cleaner; false by default.',
  hairTransmittanceMipTraversal:
    'Whether the transmittance ray marches through the levels of the voxel pages, taking larger steps as it goes: faster; true by default.',
  hairShadowRasterizationScale: `Scale, from 0, on the least width a strand is drawn with in the deep shadow views; 0 takes hairRasterizationScale (${R.hairShadowRasterizationScale.default} by default).`,
  hairVoxelForceTransmittanceAndShadow:
    'Whether the transmittance and the shadow of the strands come from the voxel volume alone, no deep shadow drawn even for a light that casts one; false by default.',
  hairDeepShadowResolution: `Texels a side of the atlas the deep shadows of the lights are drawn into (${R.hairDeepShadowResolution.default} by default).`,
  hairDeepShadowMinResolution: `Texels a side of the smallest tile of the deep shadow atlas, from 16 (${R.hairDeepShadowMinResolution.default} by default).`,
  hairDeepShadowMaxFrustumAngle: `Degrees, from 10 to 170: the widest frustum a deep shadow of a local light is drawn with, so that it is not deformed (${R.hairDeepShadowMaxFrustumAngle.default} by default).`,
  hairDeepShadowAabbScale: `Scale, from 0, on the box of a group of strands a deep shadow frames (${R.hairDeepShadowAabbScale.default} by default).`,
  hairDeepShadowKernelType: `How the layers of a deep shadow are filtered, 0 to 4: 0 and 4 none, 1 2x2, 2 6x6, 3 soft with a kernel of hairDeepShadowKernelAperture degrees (${R.hairDeepShadowKernelType.default} by default).`,
  hairDeepShadowMaskKernelType: `Filter of the shadow the strands cast on the surfaces in the classic shadow mode, 0 to 4: 0 a 2x2 filter, 1 a 4x4 one, 2 and 3 Gaussians of 8 and 16 taps, 4 a Gaussian of 8 taps on the hair count of the layers (${R.hairDeepShadowMaskKernelType.default} by default).`,
  hairDeepShadowRandomType: `How the rays of the shadow the strands cast on the surfaces through the voxels are jittered, 0 to 2: 0 the interleaved gradient noise, 1 the same with a second pair of numbers, 2 the blue noise (${R.hairDeepShadowRandomType.default} by default).`,
  hairDeepShadowKernelAperture: `Degrees: the aperture of the soft kernel (hairDeepShadowKernelType 3) (${R.hairDeepShadowKernelAperture.default} by default).`,
})

/** The second half of the meanings. */
const lightMeanings = () => ({
  hairDeepShadowDensityScale: `Scale, from 0, on the hair count a deep shadow gives, to make up for the fibres a groom lacks (${R.hairDeepShadowDensityScale.default} by default).`,
  hairDeepShadowDepthBiasScale: `Scale, from 0, on the first layer's depth that biases the deep shadow's depth test (${R.hairDeepShadowDepthBiasScale.default} by default).`,
  hairLutIncidentAngleCount: `Slices of the table of the fibre's average scattering along the angle of the light (${R.hairLutIncidentAngleCount.default} by default).`,
  hairLutRoughnessCount: `Slices of the table along the roughness (${R.hairLutRoughnessCount.default} by default).`,
  hairLutAbsorptionCount: `Slices of the table along the absorption, taken down to a square number (${R.hairLutAbsorptionCount.default} by default).`,
  hairLutSampleCountScale: `Multiplier on the samples that make the table (${R.hairLutSampleCountScale.default} by default); more is slower to make and cleaner.`,
  hairComponentR:
    'Whether the strands reflect light off their surface (the R lobe); true by default.',
  hairComponentTT: 'Whether the strands let light through (the TT lobe); true by default.',
  hairComponentTRT: 'Whether the strands reflect light inside (the TRT lobe); true by default.',
  hairComponentLocalScattering:
    'Whether the light that returns from the hair behind a strand is added (local scattering); true by default.',
  hairComponentGlobalScattering:
    'Whether the light is dimmed by the hair it crosses (global scattering); true by default.',
  hairComponentTTModel:
    'Whether the strands use the second model of the transmission through the fibre; false by default.',
  hairVoxelWorldSize: `Centimetres, from 0.01 to 100: the width of the smallest voxel (${R.hairVoxelWorldSize.default} by default).`,
  hairVoxelPageResolution: `Voxels a side of a page of the volume, from 2 to 256, rounded up to a power of two and held to 8 at least (${R.hairVoxelPageResolution.default} by default).`,
  hairVoxelPageCountPerDim: `Pages a side of the volume's storage, a whole number from 1 (${R.hairVoxelPageCountPerDim.default} by default); the volume holds this cubed pages.`,
  hairVoxelSizeInPixel: `Pixels, a whole number from 1 to 50: the size on the screen a voxel is fitted to (${R.hairVoxelSizeInPixel.default} by default).`,
  hairVoxelAdaptive:
    'Whether the pages the volume holds follow what the view needs, from the feedback of the previous image; true by default.',
  hairVoxelAdaptiveCorrectionSpeed: `Speed from 0 to 1 at which the adaptive allocation corrects itself (${R.hairVoxelAdaptiveCorrectionSpeed.default} by default); faster adapts sooner but may oscillate between too many and too few pages.`,
  hairVoxelAdaptiveCorrectionThreshold: `Share from 0 to 1 of the pages kept as a margin against allocating too many (${R.hairVoxelAdaptiveCorrectionThreshold.default} by default).`,
  hairVoxelGpuDriven:
    'Whether the pages are allocated on the GPU, from a page index sized by the box of the strands; true by default.',
  hairVoxelGpuDrivenMinPageIndexResolution: `Entries a side, a whole number from 1, of the least page index kept while the pages are allocated on the GPU (${R.hairVoxelGpuDrivenMinPageIndexResolution.default} by default).`,
  hairVoxelGpuDrivenMaxPageIndexResolution: `Entries a side, a whole number from 1, of the greatest page index kept while the pages are allocated on the GPU (${R.hairVoxelGpuDrivenMaxPageIndexResolution.default} by default).`,
  hairVoxelInvalidateEmptyPageIndex:
    'Whether an entry of the page index whose page holds no voxel is made invalid; true by default.',
  hairVoxelInjectOpaqueDepth:
    'Whether the depth of the opaque surfaces is written into the volume as an occluder; true by default.',
  hairVoxelInjectOpaqueBiasCount: `Voxels, a whole number from 0, under the opaque surface at which its depth is written (${R.hairVoxelInjectOpaqueBiasCount.default} by default).`,
  hairVoxelInjectOpaqueMarkCount: `Voxels, a whole number from 0, marked opaque along the view under the opaque surface (${R.hairVoxelInjectOpaqueMarkCount.default} by default).`,
  hairVoxelDensityScaleAO: `Scale of the density the strands give a voxel when the occlusion of the surfaces about them is traced; below 0 (${R.hairVoxelDensityScaleAO.default} by default) the voxel density scale (hairVoxelDensityScale) is used.`,
  hairVoxelDepthBiasScaleEnvironment: `Voxels, from 0, by which the start of the rays that trace the strands' occlusion is moved along them (${R.hairVoxelDepthBiasScaleEnvironment.default} by default).`,
  hairVoxelSteppingScaleEnvironment: `Scale of the march's step for the rays that trace the strands' occlusion, held to 1 to 10; below 0 (${R.hairVoxelSteppingScaleEnvironment.default} by default) the voxel stepping scale (hairVoxelSteppingScale) is used.`,
  hairEnvironmentIntegration:
    "How the strands take the environment's light: 'sh' (default) the sky's diffuse light weighed by the fibre's response, or the radiance cache's along the direction the fibre is seen from when the world is lit by probes; 'adhoc' the reflected direction and the fibre's multiple scattering gathered from the cache or the sky, the hair on the way counted in the voxels; 'uniform' directions spread evenly over the sphere, each weighed by the fibre's response and the voxels' visibility.",
  hairSkyLightingSampleCount: `Directions, a whole number from 1, a point of the strands casts for the 'adhoc' and 'uniform' integrations (${R.hairSkyLightingSampleCount.default} by default).`,
  hairSkyLightingDistanceThreshold: `Centimetres, from 1, the voxels are searched for hair on the way of the environment's directions (${R.hairSkyLightingDistanceThreshold.default} by default).`,
  hairSkyLightingScreenTraceOcclusion:
    'Whether the screen occludes the directions the environment light is gathered from (a short trace through the depth pyramid); false by default.',
  hairVoxelDensityScaleEnvironment: `Scale of the density the strands give a voxel when the environment's light is traced; below 0 (${R.hairVoxelDensityScaleEnvironment.default} by default) the voxel density scale (hairVoxelDensityScale) is used.`,
  hairSkyAO:
    'Whether the strands darken the ambient occlusion of the surfaces about them (a skin under hair gets darker); true by default.',
  hairSkyAOSampleCount: `Rays, a whole number from 1, a pixel casts through the voxels to find the occlusion the strands give a surface (${R.hairSkyAOSampleCount.default} by default).`,
  hairSkyAODistanceThreshold: `Centimetres, from 1, the occlusion rays of the strands are marched for (${R.hairSkyAODistanceThreshold.default} by default).`,
  hairVoxelJitter:
    "How the voxelization and the march are jittered: 'randomized' (default) a different offset each image, 'none' no offset, 'constant' the same offset every image.",
  shadowSmrtSamplesPerRayHair: `Rays, a whole number from 1 to 16, that a pixel of the strands casts toward a light through its shadow map (${R.shadowSmrtSamplesPerRayHair.default} by default); never more than the light casts.`,
})

/** The meanings of the G-buffer write and of the debug views' settings. */
const debugMeanings = () => ({
  hairWriteGBufferData: `Whether, and how much of, the strands are written into the surfaces after they are laid on the image, for the passes that read the surfaces next, a whole number from 0 to 3 (${R.hairWriteGBufferData.default} by default): 0 nothing, 1 a placeholder (the strand's tangent as the normal, the hair shading model, no colour), 2 the normal (the mean tangent of the pixel's samples) and the roughness, 3 the whole surface (the mean base colour too) and the depth of the nearest strand. In the diagnostic view materials, which shows the surfaces' buffers, the strands write the real data: the setting 1 writes the normal and the roughness, the setting 0 the whole surface.`,
  hairCastShadowWhenOutOfViewDebug:
    "Whether the culling of the grooms by a directional light's shadow is drawn over the image, in every view: the view frustum in blue, the light's bound in purple, the box of each groom in the light's space green where it reaches the frustum and yellow where it does not, and in the world in red; false by default.",
  hairDeepShadowDebugIndex: `Rank, a whole number from 0, of the deep shadow that the diagnostic view hair-deep-opacity-maps draws: its depth and its layers, side by side over the image (${R.hairDeepShadowDebugIndex.default} by default).`,
  hairDeepShadowDebugScale: `Divisor, from 0, of the layers' values in the view hair-deep-opacity-maps (${R.hairDeepShadowDebugScale.default} by default).`,
  hairDeepShadowDebugMacroBounds:
    'Whether the views hair-light-bounds and hair-deep-opacity-maps draw the box of each macro group; false by default.',
  hairDeepShadowDebugShadowBounds:
    'Whether the views hair-light-bounds and hair-deep-opacity-maps draw the frustum of each deep shadow; false by default.',
  hairVoxelDebugTraversal:
    "How the view hair-voxels-density marches the volume: 'linear' (default) a voxel a step, 'mip' through the levels of the pages.",
  hairVoxelDebugDrawVoxels:
    "Whether the view hair-voxels-density draws the strands' count along each pixel's ray, from green to red; true by default.",
  hairVoxelDebugDrawPages:
    "Whether the view hair-voxels-density draws the first page that holds voxels along each pixel's ray instead of the count; false by default.",
  hairVoxelDebugForcedMip: `Level of the pages, a whole number from -1 to 8, that the view hair-voxels-density marches; below 0 (${R.hairVoxelDebugForcedMip.default} by default) the march picks the level by its step.`,
})

/** What each setting of the hair strands means (`../contracts/hairStrandsOptions.ts`): curves a
 *  scene file carries, drawn as ribbons that face the camera and shadowed by the shadow maps and a
 *  volume of voxels. */
export const HAIR_STRANDS_MEANINGS: Readonly<Record<HairStrandsField, string>> =
  /* @__PURE__ */ (() => ({ ...visibilityMeanings(), ...lightMeanings(), ...debugMeanings() }))()

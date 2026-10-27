import { HAIR_STRANDS_RULES, type HairStrandsField } from '../contracts/hairStrandsOptions.ts'

const R = HAIR_STRANDS_RULES

/** What each setting of the hair strands means (`../contracts/hairStrandsOptions.ts`): curves a
 *  scene file carries, drawn as ribbons that face the camera and shadowed by the shadow maps and a
 *  volume of voxels. */
export const HAIR_STRANDS_MEANINGS: Readonly<Record<HairStrandsField, string>> =
  /* @__PURE__ */ (() => ({
    hairStrands:
      'Whether the hair strands (the curves a scene file carries) are drawn and shadowed; false by default, a new project having the feature off. Off, a scene that carries curves loads them as any other object and draws nothing of them.',
    hairVisibilitySamplesPerPixel: `Samples a pixel of the strands visibility buffer holds, a whole number from 2 to 8: 2, 4 or 8, a value between taken as the next one up (${R.hairVisibilitySamplesPerPixel.default} by default). More samples resolve thinner strands and cost more memory and time.`,
    hairVisibilityMeanSamplesPerPixel: `Scale from 0 to 1 on the samples kept for the strands visibility buffer, to limit its memory (${R.hairVisibilityMeanSamplesPerPixel.default} by default).`,
    hairVisibilityFullCoverageThreshold: `Coverage from 0.1 to 1 from which a pixel counts as fully covered by strands (${R.hairVisibilityFullCoverageThreshold.default} by default).`,
    hairVisibilitySortByDepth:
      'Whether the samples of a pixel are sorted by depth and given their coverage from the ordered transmittance; false by default.',
    hairVisibilityResolutionScaleAware:
      'Whether the strands are scaled with the resolution scale of the view; true by default.',
    hairRasterizationScale: `Scale, from 0, on the least width a strand is drawn with, in the share of a pixel the samples of the visibility buffer leave it: it snaps a strand to the samples of its pixel (${R.hairRasterizationScale.default} by default). Larger strands cover more of a pixel and look thicker and steadier, smaller ones thinner and noisier.`,
    hairStableRasterizationScale: `Scale, from 1, on the least width of a groom drawn stable, whose width does not follow the samples' share of a pixel (${R.hairStableRasterizationScale.default} by default).`,
    hairStableRasterization:
      'Whether the strands are drawn at the stable width (hairStableRasterizationScale) rather than the width that follows the samples of a pixel; false by default.',
    hairScatterSceneLighting:
      'Whether the strands light the scene behind them: the surfaces they cover then keep their own surface instead of being replaced by the strands; false by default.',
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
    hairVoxelWorldSize: `Centimetres, from 0.01 to 100: the width of the smallest voxel (${R.hairVoxelWorldSize.default} by default).`,
    hairVoxelPageResolution: `Voxels a side of a page of the volume, from 2 to 256, rounded up to a power of two (${R.hairVoxelPageResolution.default} by default).`,
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
    hairVoxelJitter:
      "How the voxelization and the march are jittered: 'randomized' (default) a different offset each image, 'none' no offset, 'constant' the same offset every image.",
    shadowSmrtSamplesPerRayHair: `Rays, a whole number from 1 to 16, that a pixel of the strands casts toward a light through its shadow map (${R.shadowSmrtSamplesPerRayHair.default} by default); never more than the light casts.`,
  }))()

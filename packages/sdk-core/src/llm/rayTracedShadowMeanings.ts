import type { RayTracedShadowField } from '../contracts/rayTracedShadowOptions.ts'

/** What the view's ray-traced shadow settings mean (`../contracts/rayTracedShadowOptions.ts`). */
export const RAY_TRACED_SHADOW_MEANINGS: Readonly<Record<RayTracedShadowField, string>> = {
  rayTracedShadows:
    "Whether the lights that follow the view's setting (castRayTracedShadow 'useProjectSetting', a light's default) cast their shadow by rays cast through the scene's triangles instead of the shadow maps (false, the default). Only a device that traces rays through triangles takes them; elsewhere the shadow maps stay.",
  rayTracedShadowsDirectionalLights:
    'Whether directional lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsPointLights:
    'Whether point lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsSpotLights:
    'Whether spot lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsRectLights:
    'Whether rect lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsSamplesPerPixel:
    "The rays a pixel casts to each light (-1, the default, leaves it to the light's rayTracedShadowSamplesPerPixel, 1 by default).",
  rayTracedShadowsNormalBias:
    "The most, in centimetres (0.1 by default, at least 0.01), a shadow ray's start is moved along the surface normal to leave the triangle it starts on.",
  rayTracedShadowsAvoidSelfIntersectionTraceDistance:
    "The length, in centimetres (1 by default), of the short first ray that leaves the pixel's own surface behind, culling back faces; 0 casts no such ray.",
  rayTracedShadowsTwoSidedGeometry:
    'Whether geometry casts ray-traced shadows from both faces (true, the default); false passes back faces.',
  rayTracedShadowsAcceptFirstHit:
    'Whether a shadow ray ends at the first primitive it meets rather than the nearest (true, the default); it may denoise worse in some cases.',
  rayTracedShadowsLODTransitionStart:
    'The distance from the eye, in centimetres (4000 by default), where the ray-traced shadow of a subsurface or hair pixel starts to take the light transmitted through it in place of its occlusion.',
  rayTracedShadowsLODTransitionEnd:
    'The distance from the eye, in centimetres (5000 by default), from which the ray-traced shadow of a subsurface or hair pixel is only the light transmitted through it.',
  rayTracedShadowsDirectionalLightTraceDistance:
    "How far from a pixel, in centimetres (10000 by default, from 1000 to 1000000), a directional light's ray goes back toward it to measure the thickness of a subsurface or hair pixel.",
  rayTracedShadowsDenoiser:
    'Whether the ray-traced shadow of a light with a size is denoised (true, the default): the penumbra is found from the distance to the nearest occluder, reconstructed, pre-convolved and accumulated over the images. False keeps the raw rays.',
  rayTracedShadowsDenoiserReconstructionSamples:
    "The most samples of the shadow denoiser's reconstruction (8 by default, from 1 to 56).",
  rayTracedShadowsDenoiserPreConvolution:
    'The number of pre-convolution passes of the shadow denoiser after the reconstruction (1 by default, from 0 to 4).',
  rayTracedShadowsDenoiserTemporalAccumulation:
    'Whether the shadow denoiser accumulates the shadow over the images (true, the default).',
  rayTracedShadowsDenoiserHistoryConvolutionSamples:
    'The samples of the convolution the shadow denoiser applies to the accumulated history (1 by default, from 1 to 56); 1 runs no convolution.',
}

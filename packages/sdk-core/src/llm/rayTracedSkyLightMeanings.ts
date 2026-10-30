import type { RayTracedSkyLightField } from '../contracts/rayTracedSkyLightOptions.ts'

/** What the view's ray-traced sky light settings mean (`../contracts/rayTracedSkyLightOptions.ts`). */
export const RAY_TRACED_SKY_LIGHT_MEANINGS: Readonly<Record<RayTracedSkyLightField, string>> = {
  rayTracedSkyLight:
    "Whether the sky lights that follow the view (castRayTracedShadow 'useProjectSetting', a sky light's default) are lit by rays cast through the scene's triangles toward the sky instead of the capture's harmonics (false, the default). Only a device that traces rays through triangles takes it; elsewhere the harmonics stay.",
  rayTracedSkyLightAllowed:
    "The project's switch for the ray-traced sky light (true, the default); it reads false while rayTracingEnable is false.",
  rayTracedSkyLightSamplesPerPixel:
    "The rays a pixel casts to the sky (-1, the default, leaves it to the sky light's samplesPerPixel, 4 by default and never fewer than 2).",
  rayTracedSkyLightMaxRayDistance:
    'The longest a sky ray goes, in centimetres (10000000 by default).',
  rayTracedSkyLightMaxShadowThickness:
    'How far from a hair pixel, in centimetres (1000 by default), the ray that measures the thickness of its shadow starts.',
  rayTracedSkyLightDenoiser:
    "Whether the rays' sky light is denoised (true, the default): reconstructed, pre-convolved and accumulated over the images. False keeps the raw rays.",
  rayTracedSkyLightDenoiserReconstructionSamples:
    "The most samples of the sky light denoiser's reconstruction (16 by default, from 1 to 56).",
  rayTracedSkyLightDenoiserPreConvolution:
    'The pre-convolution passes of the sky light denoiser after the reconstruction (1 by default, from 0 to 4).',
  rayTracedSkyLightDenoiserTemporalAccumulation:
    'Whether the sky light denoiser accumulates the light over the images (true, the default).',
  rayTracedSkyLightDenoiserHistoryConvolutionSamples:
    "The samples of the convolution of the sky light denoiser's accumulated history (1 by default, from 1 to 56); 1 runs none.",
  rayTracedSkyLightDenoiserHistoryConvolutionKernelSpreadFactor:
    "The spread, in pixels, of the sky light denoiser's history convolution (3 by default, from 0 to 64).",
  rayTracedSkyLightTwoSidedGeometry:
    'Whether geometry occludes the sky from both faces (true, the default); false passes back faces.',
  rayTracedSkyLightMaterials:
    'Whether the masked surfaces cut the sky rays by their mask (true, the default); false makes every triangle opaque.',
  rayTracedSkyLightDecoupleSampleGeneration:
    "Whether the rays' directions are drawn once in a table of 256 by 256 pixels by a pass of their own, repeated over the image (true, the default); false lets each pixel draw its own.",
  rayTracedSkyLightHairVoxel:
    "Whether the hair strands' voxels take part in the sky occlusion of a surface by hair (true, the default).",
  rayTracedSkyLightHairOcclusionThreshold:
    "The hair count the strands' voxels must hold along a sky ray before the ray counts as blocked (1 by default, from 0; at 0 the strands never block a ray, as the reference).",
  rayTracedSkyLightScreenPercentage:
    "The share of the image's resolution the sky rays are cast at (100 by default, held from 25 to 100 and made a whole division of the image), only where the denoiser is on.",
}

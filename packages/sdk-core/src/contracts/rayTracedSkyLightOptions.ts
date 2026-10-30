import { clamp } from '../../../math/src/scalar/reals.ts'
import type { CastRayTracedShadow } from './rayTracedShadowOptions.ts'
import {
  atLeast,
  flagSetting as flag,
  gatedFlagSetting as gatedFlag,
  integerSetting as integer,
  INT32_MAX,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE RAY-TRACED SKY LIGHT (`packages/sdk-browser/src/lighting/skyLightTraced/`): the sky light's diffuse light found by casting rays from each
 * pixel through the scene's triangles toward the sky, drawn by the importance table of the sky (the same table the path tracer samples), instead of reading the nine
 * harmonics of the capture. It is listed with the shadow settings (`./shadowOptions.ts`); run-time settings, as `./settingRules.ts` says, the quality levels write none
 * of them. Each default is the reference's, so the sky light stays the harmonics' until a view or a sky light asks for the rays.
 *
 * - `rayTracedSkyLight` (off): the sky lights that follow the view (`castRayTracedShadow` `'useProjectSetting'`, the default of a sky light) are lit by rays;
 * - `rayTracedSkyLightAllowed` (on): the project's switch; it reads off while `rayTracingEnable` is off, which no sky light gets round;
 * - `rayTracedSkyLightSamplesPerPixel` (-1): the rays a pixel casts; -1 leaves it to the sky light (`samplesPerPixel`, 4, and never fewer than 2);
 * - `rayTracedSkyLightMaxRayDistance` (10 000 000 cm): the longest a ray goes;
 * - `rayTracedSkyLightMaxShadowThickness` (1000 cm): how far from a hair pixel the ray that measures the thickness of the shadow starts;
 * - `rayTracedSkyLightDenoiser` (on): the rays' light is denoised (reconstruction, pre-convolution, accumulation in time); off keeps the raw rays;
 * - `rayTracedSkyLightDenoiserReconstructionSamples` (16, from 1 to 56), `rayTracedSkyLightDenoiserPreConvolution` (1, from 0 to 4),
 *   `rayTracedSkyLightDenoiserTemporalAccumulation` (on): the denoiser's reconstruction samples, pre-convolutions and accumulation over the images;
 * - `rayTracedSkyLightDenoiserHistoryConvolutionSamples` (1, from 1 to 56), `rayTracedSkyLightDenoiserHistoryConvolutionKernelSpreadFactor` (3, from 0 to 64): the samples and the spread, in
 *   pixels, of the convolution of the accumulated history; 1 sample runs none;
 * - `rayTracedSkyLightTwoSidedGeometry` (on): the geometry occludes from both faces; off, back faces are passed;
 * - `rayTracedSkyLightMaterials` (on): the masked surfaces are cut by their mask; off, every triangle is opaque;
 * - `rayTracedSkyLightDecoupleSampleGeneration` (on): the rays' directions are drawn once in a table of 256 by 256 pixels, repeated over the image, by a pass of
 *   their own; off, each pixel draws its own (the cosine lobe about its normal);
 * - `rayTracedSkyLightHairVoxel` (on): the hair strands' voxels take part in the occlusion of a surface by hair;
 * - `rayTracedSkyLightHairOcclusionThreshold` (1): the hair count the strands' voxels must hold along a ray before it counts as blocked (from 0; at 0 the march never stops early, so the strands never block a ray, as the reference's traversal does: its stop test is `CountThreshold != 0 && count > CountThreshold`, `HairStrandsVoxelPageTraversal.ush:103`);
 * - `rayTracedSkyLightScreenPercentage` (100): the share of the image's resolution the rays are cast at, held from 25 to 100 and made a whole division of the image (50 casts at half
 *   the resolution), only where the denoiser is on.
 */
export const RAY_TRACED_SKY_LIGHT_RULES = /* @__PURE__ */ (() =>
  [
    flag('rayTracedSkyLight', false),
    gatedFlag('rayTracedSkyLightAllowed', true, 'rayTracingEnable'),
    integer('rayTracedSkyLightSamplesPerPixel', -1, [-1, INT32_MAX]),
    nonNegative('rayTracedSkyLightMaxRayDistance', 1.0e7),
    nonNegative('rayTracedSkyLightMaxShadowThickness', 1.0e3),
    flag('rayTracedSkyLightDenoiser', true),
    integer('rayTracedSkyLightDenoiserReconstructionSamples', 16, [1, 56]),
    integer('rayTracedSkyLightDenoiserPreConvolution', 1, [0, 4]),
    flag('rayTracedSkyLightDenoiserTemporalAccumulation', true),
    integer('rayTracedSkyLightDenoiserHistoryConvolutionSamples', 1, [1, 56]),
    number('rayTracedSkyLightDenoiserHistoryConvolutionKernelSpreadFactor', 3, [0, 64]),
    flag('rayTracedSkyLightTwoSidedGeometry', true),
    flag('rayTracedSkyLightMaterials', true),
    flag('rayTracedSkyLightDecoupleSampleGeneration', true),
    flag('rayTracedSkyLightHairVoxel', true),
    nonNegative('rayTracedSkyLightHairOcclusionThreshold', 1),
    number('rayTracedSkyLightScreenPercentage', 100, atLeast(0)),
  ] as const)()

/** The ray-traced sky light's view settings, by field. */
export type RayTracedSkyLightField = (typeof RAY_TRACED_SKY_LIGHT_RULES)[number]['field']

/** The values of the settings above the traced sky light reads. */
export interface RayTracedSkyLightSettings {
  rayTracedSkyLight: boolean
  rayTracedSkyLightAllowed: boolean
  rayTracedSkyLightSamplesPerPixel: number
  rayTracedSkyLightMaxRayDistance: number
  rayTracedSkyLightMaxShadowThickness: number
  rayTracedSkyLightDenoiser: boolean
  rayTracedSkyLightDenoiserReconstructionSamples: number
  rayTracedSkyLightDenoiserPreConvolution: number
  rayTracedSkyLightDenoiserTemporalAccumulation: boolean
  rayTracedSkyLightDenoiserHistoryConvolutionSamples: number
  rayTracedSkyLightDenoiserHistoryConvolutionKernelSpreadFactor: number
  rayTracedSkyLightTwoSidedGeometry: boolean
  rayTracedSkyLightMaterials: boolean
  rayTracedSkyLightDecoupleSampleGeneration: boolean
  rayTracedSkyLightHairVoxel: boolean
  rayTracedSkyLightHairOcclusionThreshold: number
  rayTracedSkyLightScreenPercentage: number
}

/** What the sky light itself asks of the rays (`SKY_LIGHT_RULES`): its choice, its samples a pixel and whether its light goes through the surfaces that let it. */
export interface SkyLightRayAsk {
  castRayTracedShadow: CastRayTracedShadow
  samplesPerPixel: number
  transmission: boolean
}

/** The rays a pixel casts: the view's setting where it is not -1, else the sky light's own, never fewer than 2 (one ray a pixel denoises badly). */
export const skyLightRayCount = (view: RayTracedSkyLightSettings, light: SkyLightRayAsk) =>
  view.rayTracedSkyLightSamplesPerPixel >= 0
    ? view.rayTracedSkyLightSamplesPerPixel
    : Math.max(light.samplesPerPixel, 2)

/** Whether the sky light is lit by rays: the project allows it, the sky light asks (`'enabled'`, or `'useProjectSetting'` where the view's `rayTracedSkyLight` is on) and a ray a pixel is cast at least. */
export const skyLightTracedOn = (view: RayTracedSkyLightSettings, light: SkyLightRayAsk) =>
  view.rayTracedSkyLightAllowed &&
  (light.castRayTracedShadow === 'enabled' ||
    (light.castRayTracedShadow === 'useProjectSetting' && view.rayTracedSkyLight)) &&
  skyLightRayCount(view, light) > 0

/** The whole division of the image the rays are cast at: the screen percentage held from 25 to 100 and its reciprocal cut to a whole number, 1 where the denoiser is off. */
export const skyLightUpscale = (view: RayTracedSkyLightSettings) =>
  view.rayTracedSkyLightDenoiser
    ? Math.trunc(1 / clamp(view.rayTracedSkyLightScreenPercentage / 100, 0.25, 1))
    : 1

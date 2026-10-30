import { CENTIMETRES_PER_METRE } from '../page/format.ts'
import {
  choiceSetting as choice,
  flagSetting as flag,
  gatedFlagSetting as gatedFlag,
  integerSetting as integer,
  INT32_MAX,
  numberSetting as number,
  type SettingValues,
  rulesOf,
} from './settingRules.ts'

/**
 * THE AMBIENT OCCLUSION'S THIRD METHOD, the ray-traced one (`packages/sdk-browser/src/lighting/ao/rayTraced/`): each pixel casts rays over the
 * hemisphere of its surface's geometric normal, through the scene's triangles (the scene trace the lighting makes, `rayTracingFile`), and keeps the
 * share that arrive, every ray weighted by the cosine the shading normal gives it. It takes the place of the screen-space search wherever it is on
 * (a scene without triangles keeps the search), and what the lighting does with the texture (`ambientOcclusionMode`) is the same. Run-time settings,
 * as `./settingRules.ts` says, each the reference's, its lengths in metres:
 * - `rayTracedAmbientOcclusion` (`'auto'`): `'off'`, `'on'`, or `'auto'`, which follows `rayTracedAmbientOcclusionEnabled`
 *   (the console variable, -1 / 0 / 1);
 * - `rayTracedAmbientOcclusionAllowed` (on): the project's scalability switch; it reads off while `rayTracingEnable` is off;
 * - `rayTracedAmbientOcclusionEnabled` (off) with `rayTracedAmbientOcclusionPostProcessSamplesPerPixel` (1), `rayTracedAmbientOcclusionRadius`
 *   (2 m, to 100) and `rayTracedAmbientOcclusionIntensity` (1, 0 to 1): the post-process volume's four; an intensity of 0 draws none;
 * - `rayTracedAmbientOcclusionSamplesPerPixel` (-1): the rays a pixel casts; -1 leaves it to the post-process value;
 * - `rayTracedAmbientOcclusionTwoSidedGeometry` (off): the geometry occludes from both faces; off, back faces are passed;
 * - `rayTracedAmbientOcclusionMaterials` (off): the masked surfaces are cut by their mask; off, every triangle is opaque;
 * - `rayTracedAmbientOcclusionDenoiser` (on): the rays' occlusion and the distance of the nearest blocker they found are denoised (reconstruction, pre-convolutions, rejection
 *   pre-convolution, accumulation in time, optional convolution of the history) by the shadow denoiser's kernels run on this signal (the reference's `r.AmbientOcclusion.Denoiser`,
 *   its values 1 and 2 being one denoiser here); off keeps the raw rays;
 * - `rayTracedAmbientOcclusionDenoiserReconstructionSamples` (16, from 1 to 56): the most samples of the reconstruction;
 * - `rayTracedAmbientOcclusionDenoiserPreConvolution` (2, from 0 to 4): the pre-convolution passes after it;
 * - `rayTracedAmbientOcclusionDenoiserKernelSpreadFactor` (4, from 0 to 64): the spread of the first pre-convolution, in pixels, doubling with each;
 * - `rayTracedAmbientOcclusionDenoiserTemporalAccumulation` (on): the denoised occlusion is accumulated over the images;
 * - `rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples` (1, from 1 to 56): the samples of the convolution of the accumulated history; 1 runs none;
 * - `rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor` (7, from 0 to 64): the spread of that convolution, in pixels.
 */

/** The reference's centimetres: one metre of ours is this many. */
const CM = CENTIMETRES_PER_METRE

/** The values `rayTracedAmbientOcclusion` takes. */
const RAY_TRACED_AO_MODES = ['auto', 'off', 'on'] as const

/** The rules of the ray-traced occlusion, each with the reference's default. */
export const RAY_TRACED_AMBIENT_OCCLUSION_RULES = /* @__PURE__ */ (() =>
  [
    choice('rayTracedAmbientOcclusion', 'auto', RAY_TRACED_AO_MODES),
    gatedFlag('rayTracedAmbientOcclusionAllowed', true, 'rayTracingEnable'),
    flag('rayTracedAmbientOcclusionEnabled', false),
    integer('rayTracedAmbientOcclusionSamplesPerPixel', -1, [-1, INT32_MAX]),
    integer('rayTracedAmbientOcclusionPostProcessSamplesPerPixel', 1, [1, 65536]),
    number('rayTracedAmbientOcclusionRadius', 200 / CM, [0, 10000 / CM]),
    number('rayTracedAmbientOcclusionIntensity', 1, [0, 1]),
    flag('rayTracedAmbientOcclusionTwoSidedGeometry', false),
    flag('rayTracedAmbientOcclusionMaterials', false),
    flag('rayTracedAmbientOcclusionDenoiser', true),
    integer('rayTracedAmbientOcclusionDenoiserReconstructionSamples', 16, [1, 56]),
    integer('rayTracedAmbientOcclusionDenoiserPreConvolution', 2, [0, 4]),
    number('rayTracedAmbientOcclusionDenoiserKernelSpreadFactor', 4, [0, 64]),
    flag('rayTracedAmbientOcclusionDenoiserTemporalAccumulation', true),
    integer('rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples', 1, [1, 56]),
    number('rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor', 7, [0, 64]),
  ] as const)()

/** The same rules by their field. */
export const RAY_TRACED_AMBIENT_OCCLUSION_FIELD_RULES = /* @__PURE__ */ rulesOf(
  RAY_TRACED_AMBIENT_OCCLUSION_RULES,
)

/** The values of those settings, every one set. */
export type RayTracedAmbientOcclusionValues = SettingValues<
  ReturnType<typeof rulesOf<typeof RAY_TRACED_AMBIENT_OCCLUSION_RULES>>
>

/** What the ray-traced occlusion's pass reads of the settings. */
export interface RayTracedAmbientOcclusionSettings {
  /** Whether the pass replaces the screen-space search: allowed, on (as the mode or the post-process value says) and an intensity above 0. */
  wanted: boolean
  /** The rays a pixel casts; 0 casts none and leaves the pixel unoccluded. */
  samples: number
  /** The farthest a ray goes, in metres. */
  radius: number
  /** The share of a ray's blocking that darkens, 0 to 1. */
  intensity: number
  twoSided: boolean
  materials: boolean
  /** The denoiser of the rays' result (`rayTracedAmbientOcclusionDenoiser…`): whether it runs, and its numbers. */
  denoiser: boolean
  reconstructionSamples: number
  preConvolution: number
  kernelSpread: number
  temporalAccumulation: boolean
  historyConvolutionSamples: number
  historyConvolutionSpread: number
}

/** The ray-traced occlusion's numbers from its resolved values, written into `into` (a new object by default): on where allowed and the mode says so (`'auto'`: the post-process
 *  switch), with an intensity above 0; the rays a pixel casts the setting's where it is not -1, else the post-process value. */
export function resolveRayTracedAmbientOcclusion(
  values: RayTracedAmbientOcclusionValues,
  into: RayTracedAmbientOcclusionSettings = {} as RayTracedAmbientOcclusionSettings,
): RayTracedAmbientOcclusionSettings {
  const mode = values.rayTracedAmbientOcclusion
  const on = mode === 'auto' ? values.rayTracedAmbientOcclusionEnabled : mode === 'on'
  into.wanted =
    values.rayTracedAmbientOcclusionAllowed && on && values.rayTracedAmbientOcclusionIntensity > 0
  into.samples =
    values.rayTracedAmbientOcclusionSamplesPerPixel >= 0
      ? values.rayTracedAmbientOcclusionSamplesPerPixel
      : values.rayTracedAmbientOcclusionPostProcessSamplesPerPixel
  into.radius = values.rayTracedAmbientOcclusionRadius
  into.intensity = values.rayTracedAmbientOcclusionIntensity
  into.twoSided = values.rayTracedAmbientOcclusionTwoSidedGeometry
  into.materials = values.rayTracedAmbientOcclusionMaterials
  into.denoiser = values.rayTracedAmbientOcclusionDenoiser
  into.reconstructionSamples = values.rayTracedAmbientOcclusionDenoiserReconstructionSamples
  into.preConvolution = values.rayTracedAmbientOcclusionDenoiserPreConvolution
  into.kernelSpread = values.rayTracedAmbientOcclusionDenoiserKernelSpreadFactor
  into.temporalAccumulation = values.rayTracedAmbientOcclusionDenoiserTemporalAccumulation
  into.historyConvolutionSamples = values.rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples
  into.historyConvolutionSpread =
    values.rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor
  return into
}

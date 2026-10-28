import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wordsOf } from '../../../gpu/core/wordViews.ts'
import { cloudHazeInSecondPass, writeCloudTraceOptions } from './traceOptions.ts'
import {
  cloudSetupOf,
  depthScale,
  depthSourceDownsample,
  tracedToView,
  type CloudSetup,
} from './cloudModes.ts'
import { put4, writeTracingJitter, type Size } from './reconstructLayout.ts'
import type { CloudFramePlan } from './reconstruct.ts'

/**
 * THE VIEW TRACING'S PLACES AND ITS BLOCK: where the pass binds what it reads and writes in its
 * own group (group 1, `traceWgsl.ts`; group 0 is the air's, `../../../lighting/atmosphere/programs.ts`), and the
 * one uniform block of the image's values, laid out once for the shader and the writer.
 */
export const CLOUD_TRACE_BINDING = {
  /** The material's block, its five textures and its sampler: seven bindings from here. */
  material: 0,
  /** The trace's block (`CLOUD_TRACE_LAYOUT`). */
  block: 7,
  /** The blue noise the samples' jitter reads. */
  blueNoise: 8,
  /** The scene's depth range, a texel to each traced texel: the nearest and the farthest depth of
   *  the block of view pixels it stands for. */
  depthRange: 9,
  /** The three images written (`reconstructLayout.ts`). */
  colour: 10,
  secondary: 11,
  depth: 12,
  /** The closest surface's depth, written beside the colours where the haze is laid per pixel. */
  closest: 13,
} as const

/** What the trace's group is made of (`CLOUD_TRACE_BINDING`): the material's entries, then each resource at its binding; `secondary` and `closest` only where the pass writes them. */
export const cloudTraceEntries = (
  material: readonly GPUBindGroupEntry[],
  r: {
    block: GPUBindingResource
    blueNoise: GPUBindingResource
    depthRange: GPUBindingResource
    colour: GPUBindingResource
    secondary?: GPUBindingResource
    depth: GPUBindingResource
    closest?: GPUBindingResource
  },
): GPUBindGroupEntry[] => [
  ...material,
  { binding: CLOUD_TRACE_BINDING.block, resource: r.block },
  { binding: CLOUD_TRACE_BINDING.blueNoise, resource: r.blueNoise },
  { binding: CLOUD_TRACE_BINDING.depthRange, resource: r.depthRange },
  { binding: CLOUD_TRACE_BINDING.colour, resource: r.colour },
  ...(r.secondary ? [{ binding: CLOUD_TRACE_BINDING.secondary, resource: r.secondary }] : []),
  { binding: CLOUD_TRACE_BINDING.depth, resource: r.depth },
  ...(r.closest ? [{ binding: CLOUD_TRACE_BINDING.closest, resource: r.closest }] : []),
]

/** The block's fields:
 *  - `inverseView`: the inverse of the view-projection without the temporal jitter;
 *  - `traced`: the traced image's size and the pixel of its block this image traces;
 *  - `sizes`: the frame index modulo 8, 1 when the sun's colour is taken at each sample (an air to
 *    tint it), and the
 *    last coordinate of the scene's depth image, the view's size less one over a texel of that
 *    image in view pixels (`depthSourceDownsample`);
 *  - `mapping`: the texels of the scene's depth image a traced texel stands for, per axis, and the
 *    view pixels it stands for, which the noise is read at;
 *  - `jitter`: the shift of the rays in normalised device coordinates (`writeTracingJitter`);
 *  - `layer`: the layer's base altitude and thickness in kilometres, the time in seconds, the
 *    opacity below which a ray ends;
 *  - `reach`: the farthest entry, the nearest start and the longest march in centimetres, and
 *    where the march is measured from;
 *  - `samples`: the samples of a ray, of a shadow ray, the shadow ray's length in centimetres, and
 *    the inverse of the distance over which a ray's count grows to its most;
 *  - `counts`: the fewest samples, the most a ray is allowed (the clamp), the step in samples over
 *    empty air, and 1 when the air is present;
 *  - `switches`: 1 when the fog is laid here in the trace (the late fog off), 1 when it is laid on
 *    every pixel, 1 when the distant sky light lights the cloud, 1 when the air's lights do;
 *  - `sky`: the planet's radius in kilometres where no air gives one, the share of the sky light the
 *    cloud's underside keeps, 1 when the material gives an occlusion of its own, and the
 *    pre-exposure the luminance is written multiplied by;
 *  - `lightScale0`, `lightScale1`: the factor on the illuminance of each of the air's two lights;
 *  - `viewProjection`: the scene to clip matrix the light grid's slices count depth with, read only
 *    when the lamps light the cloud;
 *  - `options`: 1 when the haze is laid in the trace (an air to scatter it, and not by the second
 *    pass of the high-quality haze), 1 in a reflection or a capture (`markCloudTraceCapture`), 1
 *    when the scene's depth cuts the ray (0 in the sky capture, which has none), and the sun's
 *    channel in the shadow maps (`NO_INDEX` when the sun's opaque shadow is not read);
 *  - `view`: the view's size in pixels and the light grid's cells across and down;
 *  - `empty`: the empty-space table's slice depth and its whole depth in centimetres, and the
 *    slices its start is moved by;
 *  - `ground`: the ground's albedo the cloud bounces light from;
 *  - `local`: the samples of a lamp's shadow ray, 1 when the clouds are a hole in the alpha (their
 *    light is left out, their coverage kept: `alphaHole`), and the exposure of the image, which a lamp's blend with it is
 *    taken at (`lightStrength`);
 *  - `haze`: where the haze of the Rayleigh scattering alone starts on the cloud (kilometres) and the
 *    inverse of the distance it fades in over, then the same for the Mie scattering alone: the two
 *    volumes are read apart when the starts are not both 0. */
export const CLOUD_TRACE_LAYOUT = fieldLayout('CloudTraceBlock', [
  ['inverseView', 'mat4x4f'],
  ['traced', 'vec4u'],
  ['sizes', 'vec4u'],
  ['mapping', 'vec4u'],
  ['jitter', 'vec4f'],
  ['layer', 'vec4f'],
  ['reach', 'vec4f'],
  ['samples', 'vec4f'],
  ['counts', 'vec4u'],
  ['switches', 'vec4u'],
  ['sky', 'vec4f'],
  ['lightScale0', 'vec4f'],
  ['lightScale1', 'vec4f'],
  ['viewProjection', 'mat4x4f'],
  ['options', 'vec4u'],
  ['view', 'vec4u'],
  ['empty', 'vec4f'],
  ['ground', 'vec4f'],
  ['local', 'vec4f'],
  ['haze', 'vec4f'],
] as const)

/** Whether the cloud material gives an occlusion of its own: the default material always does, so
 *  the sky light's bottom gradient (`undersideSkyLoss`) is kept for a material that does not. */
const CLOUD_MATERIAL_OUTPUTS_OCCLUSION = true

/** What the image tells the tracing. */
export interface CloudTraceImage {
  /** The inverse of the view-projection without the temporal jitter, column-major. */
  inverseView: ArrayLike<number>
  /** The view's size in pixels. */
  view: Size
  /** The index of the frame, and the time in seconds. */
  frameIndex: number
  time: number
  /** Whether the air is present: the layer's planet is then the air's, and the air scatters the
   *  haze on the clouds and tints the sun per sample; with none, the part's planet, no haze and the
   *  light's own illuminance. */
  airPresent: boolean
  /** The `cloudScatteredLuminanceScale` of the air's first and second light (red, green, blue). */
  lightScales: readonly [ArrayLike<number>, ArrayLike<number>]
  /** The scene to clip matrix of the light grid, and its cells across and down: read only when the
   *  lamps light the cloud (`quality.cloudLocalLights`). */
  viewProjection?: ArrayLike<number>
  lightGridCells?: readonly [number, number]
  /** The sun's channel in the shadow maps' view (`VsmProjectionView.lights`), given when the sun
   *  casts shadows on the clouds and the quality reads the sun's shadow map. */
  sunShadowChannel?: number
  /** The pre-exposure the image's light is written multiplied by (`PreExposure.now`): the traced
   *  luminance leaves multiplied by it. 1 when absent, as in a capture. */
  preExposure?: number
  /** The exposure of the image (`PreExposure.exposure`): a lamp that follows it is lit at it (`lightStrength`). 1 when absent. */
  exposure?: number
}

/** The block's ray: the view, the traced image's place in the frame's plan, the layer, the reach and
 *  the samples. */
function writeCloudTraceRay(
  out: Float32Array,
  image: CloudTraceImage,
  plan: CloudFramePlan,
  part: CloudPart,
  setup: CloudSetup,
) {
  const { at } = CLOUD_TRACE_LAYOUT
  const words = wordsOf(out)
  const { gpu, settings } = part
  const { traced, reconstructed } = plan.sizes
  const { mode } = setup
  out.set(image.inverseView, at.inverseView)
  put4(words, at.traced, traced.view.width, traced.view.height, plan.offset[0], plan.offset[1])
  put4(
    words,
    at.sizes,
    image.frameIndex % 8,
    settings.sunTintPerSample && image.airPresent ? 1 : 0,
    Math.floor((image.view.width - 1) / depthSourceDownsample(setup)),
    Math.floor((image.view.height - 1) / depthSourceDownsample(setup)),
  )
  put4(words, at.mapping, depthScale(setup), tracedToView(setup), 0, 0)
  writeTracingJitter(out, at.jitter, plan.offset, reconstructed.view, mode)
  put4(
    out,
    at.layer,
    settings.baseAltitudeKm,
    settings.thicknessKm,
    image.time,
    settings.opaqueBelow,
  )
  put4(
    out,
    at.reach,
    gpu.farthestEntryCm,
    gpu.nearestStartCm,
    gpu.marchLengthCm,
    gpu.marchLengthFrom,
  )
  put4(
    out,
    at.samples,
    gpu.viewSamplesMost,
    gpu.shadowSamplesMost,
    gpu.shadowRayLengthCm,
    gpu.samplesDistanceInverse,
  )
  put4(
    words,
    at.counts,
    gpu.samplesMin,
    gpu.samplesClamp,
    gpu.stepOnEmpty,
    image.airPresent ? 1 : 0,
  )
}

/** The block's light: the switches, the sky, and the factor on the illuminance of each light. */
function writeCloudTraceLight(
  out: Float32Array,
  words: Uint32Array,
  image: CloudTraceImage,
  { gpu, settings, quality }: CloudPart,
  setup: CloudSetup,
) {
  const { at } = CLOUD_TRACE_LAYOUT
  const hazeInSecondPass = cloudHazeInSecondPass(quality, image.airPresent)
  put4(
    words,
    at.switches,
    setup.lateFog || hazeInSecondPass ? 0 : 1,
    quality.cloudFogOnAllPixels ? 1 : 0,
    quality.cloudDistantSkyLight ? 1 : 0,
    quality.cloudAtmosphericLights ? 1 : 0,
  )
  put4(
    out,
    at.sky,
    settings.planetRadiusKm,
    gpu.undersideSkyKept,
    CLOUD_MATERIAL_OUTPUTS_OCCLUSION ? 1 : 0,
    image.preExposure ?? 1,
  )
  put4(
    out,
    at.haze,
    settings.hazeRayleighStartKm,
    gpu.hazeRayleighFadeInverse,
    settings.hazeMieStartKm,
    gpu.hazeMieFadeInverse,
  )
  put4(
    out,
    at.lightScale0,
    image.lightScales[0][0],
    image.lightScales[0][1],
    image.lightScales[0][2],
    0,
  )
  put4(
    out,
    at.lightScale1,
    image.lightScales[1][0],
    image.lightScales[1][1],
    image.lightScales[1][2],
    0,
  )
}

/** The block of this image into `out` (`CLOUD_TRACE_LAYOUT.words` words): the image's values, the
 *  frame's plan (its sizes and its place in the cycle) and the part's settings, with the part's
 *  `gpu` values as `resolveCloudPart` gives them. */
export function writeCloudTrace(
  out: Float32Array,
  image: CloudTraceImage,
  plan: CloudFramePlan,
  part: CloudPart,
) {
  const words = wordsOf(out)
  const setup = plan.setup ?? cloudSetupOf(part.quality)
  writeCloudTraceRay(out, image, plan, part, setup)
  writeCloudTraceLight(out, words, image, part, setup)
  writeCloudTraceOptions(out, words, CLOUD_TRACE_LAYOUT.at, image, part, setup)
  return out
}

/** The capture of the sky light is a reflection (the step jitter is fixed, the ray has no scene
 *  depth to meet) and lays its haze, where there is an air to scatter it, and its fog in the trace:
 *  marked in the block `words` that `writeCloudTrace` wrote. */
export function markCloudTraceCapture(words: Uint32Array, part: CloudPart, airPresent: boolean) {
  const { at } = CLOUD_TRACE_LAYOUT
  words[at.switches] = 1
  put4(
    words,
    at.options,
    part.quality.cloudAerialPerspective && airPresent ? 1 : 0,
    1,
    0,
    words[at.options + 3],
  )
}

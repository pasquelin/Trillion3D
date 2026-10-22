import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
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
} as const

/** The block's fields:
 *  - `inverseView`: the inverse of the view-projection without the temporal jitter;
 *  - `traced`: the traced image's size and the pixel of each 2×2 this image traces;
 *  - `sizes`: the frame index modulo 8, 1 when the sun's colour is taken at each sample, and the
 *    last coordinate of the scene's depth at half the view's size;
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
 *    cloud's underside keeps, and 1 when the material gives an occlusion of its own;
 *  - `lightScale0`, `lightScale1`: the factor on the illuminance of each of the air's two lights. */
export const CLOUD_TRACE_LAYOUT = fieldLayout('CloudTraceBlock', [
  ['inverseView', 'mat4x4f'],
  ['traced', 'vec4u'],
  ['sizes', 'vec4u'],
  ['jitter', 'vec4f'],
  ['layer', 'vec4f'],
  ['reach', 'vec4f'],
  ['samples', 'vec4f'],
  ['counts', 'vec4u'],
  ['switches', 'vec4u'],
  ['sky', 'vec4f'],
  ['lightScale0', 'vec4f'],
  ['lightScale1', 'vec4f'],
] as const)

/** Whether the cloud material gives an occlusion of its own: the default material always does, so
 *  the sky light's bottom gradient (`undersideSkyLoss`) is kept for a material that does not. */
export const CLOUD_MATERIAL_OUTPUTS_OCCLUSION = true

/** What the image tells the tracing. */
export interface CloudTraceImage {
  /** The inverse of the view-projection without the temporal jitter, column-major. */
  inverseView: ArrayLike<number>
  /** The view's size in pixels. */
  view: Size
  /** The index of the frame, and the time in seconds. */
  frameIndex: number
  time: number
  /** Whether the air is present: the layer's planet is then the air's. */
  airPresent: boolean
  /** The `cloudScatteredLuminanceScale` of the air's first and second light (red, green, blue). */
  lightScales: readonly [ArrayLike<number>, ArrayLike<number>]
}

/** The words of `out` as unsigned integers, made once for each array written. */
const wordViews = new WeakMap<Float32Array, Uint32Array>()
const wordsOf = (out: Float32Array) => {
  let words = wordViews.get(out)
  if (!words) wordViews.set(out, (words = new Uint32Array(out.buffer, out.byteOffset, out.length)))
  return words
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
  const { at } = CLOUD_TRACE_LAYOUT
  const words = wordsOf(out)
  const { gpu, settings, quality } = part
  const { traced, reconstructed } = plan.sizes
  out.set(image.inverseView, at.inverseView)
  put4(words, at.traced, traced.view.width, traced.view.height, plan.offset[0], plan.offset[1])
  put4(
    words,
    at.sizes,
    image.frameIndex % 8,
    settings.sunTintPerSample ? 1 : 0,
    Math.floor((image.view.width - 1) / 2),
    Math.floor((image.view.height - 1) / 2),
  )
  writeTracingJitter(out, at.jitter, plan.offset, reconstructed.view)
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
  put4(
    words,
    at.switches,
    quality.cloudFogLate ? 0 : 1,
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
    0,
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
  return out
}

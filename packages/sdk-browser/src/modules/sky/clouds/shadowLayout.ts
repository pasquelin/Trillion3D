import type { CloudShadowLight } from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import type { Size } from './reconstructLayout.ts'
import type { CloudShadowFrame } from './shadowFrame.ts'
import type { CloudShadowTemporal } from './shadowHistory.ts'

/**
 * THE CLOUD SHADOW MAP'S PLACES AND ITS BLOCK: where the trace binds what it reads and writes in
 * its own group (group 1; group 0 is the air's), and the one uniform block of a light's values,
 * laid out once for the shader and the writer.
 */
export const CLOUD_SHADOW_GROUP = 1

export const CLOUD_SHADOW_BINDING = {
  /** The material's block, its five textures and its sampler: seven bindings from here. */
  material: 0,
  /** The trace's block (`CLOUD_SHADOW_LAYOUT`). */
  block: 7,
  /** The map written. */
  output: 8,
} as const

/** The threads of a group along each axis, in the trace and in the filter. */
export const CLOUD_SHADOW_GROUP_SIZE = 8

/**
 * NOT-SAME, made the same by rounding. The map holds the front depth in kilometres, the mean
 * extinction per metre and the greatest optical depth in the three channels of a texel. The
 * reference stores them in an 11, 11 and 10 bit float format, `rg11b10ufloat` here. WebGPU cannot
 * write that format from a pass: a colour attachment of it needs the optional feature
 * `rg11b10ufloat-renderable`, a storage texture of it the optional feature `texture-formats-tier1`
 * (§ 25.12 and § 25.19 of the specification), and the core storage formats do not hold it. The
 * texture is `rgba16float`, which a compute pass writes and a sampler filters, and every value is
 * rounded to the reference's grid before it is stored (`cloudShadowStore`, `shadowWgsl.ts`), so
 * that what a reader finds is what the 11/11/10 format holds. The fourth channel is 0.
 */
export const CLOUD_SHADOW_FORMAT: GPUTextureFormat = 'rgba16float'

/** The block's fields:
 *  - `cameraFromClip`: the map's clip position back to centimetres from the camera;
 *  - `texel`: the traced map's side in texels, twice, then the inverses of the whole map's side;
 *  - `pixel`: the scale and the offset from a traced pixel to the whole map's pixel it stands for
 *    (1, 1, 0, 0 unless the temporal filter traces a half-size map);
 *  - `ray`: the direction of the light's rays, then the depth of the far plane in kilometres;
 *  - `layer`: the layer's base altitude and thickness in kilometres, the time in seconds;
 *  - `output`: the light's strength, the depth bias in kilometres, the samples of a ray. */
export const CLOUD_SHADOW_LAYOUT = fieldLayout('CloudShadowBlock', [
  ['cameraFromClip', 'mat4x4f'],
  ['texel', 'vec4f'],
  ['pixel', 'vec4f'],
  ['ray', 'vec4f'],
  ['layer', 'vec4f'],
  ['output', 'vec4f'],
] as const)

/** The sizes of the textures a light's map goes through: the traced one, then, with the temporal
 *  filter's pass, the whole map it writes, then each spatial filter pass's, half the one before
 *  (`passes` of them), cut to a whole number. The last is the map the lookups read. */
export function cloudShadowSizes(
  side: number,
  passes: number,
  temporal: Pick<CloudShadowTemporal, 'tracedSide' | 'filtered'>,
): Size[] {
  const sizes: Size[] = [{ width: temporal.tracedSide, height: temporal.tracedSide }]
  if (temporal.filtered) sizes.push({ width: side, height: side })
  for (let k = 0; k < passes; k++) {
    const before = sizes[sizes.length - 1]
    sizes.push({ width: Math.trunc(before.width * 0.5), height: Math.trunc(before.height * 0.5) })
  }
  return sizes
}

/** What a light's trace is told besides the part and the light: the map's frame, its side, the
 *  temporal filter's plan, the time in seconds. */
export interface CloudShadowImage {
  readonly frame: CloudShadowFrame
  readonly side: number
  readonly temporal: CloudShadowTemporal
  readonly time: number
}

/** The block of a light's trace into `out` (`CLOUD_SHADOW_LAYOUT.words` floats). */
export function writeCloudShadowTrace(
  out: Float32Array,
  image: CloudShadowImage,
  light: CloudShadowLight,
  part: CloudPart,
) {
  const { at } = CLOUD_SHADOW_LAYOUT
  const { frame, side, temporal } = image
  out.set(frame.cameraFromClip, at.cameraFromClip)
  out.set([temporal.tracedSide, temporal.tracedSide, 1 / side, 1 / side], at.texel)
  out.set(temporal.pixel, at.pixel)
  out.set([...frame.rayDirection, frame.farDepthKm], at.ray)
  out.set([part.settings.baseAltitudeKm, part.settings.thicknessKm, image.time, 0], at.layer)
  out.set([light.cloudShadowStrength, light.cloudShadowDepthBiasKm, frame.samples, 0], at.output)
  return out
}

/** Where the temporal filter binds what it reads and writes, in its own group 0. */
export const CLOUD_SHADOW_TEMPORAL_BINDING = {
  block: 0,
  current: 1,
  previous: 2,
  destination: 3,
  sampler: 4,
} as const

/** The temporal filter's block:
 *  - `cameraFromClip` and `previousClipFromCamera`: this image's map back to the camera, the image
 *    before's map from the camera;
 *  - `size`: the whole map's side twice, then the inverses; `pixel`: as the trace's;
 *  - `blend`: the current image's weight, whether the history is read, whether the point the map
 *    looks at has moved;
 *  - `depth`: the previous front depth along the current rays, `from + scale · previous`. */
export const CLOUD_SHADOW_TEMPORAL_LAYOUT = fieldLayout('CloudShadowTemporalBlock', [
  ['cameraFromClip', 'mat4x4f'],
  ['previousClipFromCamera', 'mat4x4f'],
  ['size', 'vec4f'],
  ['pixel', 'vec4f'],
  ['blend', 'vec4f'],
  ['depth', 'vec4f'],
] as const)

/** The block of a light's temporal filter into `out` (`CLOUD_SHADOW_TEMPORAL_LAYOUT.words` floats). */
export function writeCloudShadowTemporal(
  out: Float32Array,
  frame: CloudShadowFrame,
  side: number,
  weight: number,
  temporal: CloudShadowTemporal,
) {
  const { at } = CLOUD_SHADOW_TEMPORAL_LAYOUT
  out.set(frame.cameraFromClip, at.cameraFromClip)
  out.set(temporal.previousClipFromCamera, at.previousClipFromCamera)
  out.set([side, side, 1 / side, 1 / side], at.size)
  out.set(temporal.pixel, at.pixel)
  out.set([weight, temporal.history ? 1 : 0, temporal.anchorMoved ? 1 : 0, 0], at.blend)
  out.set([temporal.depthFrom, temporal.depthScale, 0, 0], at.depth)
  return out
}

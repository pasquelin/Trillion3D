import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  LIGHT_SHAFT_LIGHT_DISTANCE,
  lightShaftDirection,
  type LightShaftLight,
} from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import type { ImageSize, Size } from '../clouds/reconstructLayout.ts'

/**
 * WHAT THE LIGHT SHAFTS ARE MADE OF, the one table every pass reads: the shafts are drawn in a
 * texture a fixed factor under the view's size per axis (`lightShaftDownsample`, `./quality.ts`),
 * four passes deep at most — the reduction, the temporal filter, the radial blurs, the end — and
 * the view's rect is the origin of every texture.
 */

/** The shafts' images: three half floats and a one, the blur's and the bloom's colour with an
 *  occlusion mask in the first channel. The reference draws them in 11-11-10 floats; this format
 *  loses nothing against it and is rendered on every device. */
export const LIGHT_SHAFT_FORMAT: GPUTextureFormat = 'rgba16float'

/** The occlusion mask the fog reads, one half float: only the first channel of the reference's
 *  image is read. */
export const LIGHT_SHAFT_MASK_FORMAT: GPUTextureFormat = 'r16float'

/** The factors the reduction is cut to: the renderer clamps the setting. */
const LEAST_DOWNSAMPLE = 1,
  MOST_DOWNSAMPLE = 8

/** The downsample factor the passes use. */
export const lightShaftFactor = (downsample: number) =>
  clamp(downsample, LEAST_DOWNSAMPLE, MOST_DOWNSAMPLE)

const reduced = (size: Size, by: number): Size => ({
  width: Math.max(1, ceilDiv(size.width, by)),
  height: Math.max(1, ceilDiv(size.height, by)),
})

/** The shafts' image for a view of `view` pixels drawn in a target allocated at `allocated`, each
 *  divided by the factor and rounded up, one pixel at least. */
export function lightShaftSizes(allocated: Size, view: Size, downsample: number): ImageSize {
  const by = lightShaftFactor(downsample)
  return { texture: reduced(allocated, by), view: reduced(view, by) }
}

/** The pixel of the view the light's blur starts at, and whether the light is in front of the eye. */
export interface LightShaftOrigin {
  /** The clip `w` of the light: the light is drawn only when above 0. */
  readonly w: number
  /** The light's pixel in the view, from its top left; far off the view for a light to its side. */
  readonly pixel: readonly [number, number]
}

/**
 * Where the shafts' light stands in the view: the point at `LIGHT_SHAFT_LIGHT_DISTANCE` metres from
 * `eye`, back along `direction` (the direction the light shines in, or its override), through
 * `viewProjection` (column-major, in the space `eye` is in, jittered when the view is), its clip
 * `x` and `y` over `w` mapped across the `view` pixels with `y` down.
 */
export function lightShaftOrigin(
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
  light: LightShaftLight,
  direction: readonly [number, number, number],
  view: Size,
): LightShaftOrigin {
  const [dx, dy, dz] = lightShaftDirection(light, direction)
  const x = eye[0] - dx * LIGHT_SHAFT_LIGHT_DISTANCE,
    y = eye[1] - dy * LIGHT_SHAFT_LIGHT_DISTANCE,
    z = eye[2] - dz * LIGHT_SHAFT_LIGHT_DISTANCE
  const m = viewProjection
  const clip = (row: number) => m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row]
  const w = clip(3)
  return {
    w,
    pixel: [(0.5 + (clip(0) * 0.5) / w) * view.width, (0.5 - (clip(1) * 0.5) / w) * view.height],
  }
}

/** The aspect ratio of the shafts' image, and its inverse: the part of the texture the view fills
 *  per axis, the second scaled by the texture's width over its height. */
export function lightShaftAspect(shaft: ImageSize) {
  const x = shaft.view.width / shaft.texture.width
  const y =
    (shaft.texture.width * (shaft.view.height / shaft.texture.height)) / shaft.texture.height
  return { x, y, inverseX: 1 / x, inverseY: 1 / y }
}

/** The bounds of the reads of the shafts' image, in texture coordinates, half a texel inside the
 *  view's edge: `(minX, minY, maxX, maxY)`. */
export function lightShaftBounds(shaft: ImageSize) {
  const { texture, view } = shaft
  return [
    0.5 / texture.width,
    0.5 / texture.height,
    (view.width - 0.5) / texture.width,
    (view.height - 0.5) / texture.height,
  ] as const
}

/** The texture coordinates of a pass's pixel are its pixel centre times these two numbers: the
 *  input's view over the pixels the pass writes, over the input's texture, per axis. */
export const lightShaftUvPerPixel = (input: ImageSize, written: Size) =>
  [
    input.view.width / (written.width * input.texture.width),
    input.view.height / (written.height * input.texture.height),
  ] as const

/** The device depth of a point on the view axis at distance `s`, `(a·s + b) / (c·s + d)`, for the
 *  perspective `projection` (column-major): the terms `(a, b, c, d)` the passes invert. */
export function lightShaftDepthTerms(projection: ArrayLike<number>) {
  const ahead = Math.sign(projection[11]) || 1
  return [projection[10] * ahead, projection[14], projection[11] * ahead, projection[15]] as const
}

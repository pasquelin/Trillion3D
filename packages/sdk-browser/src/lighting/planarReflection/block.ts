import { DEG2RAD } from '../../../../math/src/constants.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { ResolvedPlanarReflection } from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'
import type { PlanarPlane } from './mirror.ts'
import { PLANAR_COMPOSITE_LAYOUT, PLANAR_PREFILTER_LAYOUT } from './wgsl.ts'

/** The reference's smallest divisor (its delta): a fade whose start and end meet divides by this. */
const DELTA = 1e-5

/** The four words `x, y, z, w` at `at` of `words`, with no array made. */
const put = (words: Float32Array, at: number, x: number, y: number, z: number, w: number) => {
  words[at] = x
  words[at + 1] = y
  words[at + 2] = z
  words[at + 3] = w
}

/** The words of the composite's block (`PLANAR_COMPOSITE_LAYOUT`). */
export const compositeWords = () => new Float32Array(PLANAR_COMPOSITE_LAYOUT.words)
/** The words of the prefilter's block (`PLANAR_PREFILTER_LAYOUT`). */
export const prefilterWords = () => new Float32Array(PLANAR_PREFILTER_LAYOUT.words)

/**
 * The composite's block of `reflection` (`planar`, its plane and box) for the mirrored view drawn with `projection` (column-major): the plane, its
 * origin and axes with the reach along each, the distance fade (`scale` the reciprocal of the fade's length, `bias` its start), the normal's
 * distortion, the angle fade over the cosines of its two angles, and the projection.
 */
export function writeCompositeBlock(
  words: Float32Array,
  reflection: ResolvedPlanarReflection,
  planar: PlanarPlane,
  projection: ArrayLike<number>,
) {
  const at = PLANAR_COMPOSITE_LAYOUT.at
  const { normal: n, origin: o } = planar
  const fadeScale =
    1 /
    Math.max(
      reflection.distanceFromPlaneFadeoutEnd - reflection.distanceFromPlaneFadeoutStart,
      DELTA,
    )
  const cosStart = Math.cos(reflection.angleFromPlaneFadeStart * DEG2RAD)
  const cosEnd = Math.cos(reflection.angleFromPlaneFadeEnd * DEG2RAD)
  const range = 1 / Math.max(cosStart - cosEnd, DELTA)
  const { xAxis, zAxis } = planar
  put(words, at.plane, n[0], n[1], n[2], planar.w)
  put(words, at.origin, o[0], o[1], o[2], 0)
  put(words, at.xAxis, xAxis[0], xAxis[1], xAxis[2], planar.xReach)
  put(words, at.yAxis, zAxis[0], zAxis[1], zAxis[2], planar.zReach)
  put(
    words,
    at.params,
    fadeScale,
    -reflection.distanceFromPlaneFadeoutStart * fadeScale,
    reflection.normalDistortionStrength,
    0,
  )
  put(words, at.params2, range, -cosEnd * range, 0, 0)
  copyMatrix4(words, projection, at.projection)
}

/** What the prefilter's block holds of the mirrored view: its camera's world matrix and the projection scales (the tangents of its half fields). */
export interface PrefilterView {
  /** The mirrored camera's world matrix, column-major: its axes and eye. */
  readonly world: ArrayLike<number>
  /** The mirrored camera's projection, column-major: the x and y scales are the first and sixth entries. */
  readonly projection: Float64Array
  /** The near distance of the projection, metres: a device depth `z` is the view depth `near / z`. */
  readonly near: number
}

/**
 * The prefilter's block: the reflection image of `image` pixels and the lit image it reads, drawn in `source` pixels of a target of `allocated`; the kernel
 * (its radius in pixels, the reference's `clamp(roughness, 0, 0.04) * 0.5 * width`, and the reciprocal of the distance it is reached at); the plane; and the
 * mirrored camera's frame, whose axes turn a pixel into the world ray of unit view depth.
 */
export function writePrefilterBlock(
  words: Float32Array,
  reflection: ResolvedPlanarReflection,
  planar: PlanarPlane,
  view: PrefilterView,
  image: ArrayLike<number>,
  allocated: ArrayLike<number>,
) {
  const at = PLANAR_PREFILTER_LAYOUT.at
  const { world: w, projection } = view
  const { normal: n } = planar
  put(words, at.size, image[0], image[1], 1 / image[0], 1 / image[1])
  put(words, at.source, allocated[0], allocated[1], 1 / allocated[0], 1 / allocated[1])
  put(
    words,
    at.kernel,
    reflection.prefilterRoughness * 0.5 * image[0],
    1 / Math.max(reflection.prefilterRoughnessDistance, DELTA),
    view.near,
    0,
  )
  put(words, at.plane, n[0], n[1], n[2], planar.w)
  // The camera looks down its -z: the forward axis is the third column negated.
  put(words, at.eye, w[12], w[13], w[14], 1 / projection[0])
  put(words, at.right, w[0], w[1], w[2], 1 / projection[5])
  put(words, at.up, w[4], w[5], w[6], 0)
  put(words, at.forward, -w[8], -w[9], -w[10], 0)
}

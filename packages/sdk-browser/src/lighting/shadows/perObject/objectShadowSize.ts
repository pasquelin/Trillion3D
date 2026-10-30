import { nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { distanceVector3 } from '../../../../../math/src/vector/vector.ts'
import {
  OBJECT_SHADOW_BORDER,
  OBJECT_SHADOW_MIN_FADE,
  TRANSLUCENT_SHADOW_DOWNSAMPLE,
  clampShadowResolution,
  shadowFadeAlpha,
  type ObjectShadowSettings,
} from './translucentShadowRules.ts'

/** What a view tells of the subject: where it stands, the scale from a radius at a unit distance to pixels, and the scale of its projection. */
export interface ObjectShadowView {
  readonly origin: ArrayLike<number>
  /** The pixels a radius of 1 covers at a distance of 1: the larger of the half widths of the projection's x and y scales over the viewport. */
  readonly screenScale: number
  /** The projection's x and y scales. */
  readonly projectionScale: readonly [number, number]
}

/** The bounding sphere (centre and radius) of an object shadow's subject, in the unit of the shadow settings. */
export interface ObjectShadowSphere {
  readonly center: ArrayLike<number>
  readonly radius: number
}

/** What the view asks of one light x object pair. */
export interface ObjectShadowSize {
  /** The side of the opaque-sized rectangle, texels. */
  readonly sizeX: number
  /** The side the view needs of the translucent rectangle's x and its y limit, texels. */
  readonly translucentX: number
  readonly translucentMaxY: number
  /** The share of the view the subject covers. */
  readonly maxScreenPercent: number
  /** The fade of the view. */
  readonly fade: number
}

/**
 * The size of the translucent rectangle a light x object pair is given, or `null` where the pair fades away in the view (or
 * per-object shadows are off). The resolution the view asks (the subject's radius on screen times the texels for a
 * pixel, held to the maximum by the light's scale) is rounded to half of the power of two over it, held to the maximum, then
 * shrunk by the translucent factor into the translucent atlas's limits.
 */
export function objectShadowSize(
  s: ObjectShadowSettings,
  subject: ObjectShadowSphere,
  view: ObjectShadowView,
  resolutionScale: number,
): ObjectShadowSize | null {
  const bufferSide = clamp(s.maxResolution, 1, s.maxBufferSide)
  const maxRes = Math.min(s.maxResolution, bufferSide) - OBJECT_SHADOW_BORDER * 2
  // A shadow is asked at least the minimum side, held to the buffer.
  const smallest = Math.min(s.minResolution, bufferSide - OBJECT_SHADOW_BORDER * 2)
  const distance = Math.max(distanceVector3(subject.center, view.origin), 1)
  const screenRadius = (view.screenScale * subject.radius) / distance
  const maxScreenPercent =
    (Math.max(0.5 * view.projectionScale[0], 0.5 * view.projectionScale[1]) * subject.radius) /
    distance
  const unclamped = screenRadius * s.texelsPerPixel
  const clamped = clampShadowResolution(unclamped, resolutionScale, maxRes)
  const fadeFrom = s.fadeUsesResolutionScale ? clamped : unclamped
  const fade = shadowFadeAlpha(fadeFrom, s.fadeResolution, s.minResolution, s.fadeExponent)
  const desired = Math.max(Math.trunc(clamped), smallest)
  if (!s.perObject || !(fade > OBJECT_SHADOW_MIN_FADE)) return null
  // Half the power of two over the desired side, so that a change of size doubles or halves it.
  const sizeX = clamp(nextPow2(desired) / 2, 1, maxRes)
  const translucentSide = translucentAtlasSide(s)
  return {
    sizeX,
    translucentX: clamp(
      Math.trunc(sizeX / TRANSLUCENT_SHADOW_DOWNSAMPLE),
      1,
      translucentSide - OBJECT_SHADOW_BORDER * 2,
    ),
    translucentMaxY: clamp(
      Math.trunc(maxRes / TRANSLUCENT_SHADOW_DOWNSAMPLE),
      1,
      translucentSide - OBJECT_SHADOW_BORDER * 2,
    ),
    maxScreenPercent,
    fade,
  }
}

/** The side of the translucent atlases: half the shadow buffer's, held to the device. */
export const translucentAtlasSide = (s: ObjectShadowSettings) =>
  clamp(
    Math.trunc(clamp(s.maxResolution, 1, s.maxBufferSide) / TRANSLUCENT_SHADOW_DOWNSAMPLE),
    1,
    s.maxBufferSide,
  )

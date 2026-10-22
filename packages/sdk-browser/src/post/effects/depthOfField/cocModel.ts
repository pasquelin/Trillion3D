import { clamp } from '../../../../../math/src/scalar/reals.ts'
import type { ResolvedDepthOfField } from '../../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'

/**
 * THE PHYSICAL MODEL OF THE CIRCLE OF CONFUSION, on the processor, once per image: the lens and the
 * sensor of the view's depth of field (`ResolvedDepthOfField`) and the camera's field of view give
 * the radius a point of any depth spreads to, in shares of the image's width. What the shaders
 * evaluate per pixel (`dofCommonWgsl.ts`) is this model's `infinityRadius`, `minForeground` and
 * `maxBackground` and its depth blur; the passes that choose their work from the largest radii
 * (`dofPlan.ts`) read `cocRadiusAt`. Distances are metres, the sensor's millimetres; the model is the
 * same in any unit as long as the sensor, the focal length and the focus agree.
 */

/** Metres in a millimetre: the sensor's width in the units of the scene. */
const METRES_PER_MILLIMETRE = 0.001
/** Metres in a kilometre: the depth blur's 50 % distance. */
const METRES_PER_KILOMETRE = 1000
/** Metres in a centimetre: the lens barrel's and the matte box's lengths. */
export const METRES_PER_CENTIMETRE = 0.01
/** The width the depth blur's radius is given at, in pixels. */
const DEPTH_BLUR_REFERENCE_WIDTH = 1920

/** The view the model is compiled for: the unscaled image's size, in pixels, and the camera's
 *  projection. */
interface CocView {
  /** The size of the image the pass draws on, in pixels (the display's under an upscaler). */
  readonly width: number
  readonly height: number
  /** The projection's `p₀₀` and `p₁₁`: the cotangents of the horizontal and the vertical half field
   *  of view. */
  readonly cotHorizontal: number
  readonly cotVertical: number
}

/** The model: every field a pass reads, resolution-free (shares of the image's width) unless said. */
export interface CocModel {
  /** Width and height of the sensor in the scene's units. */
  readonly sensorWidth: number
  readonly sensorHeight: number
  /** The rendering aspect ratio: the image's, times the aspect ratio scalar. */
  readonly aspectRatio: number
  /** The lens' focal length, in the scene's units, from the sensor's height and the vertical field. */
  readonly focalLength: number
  /** The f-stop. */
  readonly fStops: number
  /** The radius of the circle at infinity, unclamped; 0 where the lens is not focused. */
  readonly infinityRadius: number
  /** The foreground's largest radius, 0 or less: the circle at the nearest depth drawn, held to it. */
  readonly minForeground: number
  /** The background's largest radius. */
  readonly maxBackground: number
  /** The focus distance, in metres. */
  readonly focusDistance: number
  /** The anamorphic squeeze, 0.1 to 10. */
  readonly squeeze: number
  /** The depth blur's largest radius and its 50 % distance's inverse, per metre. */
  readonly depthBlurRadius: number
  readonly depthBlurExponent: number
  /** The sensor's size and the lens' aperture diameter, in the scene's units, and the distance the
   *  lens focuses the image at: what the barrel's projection reads. */
  readonly aperture: number
  readonly lensImageDistance: number
  /** The lens barrel's radius, at least as wide as the aperture's half and a half unit; its length. */
  readonly barrelRadius: number
  readonly barrelLength: number
}

/** The radii the quality settings hold the circle to, as shares of the image's width. */
interface CocLimits {
  readonly maxForeground: number
  readonly maxBackground: number
}

/**
 * The model of `volume` seen through `view`: the sensor's height from its width and the aspect
 * ratio, the focal length from the sensor's height and the vertical field, the circle at infinity
 * from the f-stop and the focus (`f² / (N · (d − f))`, converted to a radius on the sensor then to
 * the image's width). A lens with no f-stop or no focus has none: circles of 0 (a depth blur alone).
 */
export function compileCocModel(
  volume: ResolvedDepthOfField,
  view: CocView,
  limits: CocLimits,
): CocModel {
  const squeeze = volume.squeezeFactor
  const aspectRatio = (view.width / view.height) * volume.aspectRatioScalar
  const sensorWidth = volume.sensorWidth * METRES_PER_MILLIMETRE
  const sensorHeight = sensorWidth / (aspectRatio / squeeze)
  const focalLength = 0.5 * sensorHeight * view.cotVertical // 1 / tan(half field)
  const fStops = volume.aperture
  const focus = volume.focusDistance
  const aperture = focalLength / fStops
  const depthBlurRadius = (volume.depthBlurRadius / DEPTH_BLUR_REFERENCE_WIDTH) * 2
  const model = {
    sensorWidth,
    sensorHeight,
    aspectRatio,
    focalLength,
    fStops,
    focusDistance: focus,
    squeeze,
    depthBlurRadius,
    depthBlurExponent: 1 / (volume.depthBlurAmount * METRES_PER_KILOMETRE),
    aperture,
    lensImageDistance: 1 / (1 / focalLength - 1 / focus),
    barrelRadius: Math.max(
      volume.barrelRadius * METRES_PER_CENTIMETRE,
      aperture / 2 + 0.5 * METRES_PER_CENTIMETRE,
    ),
    barrelLength: volume.barrelLength * METRES_PER_CENTIMETRE,
  }
  if (!(fStops > 0 && focus > 0))
    return { ...model, infinityRadius: 0, minForeground: 0, maxBackground: limits.maxBackground }
  // Convert f-stop, focal length and focus to the circle of infinity's diameter on the sensor,
  // then to a radius in shares of the sensor's height, then of the image's width.
  const diameter = (focalLength * focalLength) / (fStops * (focus - focalLength))
  const uncropped = (diameter * 0.5) / sensorHeight
  const desqueezed = (sensorWidth / sensorHeight) * squeeze
  const vertical = uncropped * Math.max(aspectRatio / desqueezed, 1)
  return {
    ...model,
    infinityRadius: vertical / aspectRatio,
    minForeground: -limits.maxForeground,
    maxBackground: limits.maxBackground,
  }
}

/** The circle's radius, in pixels of an image `width` wide, of a point `depth` away: the model's
 *  circle at that depth or the depth blur's, the larger, signed (negative for the foreground), held
 *  to the largest radii. */
export function cocRadiusAt(model: CocModel, depth: number, width: number) {
  const radius = ((depth - model.focusDistance) / depth) * model.infinityRadius
  const blur = (1 - 2 ** (-depth * model.depthBlurExponent)) * model.depthBlurRadius
  let signed = Math.max(Math.abs(radius), blur)
  if (radius < 0) signed = -signed
  return width * clamp(signed, model.minForeground, model.maxBackground)
}

/** The largest background radius, in pixels of an image `width` wide: the circle at infinity or the
 *  depth blur's, whichever is larger, held to the limit. */
export const maxBackgroundRadius = (model: CocModel, width: number) =>
  clamp(Math.max(model.infinityRadius, model.depthBlurRadius), 0, model.maxBackground) * width

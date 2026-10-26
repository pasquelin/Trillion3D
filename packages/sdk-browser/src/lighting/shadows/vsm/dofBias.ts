import type { CocModel } from '../../../post/effects/depthOfField/cocModel.ts'

/**
 * THE DEPTH OF FIELD AS THE SHADOW MAPS' RESOLUTION SEES IT: where the image is blurred the maps are
 * asked at a lower resolution, as the blur hides it. A view with a depth of field holds the circle of
 * confusion's model once a frame (`CocModel`: the radius a point of any depth spreads to, in shares of
 * the image's width, held between the foreground's and the background's largest) and the most levels
 * the bias takes (`shadowMaxDofResolutionBias`); the bias at a depth is the circle's radius in pixels
 * over `DOF_BIAS_RAMP_PIXELS` of the strength, never above it (`vsmDofResolutionBias`,
 * `uniforms.ts`). A strength of 0 is no bias.
 */
export interface VsmDofBias {
  /** The most levels the bias takes; 0 for none (no depth of field, or the setting 0). */
  strength: number
  /** The model's fields a pixel's radius is computed from: the circle at infinity, the foreground's
   *  and the background's largest radii, the focus distance, the depth blur's exponent and radius. */
  infinityRadius: number
  minForeground: number
  maxBackground: number
  focusDistance: number
  blurExponent: number
  blurRadius: number
  /** The width of the image the radii are shares of, in pixels. */
  width: number
}

/** The radius of the circle, in pixels, at which the bias is full. */
export const DOF_BIAS_RAMP_PIXELS = 8

/** A bias of no strength. */
export const noDofBias = (): VsmDofBias => ({
  strength: 0,
  infinityRadius: 0,
  minForeground: 0,
  maxBackground: 0,
  focusDistance: 0,
  blurExponent: 0,
  blurRadius: 0,
  width: 1,
})

/** `into`, set to the bias of `strength` levels under `model`, for an image `width` pixels wide. */
export function setDofBias(into: VsmDofBias, model: CocModel, strength: number, width: number) {
  into.strength = strength
  into.infinityRadius = model.infinityRadius
  into.minForeground = model.minForeground
  into.maxBackground = model.maxBackground
  into.focusDistance = model.focusDistance
  into.blurExponent = model.depthBlurExponent
  into.blurRadius = model.depthBlurRadius
  into.width = width
}

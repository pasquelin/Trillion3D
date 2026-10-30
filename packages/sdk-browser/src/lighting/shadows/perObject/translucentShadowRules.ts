/**
 * THE RULES OF AN OBJECT'S TRANSLUCENT SHADOW, the CPU side of the per-object shadows a translucent surface casts into the
 * maps of a light that has no virtual maps (the classic mode, `shadowVirtualEnable` off): which light x object pairs make one,
 * how many texels it is given and how far it fades. Lengths are centimetres, the unit the shadow settings are written in.
 */

/** The format of the atlases' coefficient targets and of the depth pass that adds into them. */
export const TRANSLUCENT_SHADOW_FORMAT: GPUTextureFormat = 'rgba16float'
/** The border, in texels, round an object's rectangle in its atlas. */
export const OBJECT_SHADOW_BORDER = 4
/** The factor an object's rectangle is shrunk by in the translucent atlases against an opaque object's. */
export const TRANSLUCENT_SHADOW_DOWNSAMPLE = 2
/** The colour targets of one translucent atlas (the Fourier coefficients of the opacity, four a target). */
export const TRANSLUCENT_SHADOW_TARGETS = 2
/** Below this fade the shadow is not made (a 256th). */
export const OBJECT_SHADOW_MIN_FADE = 1 / 256

/** The settings that shape the sizes and fades of the object shadows, at their defaults. */
export interface ObjectShadowSettings {
  /** The project allows translucent object shadows at all (off). */
  readonly projectEnabled: boolean
  /** The translucent shadow depths are drawn (on). */
  readonly useDepths: boolean
  /** Per-object shadows are made (on). */
  readonly perObject: boolean
  /** The largest side of a shadow, texels (2048). */
  readonly maxResolution: number
  /** The device's largest texture side, texels. */
  readonly maxBufferSide: number
  /** The shadow texels for a pixel of the subject (1.27324). */
  readonly texelsPerPixel: number
  /** The smallest side a shadow takes, texels (32). */
  readonly minResolution: number
  /** The side below which a shadow fades, texels (64). */
  readonly fadeResolution: number
  /** The rate of the fade (0.25). */
  readonly fadeExponent: number
  /** The light's resolution scale feeds the fade (on). */
  readonly fadeUsesResolutionScale: boolean
  /** The share of the subject's radius a directional object shadow reaches past it (8). */
  readonly castDistanceRadiusScale: number
  /** The least reach of a directional object shadow (32768). */
  readonly castDistanceMin: number
}

export const OBJECT_SHADOW_DEFAULTS: ObjectShadowSettings = {
  projectEnabled: false,
  useDepths: true,
  perObject: true,
  maxResolution: 2048,
  maxBufferSide: 16384,
  texelsPerPixel: 1.27324,
  minResolution: 32,
  fadeResolution: 64,
  fadeExponent: 0.25,
  fadeUsesResolutionScale: true,
  castDistanceRadiusScale: 8,
  castDistanceMin: 1048576 / 32,
}

/** Whether the frame makes translucent object shadows at all: the project allows them, the depths are drawn and per-object shadows are made. */
export const makesTranslucentObjectShadow = (s: ObjectShadowSettings) =>
  s.projectEnabled && s.useDepths && s.perObject

/** The fade of a shadow of `resolution` texels: 1 above the fade resolution, 0 under the minimum, an exponential ramp between. */
export function shadowFadeAlpha(
  resolution: number,
  fadeResolution: number,
  minResolution: number,
  exponent: number,
) {
  if (resolution > fadeResolution) return 1
  if (!(resolution > minResolution)) return 0
  if (minResolution >= fadeResolution) return 1 - (resolution - minResolution) ** exponent
  const inverseRange = 1 / (fadeResolution - minResolution)
  const first = inverseRange ** exponent
  return (((resolution - minResolution) * inverseRange) ** exponent - first) / (1 - first)
}

/** A resolution held to the maximum, the light's scale raising it before the clamp and lowering it after. */
export function clampShadowResolution(unclamped: number, scale: number, max: number) {
  let r = unclamped
  if (scale > 1) r *= scale
  r = Math.min(r, max)
  if (scale <= 1) r *= scale
  return r
}

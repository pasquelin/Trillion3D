import type { Side as EngineSide } from '../../contracts/material.ts'
import type { TextureFilter, WrapMode } from '../../texture/contract.ts'
import { TONE_MAPPING_RANK, type SceneToneMapping } from '../../scene/core/environment.ts'

/** Which faces a surface draws: the engine's own `Side` words (`contracts/material.ts`). */
export const side = Object.freeze({
  /** Draw only the faces that look at the camera. */
  front: 'front',
  /** Draw only the faces that look away. */
  back: 'back',
  /** Draw both sides of every face. */
  double: 'double',
} as const satisfies Record<string, EngineSide>)

/** How a coordinate outside `[0, 1]` comes back: the engine's `WrapMode` words. */
export const wrap = Object.freeze({
  /** The picture repeats like tiles. */
  repeat: 'repeat',
  /** The edge pixels stretch outward. */
  clamp: 'clamp',
  /** The picture repeats, flipped every other time. */
  mirror: 'mirror',
} as const satisfies Record<string, WrapMode>)

/** Texture sampling rules. */
export const filter = Object.freeze({
  /** Takes the closest pixel: sharp, blocky. */
  nearest: 'nearest',
  /** Mixes the four closest pixels: smooth. */
  linear: 'linear',
  /** Closest pixel of the closest smaller copy. */
  nearestMipNearest: 'nearestMipNearest',
  /** Smooth pixel of the closest smaller copy. */
  linearMipNearest: 'linearMipNearest',
  /** Closest pixel, mixed between two smaller copies. */
  nearestMipLinear: 'nearestMipLinear',
  /** Smooth pixel, mixed between two smaller copies: the smoothest. */
  linearMipLinear: 'linearMipLinear',
} as const satisfies Record<string, TextureFilter>)

/** How a surface composes over what is behind it. */
export const blending = Object.freeze({
  /** Mixes by opacity, like tinted glass. */
  normal: 'normal',
  /** Adds its light to what is behind, like fire. */
  additive: 'additive',
  /** Takes its colour away from what is behind. */
  subtractive: 'subtractive',
  /** Multiplies what is behind by its colour, like a filter. */
  multiply: 'multiply',
  /** Mixes like `normal`, its colour already multiplied by its opacity: the colour is added as it
   *  is and the opacity only lets less of what is behind through. */
  alphaComposite: 'alphaComposite',
  /** Holds out what is behind by its opacity and adds no colour of its own: a matte that cuts the
   *  translucent surfaces behind it away from the image. */
  alphaHoldout: 'alphaHoldout',
} as const)

/** How a see-through surface is lit by the lights that reach it (`Material.translucencyLighting`). */
export const translucencyLighting = Object.freeze({
  /** Every light is evaluated for the pixel, as it is for an opaque surface: the lights' highlights
   *  and the surface's reflection with them, each light's shadow read at the pixel. The most exact,
   *  and the most expensive; what a transmissive or thin see-through surface imported from a scene file is
   *  given. */
  forward: 'forward',
  /** The light is read from the translucency lighting volume, a blurred field of the light around
   *  the camera: the surface's normal weighs it, so a pane has a lit side and a dark one; the
   *  surface's reflection stays, the lights' highlights go. Cheap per pixel; the volume reaches a
   *  limited distance. What a blended surface imported from a scene file is given, unless it transmits. */
  volume: 'volume',
  /** The surface is a medium lit from the volume, its normal weighing the light (smoke, dust, a
   *  cloud of particles): no highlight, no reflection. */
  volumetric: 'volumetric',
  /** The surface is a medium lit from the volume with no direction: the ambient term of the
   *  light alone, whatever the normal. The cheapest; the default of a material made in code. */
  volumetricNonDirectional: 'volumetricNonDirectional',
} as const)

/** The lighting of a see-through surface of a material made in code, which names none. */
export const DEFAULT_TRANSLUCENCY_LIGHTING = translucencyLighting.volumetricNonDirectional

/** The lighting a scene file's material is given: a surface that transmits (a transmission, a thin
 *  translucent one) is lit light by light in its own fragment, any other blended one is read, as a
 *  surface, from the translucency lighting volume. */
export const importedTranslucencyLighting = (transmits: boolean) =>
  transmits ? translucencyLighting.forward : translucencyLighting.volume

/** Which pass of the image a see-through surface is drawn in (`Material.translucencyPass`,
 *  `ParticlePoolSpec.translucencyPass`). */
export const translucencyPass = Object.freeze({
  /** Drawn into the scene before the depth of field, which blurs it with the scene it lies in. */
  beforeDepthOfField: 'beforeDepthOfField',
  /** Drawn apart and laid over the image once the depth of field has read it, so that no blur
   *  reaches it; the default. */
  afterDepthOfField: 'afterDepthOfField',
  /** Drawn apart and laid over the image after the temporal anti-aliasing and the motion blur have
   *  read it, so that neither smears it: it stays as sharp as it was drawn. */
  afterMotionBlur: 'afterMotionBlur',
} as const)

/** How texels are encoded: a colour map carries the sRGB curve, a data map does not. */
export const colorSpace = Object.freeze({
  /** Colour pictures: the numbers carry the screen's sRGB curve. */
  srgb: 'srgb',
  /** Plain numbers, read as they are: normal maps, roughness maps. */
  linear: 'linear',
  /** No colour meaning at all. */
  none: 'none',
} as const)

/**
 * The curve that brings scene radiance into the display range: every curve the engine ranks.
 * @property none - No curve: bright light is simply cut off at white.
 * @property filmic - A film's own response, in a wide gamut: a toe, a straight run and a
 *   shoulder, a touch of desaturation at both ends; its method is the colour grading's
 *   (`tonemappingMethod`: the film curve, or the standard output transform of the film
 *   industry's colour system). The world's default.
 */
export const toneMapping = Object.freeze(
  Object.fromEntries(Object.keys(TONE_MAPPING_RANK).map((name) => [name, name])) as {
    readonly [Name in SceneToneMapping]: Name
  },
)

/** Which faces a material draws: `'front'`, `'back'` or `'double'`. */
export type Side = (typeof side)[keyof typeof side]
/** How a texture repeats outside its edges: `'repeat'`, `'clamp'` or `'mirror'`. */
export type Wrap = (typeof wrap)[keyof typeof wrap]
/** How a texture picks its pixels when it is shown bigger or smaller. */
export type Filter = (typeof filter)[keyof typeof filter]
/** How a surface mixes with what is behind it, by name. */
export type Blending = (typeof blending)[keyof typeof blending]
/** How a see-through surface is lit: `'forward'`, `'volume'`, `'volumetric'` or `'volumetricNonDirectional'`. */
export type TranslucencyLighting = (typeof translucencyLighting)[keyof typeof translucencyLighting]
/** Which pass of the image a see-through surface is drawn in: `'beforeDepthOfField'`, `'afterDepthOfField'` or `'afterMotionBlur'`. */
export type TranslucencyPass = (typeof translucencyPass)[keyof typeof translucencyPass]
/** How a texture's numbers are read: as colours with the sRGB curve, or plain. */
export type ColorSpace = (typeof colorSpace)[keyof typeof colorSpace]
/** The name of a curve that turns scene light into screen colours. */
export type ToneMapping = (typeof toneMapping)[keyof typeof toneMapping]

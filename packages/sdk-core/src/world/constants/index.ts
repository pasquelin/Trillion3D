import type { Side as EngineSide } from '../../contracts/material.ts';
import type { WrapMode } from '../../texture/contract.ts';
import { TONE_MAPPING_RANK, type SceneToneMapping } from '../../scene/core/environment.ts';

/** Which faces a surface draws: the engine's own `Side` words (`contracts/material.ts`). */
export const side = Object.freeze({
  /** Draw only the faces that look at the camera. */
  front: 'front',
  /** Draw only the faces that look away. */
  back: 'back',
  /** Draw both sides of every face. */
  double: 'double',
} as const satisfies Record<string, EngineSide>);

/** How a coordinate outside `[0, 1]` comes back: the engine's `WrapMode` words. */
export const wrap = Object.freeze({
  /** The picture repeats like tiles. */
  repeat: 'repeat',
  /** The edge pixels stretch outward. */
  clamp: 'clamp',
  /** The picture repeats, flipped every other time. */
  mirror: 'mirror',
} as const satisfies Record<string, WrapMode>);

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
} as const);

/** How a surface composes over what is behind it. */
export const blending = Object.freeze({
  /** No mixing: the surface covers what is behind. */
  none: 'none',
  /** Mixes by opacity, like tinted glass. */
  normal: 'normal',
  /** Adds its light to what is behind, like fire. */
  additive: 'additive',
  /** Takes its colour away from what is behind. */
  subtractive: 'subtractive',
  /** Multiplies what is behind by its colour, like a filter. */
  multiply: 'multiply',
} as const);

/** How texels are encoded: a colour map carries the sRGB curve, a data map does not. */
export const colorSpace = Object.freeze({
  /** Colour pictures: the numbers carry the screen's sRGB curve. */
  srgb: 'srgb',
  /** Plain numbers, read as they are: normal maps, roughness maps. */
  linear: 'linear',
  /** No colour meaning at all. */
  none: 'none',
} as const);

/**
 * The curve that brings scene radiance into the display range: every curve the engine ranks.
 * @property none - No curve: bright light is simply cut off at white.
 * @property linear - Scales the light by the exposure, then cuts off at white.
 * @property reinhard - Squeezes bright light smoothly toward white.
 * @property cineon - The look of cinema film.
 * @property aces - The film industry's standard curve, and the world's default.
 * @property agx - Keeps colours natural even in very bright light.
 * @property neutral - Changes colours as little as it can.
 */
export const toneMapping = Object.freeze(
  Object.fromEntries(Object.keys(TONE_MAPPING_RANK).map((name) => [name, name])) as {
    readonly [Name in SceneToneMapping]: Name;
  },
);

/** Which faces a material draws: `'front'`, `'back'` or `'double'`. */
export type Side = (typeof side)[keyof typeof side];
/** How a texture repeats outside its edges: `'repeat'`, `'clamp'` or `'mirror'`. */
export type Wrap = (typeof wrap)[keyof typeof wrap];
/** How a texture picks its pixels when it is shown bigger or smaller. */
export type Filter = (typeof filter)[keyof typeof filter];
/** How a surface mixes with what is behind it, by name. */
export type Blending = (typeof blending)[keyof typeof blending];
/** How a texture's numbers are read: as colours with the sRGB curve, or plain. */
export type ColorSpace = (typeof colorSpace)[keyof typeof colorSpace];
/** The name of a curve that turns scene light into screen colours. */
export type ToneMapping = (typeof toneMapping)[keyof typeof toneMapping];

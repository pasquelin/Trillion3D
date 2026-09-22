import type { Side as EngineSide } from '../../materialContract.ts';
import type { WrapMode } from '../../textureContract.ts';
import { TONE_MAPPING_RANK, type SceneToneMapping } from '../../sceneEnvironment.ts';

/** Which faces a surface draws: the engine's own `Side` words (`materialContract.ts`). */
export const side = Object.freeze({
  front: 'front',
  back: 'back',
  double: 'double',
} as const satisfies Record<string, EngineSide>);

/** How a coordinate outside `[0, 1]` comes back: the engine's `WrapMode` words. */
export const wrap = Object.freeze({
  repeat: 'repeat',
  clamp: 'clamp',
  mirror: 'mirror',
} as const satisfies Record<string, WrapMode>);

/** Texture sampling rules. */
export const filter = Object.freeze({
  nearest: 'nearest',
  linear: 'linear',
  nearestMipNearest: 'nearestMipNearest',
  linearMipNearest: 'linearMipNearest',
  nearestMipLinear: 'nearestMipLinear',
  linearMipLinear: 'linearMipLinear',
} as const);

/** How a surface composes over what is behind it. */
export const blending = Object.freeze({
  none: 'none',
  normal: 'normal',
  additive: 'additive',
  subtractive: 'subtractive',
  multiply: 'multiply',
} as const);

/** How texels are encoded: a colour map carries the sRGB curve, a data map does not. */
export const colorSpace = Object.freeze({ srgb: 'srgb', linear: 'linear', none: 'none' } as const);

/** The curve that brings scene radiance into the display range: every curve the engine ranks. */
export const toneMapping = Object.freeze(
  Object.fromEntries(Object.keys(TONE_MAPPING_RANK).map((name) => [name, name])) as {
    readonly [Name in SceneToneMapping]: Name;
  },
);

export type Side = (typeof side)[keyof typeof side];
export type Wrap = (typeof wrap)[keyof typeof wrap];
export type Filter = (typeof filter)[keyof typeof filter];
export type Blending = (typeof blending)[keyof typeof blending];
export type ColorSpace = (typeof colorSpace)[keyof typeof colorSpace];
export type ToneMapping = (typeof toneMapping)[keyof typeof toneMapping];

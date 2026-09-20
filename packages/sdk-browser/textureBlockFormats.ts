import { PREVIEW_BLOCK_FORMATS, type TextureBlockFormat } from '../sdk-core/index.ts';

/**
 * Which block format a session's pools take, and what that changes in bytes.
 *
 * The cache bakes every level in BC7 and in ASTC 4×4 beside the lossless PNG; the device says
 * which of the two it samples — desktop cards BC, mobile ones ASTC, some both, a software
 * adapter neither. The pools then hold one byte per texel instead of four: the same budget
 * carries four times the tiles, or a quarter of the budget carries the same view. The loss is
 * the codec's, declared and measured at cook time, never the engine's to hide: a device without
 * either feature keeps RGBA8, and the choice is published (`texturePoolFormat`).
 */
export type TextureCompression = 'auto' | TextureBlockFormat | 'none';

/** The WebGPU feature that unlocks each format. */
export const BLOCK_FEATURES: Record<TextureBlockFormat, GPUFeatureName> = {
  bc7: 'texture-compression-bc',
  astc: 'texture-compression-astc',
};

/** What a session decided, and why — what the diagnostic publishes. */
export type BlockChoice = { block: TextureBlockFormat | undefined; reason: string };

/**
 * The format the device can sample among those the host allows. `'auto'` takes BC7 before ASTC:
 * a device with both is a desktop one, and BC7 is the format its drivers optimise. `'none'` keeps
 * RGBA8 — the "before" of a measurement.
 */
export function chooseBlockFormat(
  features: { has(name: GPUFeatureName): boolean },
  wanted: TextureCompression = 'auto',
): BlockChoice {
  if (wanted === 'none') return { block: undefined, reason: 'host asked for rgba8' };
  const candidates = wanted === 'auto' ? PREVIEW_BLOCK_FORMATS : [wanted];
  for (const block of candidates)
    if (features.has(BLOCK_FEATURES[block]))
      return { block, reason: `device has ${BLOCK_FEATURES[block]}` };
  return {
    block: undefined,
    reason: `device lacks ${candidates.map((block) => BLOCK_FEATURES[block]).join(' and ')}`,
  };
}

/** The pool format of an atlas: sRGB-decoded for colour, linear for data, in the block format or RGBA8. */
export function poolFormat(
  kind: 'color' | 'data',
  block: TextureBlockFormat | undefined,
): GPUTextureFormat {
  const srgb = kind === 'color' ? '-srgb' : '';
  if (block === 'bc7') return `bc7-rgba-unorm${srgb}`;
  if (block === 'astc') return `astc-4x4-unorm${srgb}`;
  return `rgba8unorm${srgb}`;
}

/** Bytes a texel costs in a pool: four in RGBA8, one in either block format (sixteen per 4×4 block). */
export const texelBytes = (format: GPUTextureFormat) =>
  format.startsWith('bc7') || format.startsWith('astc') ? 1 : 4;

/** True when the pool holds blocks: what a copy must align to, and what no host image can fill. */
export const isBlockFormat = (format: GPUTextureFormat) => texelBytes(format) === 1;

/**
 * One opaque-white block per format — what slot 0 of a block pool pins, the texel a material
 * without a map reads. BC7: mode 6, every endpoint at its maximum; ASTC: a void-extent block of
 * 16-bit ones. Both proved on an independent decoder in
 * `packages/asset-compiler-rust/src/texture_preview/blocks/tests.rs`.
 */
export const WHITE_BLOCK: Record<TextureBlockFormat, Uint8Array> = {
  bc7: new Uint8Array([0xc0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 0, 0, 0, 0, 0, 0, 0]),
  astc: new Uint8Array([0xfc, 0xfd, ...new Array<number>(14).fill(0xff)]),
};

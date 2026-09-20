import {
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_LOSSLESS_FORMAT,
  type TextureBlockFormat,
  type TextureLevelFormat,
  type TexturePreview,
} from '../sdk-core/index.ts';

/**
 * Which block format a session's pools take, and everything that follows from it.
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

/** A tail as the sidecar carries it: RGBA8 levels and the same levels in each block format. */
export type TailBytes = Pick<TexturePreview, 'levels' | 'blocks'>;

/**
 * Everything the pools, the catalogue and the streamer derive from one block choice: the pool
 * formats (sRGB-decoded for colour, linear for data), the bytes a texel costs, the level file the
 * reader asks for, and which of a tail's encodings is pinned. One carrier, so that a third format
 * — BC5 for normals — is added here and nowhere else.
 */
export type PoolEncoding = {
  block: TextureBlockFormat | undefined;
  color: GPUTextureFormat;
  data: GPUTextureFormat;
  /** Four in RGBA8, one in either block format (sixteen per 4×4 block). */
  texelBytes: number;
  levelFormat: TextureLevelFormat;
  tailOf(tail: TailBytes): readonly Uint8Array[];
};

export function poolEncoding(block: TextureBlockFormat | undefined): PoolEncoding {
  const base =
    block === 'bc7' ? 'bc7-rgba-unorm' : block === 'astc' ? 'astc-4x4-unorm' : 'rgba8unorm';
  return {
    block,
    color: `${base}-srgb`,
    data: base,
    texelBytes: block ? 1 : 4,
    levelFormat: block ?? PREVIEW_LOSSLESS_FORMAT,
    tailOf: (tail) => (block ? tail.blocks[block] : tail.levels),
  };
}

/**
 * One opaque-white texel in every encoding — what slot 0 of a pool pins, the texel a material
 * without a map reads. BC7: mode 6, every endpoint at its maximum; ASTC: a void-extent block of
 * 16-bit ones. Both proved on an independent decoder in
 * `packages/asset-compiler-rust/src/texture_preview/blocks/tests.rs`.
 */
export const WHITE_TAIL: TailBytes = {
  levels: [new Uint8Array([255, 255, 255, 255]) as Uint8Array<ArrayBuffer>],
  blocks: {
    bc7: [
      new Uint8Array([
        0xc0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 0, 0, 0, 0, 0, 0, 0,
      ]) as Uint8Array<ArrayBuffer>,
    ],
    astc: [
      new Uint8Array([0xfc, 0xfd, ...new Array<number>(14).fill(0xff)]) as Uint8Array<ArrayBuffer>,
    ],
  },
};

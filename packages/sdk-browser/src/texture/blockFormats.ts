import {
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_LAYOUT_NAMES,
  textureLevelFormat,
  type TextureBlockFormat,
  type TextureLayout,
  type TexturePreview,
} from '../../../sdk-core/src/index.ts';

/**
 * Which block family a session's pools take, and everything that follows from it.
 *
 * The cache bakes a chain in the families the cook asked for beside the lossless PNG, and only
 * where a quality gate kept it; the device says which family it samples — desktop cards BC,
 * mobile ones ASTC, some both, a software adapter neither. An atlas then has one pool per
 * LANE, the layouts the sidecar names: `lossless` (RGBA8, four bytes a texel — what a chain
 * under the bar, a host image or a device without the feature reads), `rgba` (BC7 or ASTC, one
 * byte a texel) and `two-channel` (BC5 or ASTC luminance-alpha, one byte a texel, the normal
 * map's X and Y with Z rebuilt by the shader). Nothing is lost by the engine: a texture takes
 * the lane its chain was kept in, and the choice is published (`texturePoolFormat`).
 */
export type TextureCompression = 'auto' | TextureBlockFormat | 'none';

/** The WebGPU feature that unlocks each family. */
export const BLOCK_FEATURES: Record<TextureBlockFormat, GPUFeatureName> = {
  bc7: 'texture-compression-bc',
  astc: 'texture-compression-astc',
};

/** What a session decided, and why — what the diagnostic publishes. */
export type BlockChoice = { block: TextureBlockFormat | undefined; reason: string };

/**
 * The family the session samples: among those the host allows, the first the device has AND
 * some chain of the cache was kept in. `'auto'` tries BC before ASTC — a device with both is a
 * desktop one, and BC is the family its drivers optimise —, but a cache cooked in ASTC alone
 * takes ASTC on such a device: a family without a kept chain would open no block lane and save
 * nothing. `'none'` keeps RGBA8 — the "before" of a measurement. The reason names what settled it.
 */
export function chooseBlockFormat(
  features: { has(name: GPUFeatureName): boolean },
  previews: readonly Pick<TexturePreview, 'layouts'>[],
  wanted: TextureCompression = 'auto',
): BlockChoice {
  if (wanted === 'none') return { block: undefined, reason: 'host asked for rgba8' };
  const candidates = wanted === 'auto' ? PREVIEW_BLOCK_FORMATS : [wanted];
  const sampled = candidates.filter((block) => features.has(BLOCK_FEATURES[block]));
  if (!sampled.length)
    return {
      block: undefined,
      reason: `device lacks ${candidates.map((block) => BLOCK_FEATURES[block]).join(' and ')}`,
    };
  const kept = (block: TextureBlockFormat) => {
    let count = 0;
    for (const preview of previews) if (preview.layouts[block] !== 'lossless') count++;
    return count;
  };
  for (const block of sampled) {
    const chains = kept(block);
    if (chains > 0)
      return { block, reason: `device has ${BLOCK_FEATURES[block]}, ${chains} chains kept in it` };
  }
  return { block: undefined, reason: `the cache holds no chain kept in ${sampled.join(' or ')}` };
}

/** The lanes of an atlas, in the order the bindings and the shader's taps number them. */
export const POOL_LANES = PREVIEW_LAYOUT_NAMES;
export type PoolLane = TextureLayout;
/** One number per lane — layers, tiles —, and one per atlas. */
export type LaneCounts = Record<PoolLane, number>;
export type AtlasLanes = { color: LaneCounts; data: LaneCounts };
export const laneCounts = (): LaneCounts =>
  Object.fromEntries(POOL_LANES.map((lane) => [lane, 0])) as LaneCounts;

/** A tail as the sidecar carries it: RGBA8 levels, and the kept families' blocks. */
export type TailBytes = Pick<TexturePreview, 'levels' | 'blocks'>;

/** The GPU formats of a family's lanes, the data atlas's; the colour atlas decodes sRGB. */
const LANE_FORMATS: Record<TextureBlockFormat, Record<PoolLane, GPUTextureFormat>> = {
  bc7: { lossless: 'rgba8unorm', rgba: 'bc7-rgba-unorm', 'two-channel': 'bc5-rg-unorm' },
  astc: { lossless: 'rgba8unorm', rgba: 'astc-4x4-unorm', 'two-channel': 'astc-4x4-unorm' },
};

/**
 * Everything the pools, the catalogue and the streamer derive from one block choice: which lane
 * a chain takes, each lane's pool format (sRGB-decoded for colour, linear for data), the bytes a
 * texel costs there, the level file the reader asks for, and which of a tail's encodings is
 * pinned. One carrier, so that a lane is described here and nowhere else.
 */
export type PoolEncoding = {
  block: TextureBlockFormat | undefined;
  /** The family held, as the metrics publish it: `bc7`, `astc` or `rgba8`. */
  name: TextureBlockFormat | 'rgba8';
  laneOf(chain: Pick<TexturePreview, 'layouts'>): PoolLane;
  formatOf(kind: 'color' | 'data', lane: PoolLane): GPUTextureFormat;
  /** Four in RGBA8, one in either block lane (sixteen per 4×4 block). */
  texelBytes(lane: PoolLane): number;
  levelFormat(lane: PoolLane): ReturnType<typeof textureLevelFormat>;
  tailOf(tail: TailBytes, lane: PoolLane): readonly Uint8Array[];
  /** What the shader reads of a lane's texture (`../webgpu/tile/wgsl.ts`): 0 the raw pool, 1 the RGBA
   *  block pool, 2 the two-channel pool with Y in its second channel (BC5), 3 the same with Y in
   *  its alpha (the ASTC luminance-alpha block). */
  tapOf(lane: PoolLane): number;
  /** The lane the white fill texel prefers: a block lane when the session has one, so a scene
   *  whose every chain is kept opens no RGBA8 layer for a single texel. The catalogue keeps it
   *  in the lossless lane instead when that is the only one the textures open. */
  fillLane: PoolLane;
};

export function poolEncoding(block: TextureBlockFormat | undefined): PoolEncoding {
  const formats = block ? LANE_FORMATS[block] : undefined;
  return {
    block,
    name: block ?? 'rgba8',
    laneOf: (chain) => (block ? chain.layouts[block] : 'lossless'),
    formatOf(kind, lane) {
      const base = formats?.[lane] ?? 'rgba8unorm';
      return kind === 'color' && lane !== 'two-channel'
        ? (`${base}-srgb` as GPUTextureFormat)
        : base;
    },
    texelBytes: (lane) => (lane === 'lossless' || !block ? 4 : 1),
    levelFormat: (lane) => textureLevelFormat(block, lane),
    tailOf: (tail, lane) => (lane === 'lossless' || !block ? tail.levels : tail.blocks[block]),
    tapOf: (lane) => (lane === 'two-channel' && block === 'astc' ? 3 : POOL_LANES.indexOf(lane)),
    fillLane: block ? 'rgba' : 'lossless',
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

import {
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_HDR,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_HALF_FILE,
  PREVIEW_LAYOUT_NAMES,
  PREVIEW_STORED_FORMAT,
  type StoredLayout,
  type TextureBlockFormat,
  type TextureLayout,
} from '../../../../sdk-core/src/texture/previewFormat.ts'
import { textureLevelFormat } from '../../../../sdk-core/src/texture/levelUrl.ts'
import type { TexturePreview } from '../../../../sdk-core/src/texture/previewContracts.ts'
import { formatTexelCost } from '../../gpu/core/textureBytes.ts'
import { BLOCK_FEATURES, gpuCapsOfFeatures } from '../../gpu/core/gpuCaps.ts'
import type { TexelKind } from './floatTexels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { poolTail, WHITE_BC4 } from './poolTail.ts'

/**
 * Which block family a session's pools take, and everything that follows from it.
 *
 * The cache stores every chain in BC (`PREVIEW_STORED_FORMAT`) and bakes it in the other families
 * the cook asked for — every one by default — only where a quality gate kept it; the device says
 * which family it samples — desktop cards BC, mobile ones ASTC or ETC2, some several, a software
 * adapter none. An atlas then has one pool per LANE, the layouts the sidecar names: `lossless`
 * (RGBA8, four bytes a texel — what a chain the session's family does not hold reads, its BC files
 * decoded (`blockDecode.ts`), and what a host image reads), `rgba` (BC7, ASTC or ETC2 RGBA8, one
 * byte a texel), `two-channel` (BC5, ASTC luminance-alpha or EAC RG11, one byte a texel, the
 * normal map's X and Y with Z rebuilt by the shader). The data atlas's third pool is the CHANNEL
 * pool: BC5 for normal maps, or — where the atlas holds none — the one-channel maps' (`alpha`,
 * `grayscale`, `displacementmap`): BC4, half a byte a texel, where every chain of the pool is BC4 and
 * the device samples BC; else R8, one byte a texel, the BC4 blocks decoded (`channelPoolOf`). Nothing is lost by the engine: a texture
 * takes the lane its chain was kept in, and the choice is published (`texturePoolFormat`).
 */
export type TextureCompression = 'auto' | TextureBlockFormat | 'none'

/** The WebGPU feature that unlocks each family (`../../gpu/core/gpuCaps.ts`). */
export { BLOCK_FEATURES }

/** What a session decided, and why — what the diagnostic publishes. */
export type BlockChoice = { block: TextureBlockFormat | undefined; reason: string }

/**
 * The family the session samples: among those the host allows, the first the device has AND
 * some chain of the cache was kept in — every chain is in the stored family, BC. `'auto'` tries
 * BC, then ASTC, then ETC2 — a device with BC is a desktop one, and BC is the family its drivers
 * optimise; ASTC 4×4 holds more of a chain than ETC2 at the same byte a texel —; a gated family
 * without a kept chain would open no block lane and save nothing. `'none'` keeps
 * RGBA8 — the "before" of a measurement. The reason names what settled it.
 */
export function chooseBlockFormat(
  features: { has(name: string): boolean },
  previews: readonly Pick<TexturePreview, 'layouts'>[],
  wanted: TextureCompression = 'auto',
): BlockChoice {
  if (wanted === 'none') return { block: undefined, reason: 'host asked for rgba8' }
  const candidates = wanted === 'auto' ? PREVIEW_BLOCK_FORMATS : [wanted]
  const { blockFormats } = gpuCapsOfFeatures(features)
  const sampled = candidates.filter((block) => blockFormats[block])
  if (!sampled.length)
    return {
      block: undefined,
      reason: `device lacks ${candidates.map((block) => BLOCK_FEATURES[block]).join(' and ')}`,
    }
  const kept = (block: TextureBlockFormat) => {
    let count = 0
    for (const preview of previews) if (preview.layouts[block] !== 'lossless') count++
    return count
  }
  for (const block of sampled) {
    if (block === PREVIEW_STORED_FORMAT)
      return { block, reason: `device has ${BLOCK_FEATURES[block]}, every chain stored in it` }
    const chains = kept(block)
    if (chains > 0)
      return { block, reason: `device has ${BLOCK_FEATURES[block]}, ${chains} chains kept in it` }
  }
  return { block: undefined, reason: `the cache holds no chain kept in ${sampled.join(' or ')}` }
}

/** The pools an atlas can open: what a family holds of a chain (`TextureLayout`), and half-float RGBA
 *  — `hdr`, the textures a file stores in floating point (`rgba16float`, no block family). An atlas
 *  binds as many pools as there are layouts, so the sampled textures of a stage stay within WebGPU's
 *  guaranteed sixteen (`maxSampledTexturesPerShaderStage`): the colour atlas, which holds no normal
 *  map, binds its half-float pool where the data atlas binds its two-channel one (`atlasLanes`). */
export const POOL_LANES = [...PREVIEW_LAYOUT_NAMES, 'hdr'] as const
export type PoolLane = (typeof POOL_LANES)[number]
const DATA_LANES: readonly PoolLane[] = PREVIEW_LAYOUT_NAMES
const COLOR_LANES: readonly PoolLane[] = ['lossless', 'rgba', 'hdr']
/** The lanes of an atlas, in the order of its bindings. */
export const atlasLanes = (kind: 'color' | 'data') => (kind === 'color' ? COLOR_LANES : DATA_LANES)
/** One number per lane — layers, tiles —, and one per atlas.
 *  @property lossless - Kept as plain pixels. @property rgba - In colour blocks.
 *  @property two-channel - In two-channel blocks, for normal maps. @property hdr - In half-float
 *  texels, for the textures a file stores in floating point. */
export type LaneCounts = Record<PoolLane, number>
/** The lane counts of both atlases: colour and data. */
export type AtlasLanes = {
  /** The colour atlas. */
  color: LaneCounts
  /** The data atlas. */
  data: LaneCounts
}
export const laneCounts = (): LaneCounts =>
  Object.fromEntries(POOL_LANES.map((lane) => [lane, 0])) as LaneCounts

/** A tail as the sidecar carries it: RGBA8 levels, and the kept families' blocks. */
export type TailBytes = Pick<TexturePreview, 'levels' | 'blocks'>
/** What each family holds of a chain, the stored family's layout among them, and the atlas whose
 *  chain it is. */
export type ChainLayouts = Pick<TexturePreview, 'layouts' | 'atlas'>

/** The GPU formats of a family's lanes, the data atlas's; the colour atlas decodes sRGB. */
const LANE_FORMATS: Record<TextureBlockFormat, Record<TextureLayout, GPUTextureFormat>> = {
  bc7: { lossless: 'rgba8unorm', rgba: 'bc7-rgba-unorm', 'two-channel': 'bc5-rg-unorm' },
  astc: { lossless: 'rgba8unorm', rgba: 'astc-4x4-unorm', 'two-channel': 'astc-4x4-unorm' },
  etc2: { lossless: 'rgba8unorm', rgba: 'etc2-rgba8unorm', 'two-channel': 'eac-rg11unorm' },
}

/**
 * Everything the pools, the catalogue and the streamer derive from one block choice: which lane
 * a chain takes, each lane's pool format (sRGB-decoded for colour, linear for data), the bytes a
 * texel costs there, the level file the reader asks for — the lossless lane's the stored family's,
 * decoded —, and which of a tail's encodings is pinned. One carrier, so that a lane is described here and nowhere else.
 */
export type PoolEncoding = {
  block: TextureBlockFormat | undefined
  /** The family held, as the metrics publish it: `bc7`, `astc`, `etc2` or `rgba8`. */
  name: TextureBlockFormat | 'rgba8'
  laneOf(chain: ChainLayouts): PoolLane
  /** Whether the half-float lane's pool is BC6H blocks: the device samples BC and every half-float
   *  chain of the scene is stored in them (`hdrBlocksOf`); else half-float texels, a BC6H chain decoded. */
  hdrBlocks: boolean
  /** Whether the half-float lane's pool holds 32-bit floats (`rgba32float`): a chain is kept as
   *  such (`float32`) and the device filters them (`float32-filterable`); else half-floats. */
  hdr32: boolean
  /** What the data atlas's channel pool (`two-channel`) holds: BC5 normal maps (`two`), the
   *  one-channel maps' BC4 blocks (`bc4`) or their R8 texels (`r8`) (`channelPoolOf`). */
  channelPool: ChannelPool
  formatOf(kind: 'color' | 'data', lane: PoolLane): GPUTextureFormat
  /** Four in RGBA8, one in either RGBA or two-channel block lane (sixteen per 4×4 block), a half in
   *  BC4, one in R8, eight in half-float. */
  texelBytes(lane: PoolLane): number
  /** The level file a lane reads of `chain`: the family's blocks in a block lane, the stored
   *  family's in the lossless one, which decodes them to RGBA8, the half-float texels in the
   *  half-float one. */
  levelFormat(lane: PoolLane, chain: ChainLayouts): ReturnType<typeof textureLevelFormat>
  tailOf(
    tail: TailBytes & Partial<ChainLayouts>,
    lane: PoolLane,
    /** The texture's size and first carried level: a float tail is unpacked level by level. */
    geometry: { width: number; height: number; tail: number },
  ): readonly Uint8Array[]
  /** The kind of texel the lane's pool holds when it is made of texels rather than blocks or RGBA8:
   *  the half-float lane's (`rgba16`, or `rgba32` with `hdr32`), the channel pool's (`r8`, `r16`,
   *  `r32`); none else. */
  texelsOf(lane: PoolLane): TexelKind | undefined
  /** What the shader reads of a lane's texture (`../virtual/wgsl.ts`): 0 the raw pool, 1 the RGBA
   *  block pool, 2 the two-channel pool with Y in its second channel (BC5, EAC RG11), 3 the same
   *  with Y in its alpha (the ASTC luminance-alpha block), 4 the half-float pool, then the
   *  channel pool of one-channel maps read as 5 the channel in R (BC4, the `alpha` setting), 6 the
   *  channel in RGB, opaque (`gray`), 7 the channel in all four (`displacement`); `layout` names a
   *  one-channel chain's. The white fill takes 6. */
  tapOf(lane: PoolLane, layout?: StoredLayout): number
  /** The lane the white fill texel prefers: a block lane when the session has one, so a scene
   *  whose every chain is kept opens no RGBA8 layer for a single texel. The catalogue keeps it
   *  in the lossless lane instead when that is the only one the textures open. */
  fillLane: PoolLane
  /** The white fill texel in `lane`'s own encoding, for `tailOf` to pin: RGBA8 and colour blocks,
   *  the two-channel block, half-float ones. */
  whiteOf(lane: PoolLane): TailBytes
}

/** The tap of a half-float pool (`tapOf`): its texels read as they are, from the third binding of the
 *  colour atlas (`../virtual/kindWgsl.ts`). */
const HDR_TAP = 4

/** Whether the half-float pool of a session sampling `block` can be BC6H: the device has BC, and
 *  every half-float chain is stored in it. One chain left in half-floats keeps the pool in them. */
export function hdrBlocksOf(
  block: TextureBlockFormat | undefined,
  previews: readonly Pick<TexturePreview, 'layouts' | 'atlas'>[],
) {
  if (block !== PREVIEW_STORED_FORMAT) return false
  const halves = previews.filter((preview) => preview.atlas === PREVIEW_ATLAS_HDR)
  return halves.length > 0 && halves.every((p) => p.layouts[PREVIEW_STORED_FORMAT] === 'hdr')
}

/** The channel pool's tap (`tapOf`) of each one-channel layout: the BC4 channel in R, a grey, a
 *  displacement. */
const ONE_CHANNEL_TAPS: Partial<Record<StoredLayout, number>> = {
  'one-channel': 5,
  gray: 6,
  displacement: 7,
  'single-float': 5,
  'half-single': 5,
}

/** What the data atlas's channel pool holds: BC5 normal maps (`two`), the one-channel maps' BC4
 *  blocks (`bc4`) or eight-bit texels (`r8`), or their floats at 16 or 32 bits (`r16`, `r32`). */
export type ChannelPool = 'two' | 'bc4' | 'r8' | 'r16' | 'r32'

/** The layouts that keep a float chain's texels exactly: the half-float atlas's four 32-bit channels
 *  and the data atlas's one channel at 32 or 16 bits. They live in the stored family whatever the
 *  family the device samples. */
const FLOAT_LAYOUTS: readonly StoredLayout[] = ['float32', 'single-float', 'half-single']

/** Whether the half-float lane's pool of a session is 32-bit floats: some half-float chain is kept
 *  so (`float32`) and the device has `float32-filterable`. */
export function hdr32Of(
  previews: readonly Pick<TexturePreview, 'layouts' | 'atlas'>[],
  filterable: boolean,
) {
  return (
    filterable &&
    previews.some(
      (p) => p.atlas === PREVIEW_ATLAS_HDR && p.layouts[PREVIEW_STORED_FORMAT] === 'float32',
    )
  )
}

/** What the channel pool of a session sampling `block` holds: BC5 normal maps where the data atlas
 *  has any chain in two channels, or no chain of one channel; else the one-channel maps — floats at
 *  32 bits where the device filters them and a chain is kept so, else 16; BC4 blocks where the
 *  device has BC and every such chain is BC4, else R8 texels, which an eight-bit chain (`gray`,
 *  `displacement`) keeps. A one-channel chain with BC5 beside it is read from the lossless pool,
 *  decoded to RGBA8, as a colour map's is (a colour needs its curve, which no one-channel format
 *  has; a float is cut to eight bits). */
export function channelPoolOf(
  block: TextureBlockFormat | undefined,
  previews: readonly Pick<TexturePreview, 'layouts' | 'atlas'>[],
  filterable = false,
): ChannelPool {
  const data = previews.filter((preview) => preview.atlas === PREVIEW_ATLAS_DATA)
  const stored = (preview: Pick<TexturePreview, 'layouts'>) =>
    preview.layouts[PREVIEW_STORED_FORMAT]
  const bytes = block === PREVIEW_STORED_FORMAT
  const ones = data.filter(
    (preview) =>
      FLOAT_LAYOUTS.includes(stored(preview)) ||
      (bytes && ONE_CHANNEL_TAPS[stored(preview)] !== undefined),
  )
  const normals = data.some((preview) => block && preview.layouts[block] === 'two-channel')
  if (!ones.length || normals) return 'two'
  if (ones.some((preview) => FLOAT_LAYOUTS.includes(stored(preview))))
    return filterable && ones.some((preview) => stored(preview) === 'single-float') ? 'r32' : 'r16'
  return ones.every((preview) => stored(preview) === 'one-channel') ? 'bc4' : 'r8'
}

/** The lane of a layout a family holds: a one-channel layout takes the channel pool where the data
 *  atlas's holds the one-channel maps (`channelPoolOf`), else the lossless lane. */
const laneOfLayout = (layout: StoredLayout, data: boolean, channelPool: ChannelPool): PoolLane =>
  ONE_CHANNEL_TAPS[layout] === undefined
    ? (layout as PoolLane)
    : data && channelPool !== 'two'
      ? 'two-channel'
      : 'lossless'

/** What a pool encoding is built from: the sampled family and the three pool decisions. */
export type PoolSettings = {
  block: TextureBlockFormat | undefined
  hdrBlocks: boolean
  channelPool: ChannelPool
  hdr32: boolean
}

/** The layout a chain is read as: a float chain's, kept in the stored family whatever the family
 *  the device samples, else the family's own. */
const layoutOf = (block: TextureBlockFormat | undefined, layouts: ChainLayouts['layouts']) =>
  FLOAT_LAYOUTS.includes(layouts[PREVIEW_STORED_FORMAT])
    ? layouts[PREVIEW_STORED_FORMAT]
    : block
      ? layouts[block]
      : 'lossless'

/** The lane a chain takes. */
function chainLane({ block, channelPool }: PoolSettings, chain: ChainLayouts): PoolLane {
  return chain.atlas === PREVIEW_ATLAS_HDR
    ? 'hdr'
    : laneOfLayout(layoutOf(block, chain.layouts), chain.atlas === PREVIEW_ATLAS_DATA, channelPool)
}

/** The GPU format of a lane's pool in an atlas of `kind`. */
function laneFormat(
  { block, hdrBlocks, channelPool, hdr32 }: PoolSettings,
  kind: 'color' | 'data',
  lane: PoolLane,
): GPUTextureFormat {
  if (lane === 'hdr') return hdr32 ? 'rgba32float' : hdrBlocks ? 'bc6h-rgb-ufloat' : HDR_FORMAT
  if (lane === 'two-channel' && channelPool !== 'two')
    return CHANNEL_FORMATS[channelPool as Exclude<ChannelPool, 'two'>]
  const base = (block ? LANE_FORMATS[block][lane] : undefined) ?? 'rgba8unorm'
  return kind === 'color' && lane !== 'two-channel' ? (`${base}-srgb` as GPUTextureFormat) : base
}

/** The texel kind a float pool holds. */
function laneTexels(
  { hdrBlocks, hdr32, channelPool }: PoolSettings,
  lane: PoolLane,
): TexelKind | undefined {
  return lane === 'hdr' && !hdrBlocks
    ? hdr32
      ? 'rgba32'
      : 'rgba16'
    : lane === 'two-channel' &&
        (channelPool === 'r8' || channelPool === 'r16' || channelPool === 'r32')
      ? channelPool
      : undefined
}

/** The level file a lane reads of a chain. A half-float chain stored in BC6H or kept in 32-bit
 *  floats has those files alone; any other, its half-float ones. */
function laneLevelFormat(
  { block, channelPool }: PoolSettings,
  lane: PoolLane,
  { layouts }: ChainLayouts,
) {
  const stored = PREVIEW_STORED_FORMAT
  return lane === 'hdr'
    ? layouts[stored] === 'hdr' || layouts[stored] === 'float32'
      ? textureLevelFormat(stored, layouts[stored])
      : PREVIEW_HALF_FILE
    : lane === 'lossless' || !block || (lane === 'two-channel' && channelPool !== 'two')
      ? textureLevelFormat(stored, layouts[stored])
      : textureLevelFormat(block, lane)
}

/** What the shader reads of a lane's texture. */
function laneTap(
  { block, channelPool }: PoolSettings,
  lane: PoolLane,
  layout?: StoredLayout,
): number {
  return lane === 'hdr'
    ? HDR_TAP
    : lane === 'two-channel' && channelPool !== 'two'
      ? (ONE_CHANNEL_TAPS[layout ?? 'gray'] ?? 6)
      : lane === 'two-channel' && block === 'astc'
        ? 3
        : PREVIEW_LAYOUT_NAMES.indexOf(lane)
}

export function poolEncoding(
  block: TextureBlockFormat | undefined,
  hdrBlocks = false,
  channelPool: ChannelPool = 'two',
  hdr32 = false,
): PoolEncoding {
  const settings: PoolSettings = { block, hdrBlocks, channelPool, hdr32 }
  const formatOf: PoolEncoding['formatOf'] = (kind, lane) => laneFormat(settings, kind, lane)
  return {
    block,
    name: block ?? 'rgba8',
    laneOf: (chain) => chainLane(settings, chain),
    hdrBlocks,
    hdr32,
    channelPool,
    formatOf,
    texelsOf: (lane) => laneTexels(settings, lane),
    texelBytes: (lane) => formatTexelCost(formatOf('data', lane)),
    levelFormat: (lane, chain) => laneLevelFormat(settings, lane, chain),
    tailOf: (tail, lane, geometry) => poolTail(settings, tail, lane, geometry),
    tapOf: (lane, layout) => laneTap(settings, lane, layout),
    fillLane: block ? 'rgba' : 'lossless',
    whiteOf: (lane) => whiteTail(lane),
  }
}

/** The GPU format of the channel pool for each thing it holds besides BC5. */
const CHANNEL_FORMATS: Record<Exclude<ChannelPool, 'two'>, GPUTextureFormat> = {
  bc4: 'bc4-r-unorm',
  r8: 'r8unorm',
  r16: 'r16float',
  r32: 'r32float',
}

/**
 * One opaque-white texel in every encoding — what slot 0 of a pool pins, the texel a material
 * without a map reads. BC7: mode 6, every endpoint at its maximum; ASTC: a void-extent block of
 * 16-bit ones; ETC2 RGBA8: an EAC alpha at 255, then an individual-mode colour at 15 on every
 * channel. Proved on an independent decoder in
 * `packages/asset-compiler-rust/src/texture/blocks/tests.rs` and `tests/etc2.rs`.
 */
const WHITE_TAIL: TailBytes = {
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
    etc2: [
      new Uint8Array([
        0xff, 0x1d, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0, 0, 0, 0,
      ]) as Uint8Array<ArrayBuffer>,
    ],
  },
}

const bytes = (values: readonly number[]) => new Uint8Array(values) as Uint8Array<ArrayBuffer>
const WHITE_EAC_BLOCK = [0xff, 0x1d, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
/** BC6H, mode 3 (ten-bit endpoints, one region): every endpoint 495, which unquantises to half 1.0,
 *  every index 0. */
const WHITE_BC6H = bytes([227, 189, 247, 222, 123, 239, 189, 247, 0, 0, 0, 0, 0, 0, 0, 0])

/** The white texel of the two-channel lane: BC5 (two BC4 blocks), the ASTC block of ones, EAC RG11.
 *  The channel pool's texels (`r8` …) are read from the RGBA8 levels, as `WHITE_TAIL`'s. */
const WHITE_TWO_CHANNEL: TailBytes = {
  levels: WHITE_TAIL.levels,
  blocks: {
    bc7: [bytes([...WHITE_BC4, ...WHITE_BC4])],
    astc: WHITE_TAIL.blocks.astc,
    etc2: [bytes([...WHITE_EAC_BLOCK, ...WHITE_EAC_BLOCK])],
  },
}

/** The white texel of the half-float lane: half-float ones, or the BC6H block where the pool is blocks. */
const WHITE_HDR: TailBytes = {
  levels: [bytes([0x00, 0x3c, 0x00, 0x3c, 0x00, 0x3c, 0x00, 0x3c])],
  blocks: { bc7: [WHITE_BC6H], astc: [WHITE_BC6H], etc2: [WHITE_BC6H] },
}

/** The white fill texel in the encoding `lane`'s pool pins (`PoolEncoding.whiteOf`). */
const whiteTail = (lane: PoolLane) =>
  lane === 'hdr' ? WHITE_HDR : lane === 'two-channel' ? WHITE_TWO_CHANNEL : WHITE_TAIL

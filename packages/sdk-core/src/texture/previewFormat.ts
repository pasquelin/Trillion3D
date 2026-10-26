/**
 * The progressive texture levels section of the binary sidecar — the entry words, the atlases,
 * the block families and their layouts —, beside `../manifest/binaryFormat.ts`, which owns the
 * columns.
 */
/** `texturePreviewU32` slots. */
export const PREVIEW_TEXTURE = 0,
  PREVIEW_IMAGE = 1,
  PREVIEW_WIDTH = 2,
  PREVIEW_HEIGHT = 3,
  PREVIEW_SOURCE_KIND = 4,
  PREVIEW_SOURCE_VIEW = 5,
  PREVIEW_FIRST_LEVEL = 6,
  PREVIEW_LEVEL_COUNT = 7,
  PREVIEW_PIXEL_OFFSET = 8,
  PREVIEW_PIXEL_BYTES = 9,
  PREVIEW_ATLAS = 10,
  PREVIEW_BAKED_LEVELS = 11,
  /** One layout word per block family, `PREVIEW_BLOCK_FORMATS` order. */
  PREVIEW_LAYOUTS = 12
export const PREVIEW_WORDS = 15
/** A preview whose bytes came from an image `uri`; anything else names a glTF buffer view. */
export const PREVIEW_SOURCE_URI = 0
/** The atlas a preview serves: colour (`rgba8unorm-srgb`, base colour and emissive), data
 *  (`rgba8unorm`, metal-roughness, normal, occlusion) or half-float (`rgba16float`, the base colour
 *  and emissive map of a texture a file stores in floating point). The same texture may have one
 *  colour and one data entry; a half-float one is its only entry. */
export const PREVIEW_ATLAS_COLOR = 0,
  /** The data atlas: metal-roughness, normal and occlusion maps. */
  PREVIEW_ATLAS_DATA = 1,
  /** The half-float atlas, sampled in the colour atlas's binding: its tail is half-float RGBA and no
   *  block family holds it (`texture/hdr.rs`). */
  PREVIEW_ATLAS_HDR = 2
/** The `{kind}` a baked level's path carries for each atlas, as `reduce.rs` names them. */
export const PREVIEW_ATLAS_NAMES = ['srgb', 'linear', 'hdr'] as const
/** The `{kind}` of an atlas word, `undefined` for a word no compiler writes. */
export function previewAtlasName(atlas: number): string | undefined {
  return Number.isInteger(atlas) ? PREVIEW_ATLAS_NAMES[atlas] : undefined
}
/** The atlas an entry's chain is sampled in: a half-float chain is the colour atlas's. */
export const previewAtlasOf = (atlas: number) =>
  atlas === PREVIEW_ATLAS_HDR ? PREVIEW_ATLAS_COLOR : atlas
/** Bytes of one half-float texel: four 16-bit channels. */
export const PREVIEW_HALF_TEXEL_BYTES = 8
/** Bytes of one texel of a chain's tail and of its level files' records: four 8-bit channels, or
 *  four half-floats in the half-float atlas. */
export const previewTexelBytes = (atlas: number) =>
  atlas === PREVIEW_ATLAS_HDR ? PREVIEW_HALF_TEXEL_BYTES : 4
/** The `{format}` of a half-float atlas's level files (`texture/hdr.rs`, `HALF_FILE`). */
export const PREVIEW_HALF_FILE = 'rgba16f'
/** The block families a chain may be baked in, in the order of their sidecar columns and of an
 *  entry's layout words, each named by its RGBA codec: BC for desktop cards, ASTC 4×4 and ETC2 for
 *  mobile ones. */
export const PREVIEW_BLOCK_FORMATS = ['bc7', 'astc', 'etc2'] as const
/** A block family a texture can be baked in. */
export type TextureBlockFormat = (typeof PREVIEW_BLOCK_FORMATS)[number]
/** The family every chain is stored in (`BlockFormat::STORED`): its level files exist for every
 *  baked chain, and a device that samples none of the families reads them decoded to RGBA8. */
export const PREVIEW_STORED_FORMAT: TextureBlockFormat = 'bc7'
/** What a family holds of a chain, by layout word: nothing — `lossless`, the chain is not in that
 *  family and its pool is RGBA8 —, RGBA blocks (BC7, ASTC colour endpoint mode 12, ETC2 RGBA8), or
 *  two-channel blocks for a normal map (BC5, ASTC luminance + alpha on two planes, EAC RG11: X in
 *  R, Y in G or A, Z rebuilt by the shader). */
export const PREVIEW_LAYOUT_NAMES = ['lossless', 'rgba', 'two-channel'] as const
/** What a block family holds of a texture: nothing, colour blocks, or two-channel blocks. */
export type TextureLayout = (typeof PREVIEW_LAYOUT_NAMES)[number]
/**
 * What a sidecar's layout word can name, by word: the lane layouts, then those a texture's
 * compression setting adds (`texture/setting.rs`) — `hdr`, a half-float chain in BC6H blocks,
 * `one-channel`, one channel in BC4 blocks of eight bytes, `float32`, `single-float` and `half-single`, the
 * floats of a chain kept as they are (`rgba32f`, `r32f` and `r16f` files), `gray`, one channel kept to the bit in
 * eight-bit texels (`g8`, read as grey), and `displacement`, the same from the alpha channel
 * (`a8`, read in all four channels) — all of the stored family alone. A chain in any takes the
 * lane its pool is read from (`TextureLane`).
 */
export const PREVIEW_STORED_LAYOUTS = [
  'lossless',
  'rgba',
  'two-channel',
  'hdr',
  'one-channel',
  'gray',
  'displacement',
  'float32',
  'single-float',
  'half-single',
] as const
/** What a family holds of a chain. */
export type StoredLayout = (typeof PREVIEW_STORED_LAYOUTS)[number]
/** The `{format}` of a level file in each family and block layout, as `blocks.rs` names them. */
export const PREVIEW_LAYOUT_FILES = {
  bc7: {
    rgba: 'bc7',
    'two-channel': 'bc5',
    hdr: 'bc6h',
    'one-channel': 'bc4',
    gray: 'g8',
    displacement: 'a8',
    float32: 'rgba32f',
    'single-float': 'r32f',
    'half-single': 'r16f',
  },
  astc: { rgba: 'astc', 'two-channel': 'astc-la' },
  etc2: { rgba: 'etc2', 'two-channel': 'eac-rg' },
} as const satisfies Record<
  TextureBlockFormat,
  Partial<Record<Exclude<StoredLayout, 'lossless'>, string>>
>
/** Bytes of one block of a layout: BC4's eight, sixteen for every other (`gray` and `displacement`
 *  hold the eight-bit texels of a 4 × 4 square, row by row). */
export const previewLayoutBlockBytes = (layout: StoredLayout) =>
  BLOCK_BYTES_OF[layout] ?? PREVIEW_BLOCK_BYTES
/** Bytes of one block of the layouts that are not sixteen: BC4's eight, and the float layouts', the
 *  sixteen texels of a 4 × 4 square at four 32-bit floats, one, or one half-float. */
const BLOCK_BYTES_OF: Partial<Record<StoredLayout, number>> = {
  'one-channel': 8,
  float32: 256,
  'single-float': 64,
  'half-single': 32,
}
/** Texels along a block's side, and bytes of one block, in every format. */
export const PREVIEW_BLOCK_SIDE = 4
/** Bytes of one block. */
export const PREVIEW_BLOCK_BYTES = 16

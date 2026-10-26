import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * WHAT THE SURFACE CACHE'S PASSES AND READERS AGREE ON: the formats of its textures, the words of
 * the tables a read walks and of the lists a capture is made from. Each is written here once, and
 * the shaders (`sampleWgsl.ts`, `copyWgsl.ts`) and their hosts (`tables.ts`, `copy.ts`) name them.
 *
 * THE ATLAS. The pages of the cards' captured surface, one texel of each layer a texel of the atlas:
 * the depth (`depth`) as the sixteen-bit word of the reference's 16-bit target, 1.0 — 65535 — for a
 * texel with no surface; the albedo (`albedo`), the square root of the diffuse colour, and the
 * normal (`normal`), the card-space direction's first two components as `x · 0.5 + 0.5`, both 8
 * bits a channel (the capture atlas's normal holds the validity of the texel in its fourth); the
 * emission (`emissive`) and the three lightings — direct, indirect, final — as the 11-11-10 word of
 * a light (`packLight`). The layers are words and 8-bit channels, one kernel text for every device: a device
 * that grants `texture-formats-tier1` could hold the lights as `rg11b10ufloat` (the same four bytes), the
 * depth as `r16unorm` and the normal as `rg8unorm` (64 MiB less at 4096), each a second variant of every kernel
 * that touches a layer, to be taken where measured. `frames` is one word for each tile of 8 × 8 texels, for the
 * radiosity's accumulation.
 *
 * THE COMPRESSED ATLAS (`surfaceCacheCompress` 2, where the device has `texture-compression-bc`). The
 * albedo, the normal and the emission are kept as blocks of 4 × 4 texels, in BC7, BC5 and BC6H
 * (`BLOCK_FORMATS`); the depth and the lights are not. A block-compressed texture is no storage
 * texture, so the capture's encoders write the blocks of the pages of an image into a staging
 * buffer (`stagingOf`), one square of blocks the size of the capture atlas for each layer, and a
 * copy of each page's rectangle puts them in the atlas. A read of the layers is the same load: the
 * hardware decodes; the emission is then a float texture where it was a word of light.
 *
 * THE CAPTURE ATLAS. Where the pages being captured in an image are drawn, a smaller square of
 * the same pages: the visibility of the raster (`ids`, the identifier of the nearest triangle of each
 * texel, 0 where none) and its depth (`depth`, the engine's reversed depth: 1 at the card's outer
 * face, 0 at its inner one), which the raster of the card views writes; then the albedo, normal and
 * emission the surfaces' shading makes of them, the same encodings as the atlas's; and the light the
 * pages held before the image, resampled into their new texels (`direct`, `indirect`, and `frames`, a word
 * for each tile), which the copy of the light puts in the atlas.
 */

/** The formats of the atlas's layers. */
const ATLAS_FORMATS = {
  depth: 'r32uint',
  albedo: 'rgba8unorm',
  normal: 'rgba8unorm',
  emissive: 'r32uint',
  direct: 'r32uint',
  indirect: 'r32uint',
  final: 'r32uint',
  frames: 'r32uint',
} as const satisfies Record<string, GPUTextureFormat>

/** The formats of the layers that compression changes: the albedo is kept in BC7, the normal in BC5
 *  (two channels) and the emission in BC6H (unsigned floats). */
export const BLOCK_FORMATS = {
  albedo: 'bc7-rgba-unorm',
  normal: 'bc5-rg-unorm',
  emissive: 'bc6h-rgb-ufloat',
} as const satisfies Partial<Record<keyof typeof ATLAS_FORMATS, GPUTextureFormat>>

/** The layers kept in blocks, in the order of their sections of the staging buffer. */
export const BLOCK_LAYERS = [
  'albedo',
  'normal',
  'emissive',
] as const satisfies readonly (keyof typeof BLOCK_FORMATS)[]

/** The formats of the atlas's layers, `compressed` or not. */
export const atlasFormats = (compressed: boolean) =>
  compressed ? { ...ATLAS_FORMATS, ...BLOCK_FORMATS } : ATLAS_FORMATS

/** The texels along a side of a block and the bytes of one, the same in the three formats. */
export const BLOCK = { texels: 4, bytes: 16 } as const

/**
 * The staging buffer of the blocks the encoders write for a capture atlas of `captureSide` texels: one
 * section for each layer (`BLOCK_LAYERS`), each a square of `across` × `across` blocks laid as the capture
 * atlas is, in rows of `rowBytes` — a multiple of 256, which a copy from a buffer asks of a row —, so
 * that the blocks of a page's rectangle are a rectangle of the section.
 */
export function stagingOf(captureSide: number) {
  const across = captureSide / BLOCK.texels
  const rowBytes = across * BLOCK.bytes
  const layerBytes = across * rowBytes
  return { across, rowBytes, layerBytes, bytes: layerBytes * BLOCK_LAYERS.length }
}

/** The formats of the capture atlas's layers. */
export const CAPTURE_FORMATS = {
  ids: 'r32uint',
  depth: 'r32float',
  albedo: 'rgba8unorm',
  normal: 'rgba8unorm',
  emissive: 'r32uint',
  direct: 'r32uint',
  indirect: 'r32uint',
  frames: 'r32uint',
} as const satisfies Record<string, GPUTextureFormat>

/** The texels of a tile of the atlas: what the lighting's work and the capture's lists are cut in. */
export const TILE = 8

/** The depth word of a texel with no surface: 1.0 of a sixteen-bit depth. */
export const INVALID_DEPTH_WORD = 0xffff

/** The words the tables' header holds, and the places in it. */
export const TABLE_HEADER_WORDS = 16
export const TABLE_AT = {
  /** The cards, mesh cards and pages the tables name: one past the last index of each. */
  cards: 0,
  meshCards: 1,
  pages: 2,
  placements: 3,
  /** The atlas's side in texels, and one over it (a float). */
  atlasSide: 4,
  invAtlasSide: 5,
  /** The first word of each section. */
  meshCardsAt: 8,
  cardsAt: 9,
  pageTableAt: 10,
  cardPagesAt: 11,
  placementsAt: 12,
  /** The update clock, and one over the pre-exposure the light is kept multiplied by (a float). */
  frame: 13,
  invPreExposure: 14,
  /** The boost of the diffuse colour (a float, 1 for none). */
  colorBoost: 15,
} as const

/** The word of a placement with no mesh cards. */
export const NO_MESH_CARDS = 0xffffffff

/** The page's entry in the list a capture's kernels read: its rectangle in the capture atlas, its
 *  place in the atlas and its card, its flags, the part of the card it covers (floats) and the card
 *  whose texels it takes. Four vectors of four words. */
export const PAGE_ENTRY_WORDS = 16
/** Bits of an entry's flags: a page that takes the texels of another card instead of being drawn, a
 *  copy that is read mirrored, a page whose texels dilate by one, a page whose card held pages before
 *  the image, whose light is resampled into the page (`CapturePage.resampleLighting`). */
export const PAGE_FLAGS = { copy: 1, flipped: 2, dilate: 4, resampleLighting: 8 } as const

/** The parameters of the capture's kernels: the sides, the pages and tiles the dispatch is over — the
 *  tiles listed from `tileBase` —, whether the pages' light is resampled (`resample`), whether the
 *  radiosity is on (`radiosity`), the number the light is kept multiplied by and the inverse sides. */
export const CAPTURE_PARAMS = fieldLayout('CaptureParams', [
  ['captureSide', 'u32'],
  ['atlasSide', 'u32'],
  ['pages', 'u32'],
  ['tiles', 'u32'],
  ['tileBase', 'u32'],
  ['resample', 'u32'],
  ['preExposure', 'f32'],
  ['invAtlasSide', 'f32'],
  ['invCaptureSide', 'f32'],
  ['radiosity', 'u32'],
  ['padB', 'f32'],
  ['padC', 'f32'],
] as const)

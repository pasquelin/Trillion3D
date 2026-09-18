/**
 * Binary sidecar for a cluster manifest.
 *
 * A cluster cache describes tens of thousands of clusters with a dozen numbers each. Written as
 * JSON that is tens of megabytes the browser has to tokenize before the first frame; written as
 * typed-array columns it is a single `fetch` and a handful of views. The small JSON that stays
 * beside it keeps everything a human or a tool reads — primitives, materials, the group structure
 * counts, the bundle catalogue — plus the pointer to the columns.
 *
 * Layout, little-endian:
 *
 *   u32 magic 'WGMB' · u32 version · u32 columnCount · u32 reserved
 *   columnCount × (u32 byteOffset, u32 byteLength)
 *   column payloads, each starting on an 8-byte boundary
 *
 * Columns are fixed by version: their order, element type and stride are the format. Reading one
 * is `new Float64Array(buffer, offset, length/8)`, so decoding costs no parse at all.
 */
/** Version 4 turns the fixed 16×16 preview entries into the variable progressive levels: the pixel
 *  column has no stride any more, each entry naming its own byte range. A file of another version is
 *  refused whole: a reader that sliced the wrong range would show one texture's levels on another.
 *  Version 5 widens a preview entry from ten to twelve words — the atlas it serves and how many
 *  levels are baked as files under `textures/` — and its pixels follow the graphics card's mip rule;
 *  a version-4 reader would stride through the entries wrongly, so it refuses this file. */
export const MANIFEST_BINARY_VERSION = 5;
/** 'W','G','M','B' read as a little-endian u32. */
export const MANIFEST_BINARY_MAGIC = 0x424d4757;
export const MANIFEST_BINARY_HEADER_WORDS = 4;

/** Progressive texture levels, mirrored by `packages/asset-compiler-rust/src/texture_preview.rs`:
 *  the tail of a source's mip chain in the sidecar, RGBA8 in the atlas's own encoding, from the
 *  finest level no side of which exceeds `PREVIEW_BASE` down to 1×1 — and, above it, one lossless
 *  PNG per level in the cache, `bakedLevels` of them from level 0 up. Every level follows the mip
 *  rule the card applied when it regenerated the chain itself (`textureMips.ts`): linear mean of
 *  the colours, median alpha, level `k` from the quantized level `k - 1`. Their sizes are not
 *  written down: they follow from the source dimensions, which `texturePreviewLevels.ts` recomputes. */
export const TEXTURE_PREVIEW_VERSION = 3;
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
  PREVIEW_BAKED_LEVELS = 11;
export const PREVIEW_WORDS = 12;
/** A preview whose bytes came from an image `uri`; anything else names a glTF buffer view. */
export const PREVIEW_SOURCE_URI = 0;
/** The atlas a preview serves: colour (`rgba8unorm-srgb`, base colour and emissive) or data
 *  (`rgba8unorm`, metal-roughness, normal, occlusion). The same texture may have one entry each. */
export const PREVIEW_ATLAS_COLOR = 0,
  PREVIEW_ATLAS_DATA = 1;
/** The `{kind}` a baked level's path carries for each atlas, as `bake.rs` names them. */
export const PREVIEW_ATLAS_NAMES = ['srgb', 'linear'] as const;

export const COLUMN_NAMES = [
  'pageBounds',
  'pageSphere',
  'pageParentSphere',
  'pageError',
  'pageInt',
  'pageU32',
  'pageSha',
  'geometrySha',
  'geometryU32',
  'cullingNodes',
  'groupLevel',
  'groupError',
  'groupSphere',
  'groupChildCount',
  'groupChild',
  'groupOutputCount',
  'groupOutput',
  'structureRoot',
  'bundleU32',
  'bundleSha',
  'pageDepthLayer',
  'texturePreviewU32',
  'texturePreviewSha',
  'texturePreviewPixels',
] as const;
export type ColumnName = (typeof COLUMN_NAMES)[number];
export type ColumnKind = 'f64' | 'i32' | 'u32' | 'u8';
export const COLUMN_KIND: Record<ColumnName, ColumnKind> = {
  pageBounds: 'f64',
  pageSphere: 'f64',
  pageParentSphere: 'f64',
  pageError: 'f64',
  pageInt: 'i32',
  pageU32: 'u32',
  pageSha: 'u8',
  geometrySha: 'u8',
  geometryU32: 'u32',
  cullingNodes: 'f64',
  groupLevel: 'i32',
  groupError: 'f64',
  groupSphere: 'f64',
  groupChildCount: 'i32',
  groupChild: 'i32',
  groupOutputCount: 'i32',
  groupOutput: 'i32',
  structureRoot: 'i32',
  bundleU32: 'u32',
  bundleSha: 'u8',
  pageDepthLayer: 'u32',
  texturePreviewU32: 'u32',
  texturePreviewSha: 'u8',
  texturePreviewPixels: 'u8',
};
/** Numbers per element. A sha is 64 ASCII hexadecimal characters: one `TextDecoder` for the whole
 *  column, then one `substring` per entry, is far cheaper than re-encoding 32 raw bytes each time. */
export const COLUMN_STRIDE: Record<ColumnName, number> = {
  pageBounds: 6,
  pageSphere: 4,
  pageParentSphere: 4,
  pageError: 2,
  pageInt: 8,
  pageU32: 2,
  pageSha: 64,
  geometrySha: 64,
  geometryU32: 5,
  cullingNodes: 15,
  groupLevel: 1,
  groupError: 1,
  groupSphere: 4,
  groupChildCount: 1,
  groupChild: 1,
  groupOutputCount: 1,
  groupOutput: 1,
  structureRoot: 1,
  bundleU32: 2,
  bundleSha: 64,
  pageDepthLayer: 1,
  texturePreviewU32: PREVIEW_WORDS,
  texturePreviewSha: 64,
  // Seule colonne sans pas fixe : son élément est l'octet, et son compte est le total que le petit
  // JSON déclare, chaque entrée nommant sa propre plage à l'intérieur.
  texturePreviewPixels: 1,
};
export const BYTES_PER_ELEMENT: Record<ColumnKind, number> = { f64: 8, i32: 4, u32: 4, u8: 1 };

/** `pageInt` slots. -1 is «absent or null»; the flag word says which. */
export const INT_ID = 0,
  INT_LEVEL = 1,
  INT_GROUP = 2,
  INT_SOURCE = 3,
  INT_STREAM = 4,
  INT_STREAM_OFFSET = 5,
  INT_COUNT = 6,
  INT_START = 7;
/** `pageU32` slots. */
export const U32_BYTES = 0,
  U32_FLAGS = 1;
export const FLAG_ROLE = 1,
  FLAG_COARSE = 2,
  FLAG_GEOMETRY = 4,
  FLAG_CLUSTER_ERROR = 8,
  FLAG_PARENT_ERROR = 16,
  FLAG_PARENT_ERROR_FINITE = 32,
  FLAG_PARENT_SPHERE = 64,
  FLAG_PARENT_SPHERE_SET = 128,
  FLAG_GROUP = 256,
  FLAG_SOURCE = 512;

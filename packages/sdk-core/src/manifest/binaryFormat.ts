/**
 * Binary sidecar for a cluster manifest.
 *
 * A cluster cache describes tens of thousands of clusters with a dozen numbers each. Written as
 * JSON that is tens of megabytes the browser has to tokenize before the first frame; written as
 * typed-array columns it is a single `fetch` and a handful of views. The small JSON that stays
 * beside it keeps everything a human or a tool reads — primitives, materials, the group structure
 * counts, the geometry containers — plus the pointer to the columns.
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
/** The codec geometry pages are written with. */
export const GEOMETRY_PAGE_CODEC = 'quantized'

import { PREVIEW_WORDS } from '../texture/previewFormat.ts'
import { CULLING_STRIDE } from '../contracts/writtenFormats.ts'

export const COLUMN_NAMES = [
  'pageBounds',
  'pageSphere',
  'pageParentSphere',
  'pageError',
  'pageInt',
  'pageU32',
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
  'texturePreviewBc7',
  'texturePreviewAstc',
  'texturePreviewEtc2',
  'bundleDependencyCount',
  'bundleDependency',
  'bundleDecodedBytes',
] as const
export type ColumnName = (typeof COLUMN_NAMES)[number]
/** The first manifest binary version with the `bundleDecodedBytes` column; older ones hold every
 *  column before it and store their bundles as they are. */
const DECODED_BYTES_VERSION = 23
/** How many columns a binary of `version` holds, its header declaring as many. */
export const columnCountOf = (version: number) =>
  version >= DECODED_BYTES_VERSION ? COLUMN_NAMES.length : COLUMN_NAMES.length - 1
/** How one column of the binary manifest is stored. */
export type ColumnKind = 'f64' | 'i32' | 'u32' | 'u8'
/**
 * How each column of the binary manifest is stored: decimals, whole numbers or bytes.
 * @property pageBounds - Each page's box.
 * @property pageSphere - Each page's ball.
 * @property pageParentSphere - The ball of what replaces each page.
 * @property pageError - Each page's error and its replacement's.
 * @property pageInt - Each page's signed numbers.
 * @property pageU32 - Each page's counts.
 * @property geometryU32 - Each geometry page's counts and its size and place in the pool.
 * @property cullingNodes - The culling trees' nodes.
 * @property groupLevel - Each group's level.
 * @property groupError - Each group's error.
 * @property groupSphere - Each group's ball.
 * @property groupChildCount - How many clusters each group replaces.
 * @property groupChild - The clusters each group replaces.
 * @property groupOutputCount - How many clusters each group makes.
 * @property groupOutput - The clusters each group makes.
 * @property structureRoot - The clusters nothing replaces.
 * @property bundleU32 - Each bundle's container, offset there, size and cluster count.
 * @property bundleSha - Each bundle's fingerprint.
 * @property pageDepthLayer - Each page's coplanar depth layer.
 * @property texturePreviewU32 - Each texture preview's numbers.
 * @property texturePreviewSha - Each texture preview's fingerprint.
 * @property texturePreviewPixels - The previews' pixels.
 * @property texturePreviewBc7 - The previews' BC7 blocks.
 * @property texturePreviewAstc - The previews' ASTC blocks.
 * @property texturePreviewEtc2 - The previews' ETC2 blocks.
 * @property bundleDependencyCount - How many bundles each bundle depends on.
 * @property bundleDependency - The bundles each bundle depends on, closed to the root cover.
 * @property bundleDecodedBytes - Each bundle's size once inflated; 0 for one stored as it is.
 */
export const COLUMN_KIND: Record<ColumnName, ColumnKind> = {
  pageBounds: 'f64',
  pageSphere: 'f64',
  pageParentSphere: 'f64',
  pageError: 'f64',
  pageInt: 'i32',
  pageU32: 'u32',
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
  texturePreviewBc7: 'u8',
  texturePreviewAstc: 'u8',
  texturePreviewEtc2: 'u8',
  bundleDependencyCount: 'u32',
  bundleDependency: 'u32',
  bundleDecodedBytes: 'u32',
}
/** Numbers per element. A sha is 64 ASCII hexadecimal characters: one `TextDecoder` for the whole
 *  column, then one `substring` per entry, is far cheaper than re-encoding 32 raw bytes each time. */
export const COLUMN_STRIDE: Record<ColumnName, number> = {
  pageBounds: 6,
  pageSphere: 4,
  pageParentSphere: 4,
  pageError: 2,
  pageInt: 8,
  pageU32: 1,
  geometryU32: 7,
  cullingNodes: CULLING_STRIDE,
  groupLevel: 1,
  groupError: 1,
  groupSphere: 4,
  groupChildCount: 1,
  groupChild: 1,
  groupOutputCount: 1,
  groupOutput: 1,
  structureRoot: 1,
  bundleU32: 4,
  bundleSha: 64,
  pageDepthLayer: 1,
  texturePreviewU32: PREVIEW_WORDS,
  texturePreviewSha: 64,
  // Columns without a fixed stride: their element is the byte, and their count is the total the
  // small JSON declares — each entry naming its own pixel range, and its block range following
  // from its dimensions, entry after entry.
  texturePreviewPixels: 1,
  texturePreviewBc7: 1,
  texturePreviewAstc: 1,
  texturePreviewEtc2: 1,
  bundleDependencyCount: 1,
  bundleDependency: 1,
  bundleDecodedBytes: 1,
}
export const BYTES_PER_ELEMENT: Record<ColumnKind, number> = { f64: 8, i32: 4, u32: 4, u8: 1 }

/** `pageInt` slots. -1 is «absent or null»; the flag word says which. */
export const INT_ID = 0,
  INT_LEVEL = 1,
  INT_GROUP = 2,
  INT_SOURCE = 3,
  INT_STREAM = 4,
  INT_STREAM_OFFSET = 5,
  INT_COUNT = 6,
  INT_START = 7
/** `geometryU32` slots: the page's facts — its bytes on disk, its counts and flags, what it
 *  decodes to, the bytes it takes in the pool once installed and where it lies in its streaming
 *  page's place there. */
export const GEOMETRY_BYTES = 0,
  GEOMETRY_VERTICES = 1,
  GEOMETRY_INDICES = 2,
  GEOMETRY_FLAGS = 3,
  GEOMETRY_UNCOMPRESSED = 4,
  GEOMETRY_RESIDENT_BYTES = 5,
  GEOMETRY_RESIDENT_OFFSET = 6
/** `bundleU32` slots: its container's rank in the manifest's `geometryFiles`, its offset there,
 *  its size as stored and its cluster count. */
export const BUNDLE_FILE = 0,
  BUNDLE_OFFSET = 1,
  BUNDLE_BYTES = 2,
  BUNDLE_COUNT = 3

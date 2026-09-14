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
export const MANIFEST_BINARY_VERSION = 1;
/** 'W','G','M','B' read as a little-endian u32. */
export const MANIFEST_BINARY_MAGIC = 0x424d4757;
export const MANIFEST_BINARY_HEADER_WORDS = 4;

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

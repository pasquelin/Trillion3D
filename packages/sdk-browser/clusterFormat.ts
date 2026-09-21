/**
 * The `WGP3` quantized cluster page as every reader must know it (`docs/FORMAT.md`): the shared
 * Rust codec (`packages/page-codec-wasm/src/bits.rs`) is the source of these numbers, the
 * JavaScript decoder (`geometryPage.ts`) and the WGSL routines (`clusterDecodeWgsl.ts`) repeat
 * them here so the three decode the same bytes to the same floats. The format version itself is
 * the manifest's (`GEOMETRY_PAGE_FORMAT_VERSION`, `sdk-core`).
 */
export const CLUSTER_PAGE_MAGIC = 0x33504757,
  CLUSTER_HEADER_WORDS = 24;
/** Attribute presence bits: normal, first and second texture coordinate, colour. */
export const FLAG_NORMAL = 1,
  FLAG_UV = 2,
  FLAG_UV1 = 4,
  FLAG_COLOR = 8,
  FLAGS_ALL = 15;
/** Decoded name, float width and presence bit of each optional attribute, in stream order. */
export const OPTIONAL = [
  ['normal', 3, FLAG_NORMAL],
  ['uv', 2, FLAG_UV],
  ['uv2', 2, FLAG_UV1],
  ['color', 4, FLAG_COLOR],
] as const;
/** Widest field: read at any bit offset, it spans two words at most. */
export const MAX_BITS = 24;
/** Largest magnitude of a grid exponent: the step stays a normal 32-bit float. */
export const MAX_EXPONENT = 64;
/** `2 / 255` as the nearest 32-bit float: an octahedral byte to `[-1, 1]`. */
export const OCT_SCALE = Math.fround(2 / 255);

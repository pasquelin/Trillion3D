/**
 * The `WGP3` quantized cluster page as every reader must know it (`docs/FORMAT.md`): the shared
 * Rust codec (`packages/page-codec-wasm/src/bits.rs`) is the source of these numbers, the
 * JavaScript decoder (`../page/codec/geometryPage.ts`) and the WGSL routines (`decodeWgsl.ts`) repeat
 * them here so the three decode the same bytes to the same floats. The format version itself is
 * the manifest's (`GEOMETRY_PAGE_FORMAT_VERSION`, `sdk-core`).
 */
export const CLUSTER_PAGE_MAGIC = 0x33504757,
  CLUSTER_HEADER_WORDS = 25
/** Attribute presence bits: normal, first and second texture coordinate, colour; then the skin
 *  and the morph targets the GPU deformation stage reads (#357, `page-codec-wasm/src/deform.rs`). */
export const FLAG_NORMAL = 1,
  FLAG_UV = 2,
  FLAG_UV1 = 4,
  FLAG_COLOR = 8,
  FLAG_SKIN = 16,
  FLAG_MORPH = 32,
  /** The index/weight streams name simulated vertices, never joints. Requires FLAG_SKIN. */
  FLAG_SOFT_SOURCE = 64,
  FLAGS_ALL = 127
/** Header words of one morph target, the widest joint field, the most targets a page carries,
 *  as declared by the shared codec. Weights and morph deltas retain their float32 bits. */
export const MORPH_WORDS = 9,
  MAX_JOINT_BITS = 16,
  MAX_MORPH_TARGETS = 255
/** Decoded name, float width and presence bit of each optional attribute, in stream order. */
export const OPTIONAL = [
  ['normal', 3, FLAG_NORMAL],
  ['uv', 2, FLAG_UV],
  ['uv2', 2, FLAG_UV1],
  ['color', 4, FLAG_COLOR],
] as const
/** Triangles per block of the corner code, the bits of a block's width and its largest value
 *  (`packages/page-codec-wasm/src/triangles.rs`). */
export const TRIANGLE_BLOCK = 8,
  WIDTH_BITS = 5,
  MAX_WIDTH = 16
/** Corners per full block: a block's bits are `BLOCK_CORNERS × width`, so a prefix of widths
 *  locates it. */
export const BLOCK_CORNERS = 3 * TRIANGLE_BLOCK
/** Widest field: read at any bit offset, it spans two words at most. */
export const MAX_BITS = 24
/** Largest magnitude of a grid exponent: the step stays a normal 32-bit float. */
export const MAX_EXPONENT = 64
/** `2 / 255` as the nearest 32-bit float: an octahedral byte to `[-1, 1]`. */
export const OCT_SCALE = Math.fround(2 / 255)

/**
 * The ray-tracing product, written once and read by the runtime's ray tracer and the compiler's
 * Rust (`scripts/build/shared-rules/rayTracing.ts` prints it into `ray_tracing/abi.rs`).
 *
 * The compiler cuts the cluster DAG of every compiled primitive at a coarse error (a hundredth of
 * the mesh's size) and builds over the triangles of that cut a tree of eight children a node, each
 * child box quantised in the node's own frame, and writes the trees of all the primitives in
 * `rayTracing.bin`, one record per primitive that has a triangle. The lengths are metres, in the
 * primitive's object space.
 */

/** The product holding every primitive's tree, and the manifest's section naming it. */
export const RAY_TRACING_FILE = 'rayTracing.bin'
/** The first four bytes of `rayTracing.bin`: `T3RT` read as a little-endian `u32`. */
export const RAY_TRACING_MAGIC = 0x54523354
/** Format of `rayTracing.bin` and of the manifest's `rayTracing` section
 *  (`asset-compiler-rust/src/ray_tracing/encode.rs` lays it out). */
export const RAY_TRACING_VERSION = 2
/** The bytes of the file's head: the magic, the version, the record count, the node count and the
 *  triangle count (five `u32`), then three zero words. */
export const RAY_TRACING_HEAD_BYTES = 32
/** The bytes of a primitive's record: its compiled mesh and its number in the mesh (the two
 *  numbers a cluster root names its primitive by, `ClusterRoot.mesh` and `ClusterRoot.primitive`),
 *  its flags (`RAY_TRACING_FLAG_*`), the error of its cut in metres (`f32`), the rank of its first
 *  node and how many it has, the rank of its first triangle and how many it has (four `u32`, ranks
 *  within the file's node and triangle tables), the low and the high corner of its box in metres
 *  (six `f32`) and two zero words. */
export const RAY_TRACING_RECORD_BYTES = 64
/** The bytes of a node: the low corner of its box (three `f32`), the exponent of the scale its
 *  children's boxes are quantised at on each axis (three `i8`), the mask of its internal children
 *  (a byte), the rank of its first internal child and of its first triangle (two `u32`), the eight
 *  children's metas (a byte each: 0 for an empty slot and for an internal child, which the mask
 *  of internal children says; for a leaf child its triangle count over its offset, see
 *  `RAY_TRACING_LEAF_COUNT_SHIFT`) and the eight children's low and high corners (`u8`, a
 *  quantised coordinate each, the eight x first, then y, then z). The internal children of a node
 *  are consecutive from its first, in slot order: the child in slot `s` is the node of rank
 *  `childBase` plus the number of internal children in the slots before `s`. */
export const RAY_TRACING_NODE_BYTES = 80
/** The bytes of a triangle: its three corners in metres (nine `f32`), the rank of its cluster in
 *  the primitive's DAG and its own rank in the cluster (two `u32`) and a zero word. */
export const RAY_TRACING_TRIANGLE_BYTES = 48
/** The children of a node: the slots of its metas and its masks, the eight octants of a ray's
 *  direction (the child in slot `s` is the first met by a ray whose direction has the signs of
 *  octant `s`, the bit of an axis set when the ray goes towards its negative side). */
export const RAY_TRACING_WIDTH = 8
/** The most triangles a leaf child holds. */
export const RAY_TRACING_LEAF_TRIANGLES = 3
/** A leaf child's meta byte: its triangle count (1 to `RAY_TRACING_LEAF_TRIANGLES`, binary) in the
 *  bits from this shift, the rank of its first triangle past the node's `triangleBase` in the bits
 *  of the mask. */
export const RAY_TRACING_LEAF_COUNT_SHIFT = 5
export const RAY_TRACING_LEAF_OFFSET_MASK = 31
/** The words of a record, by name (`RAY_TRACING_RECORD_BYTES`). */
export const RAY_TRACING_RECORD_AT = {
  mesh: 0,
  primitive: 1,
  flags: 2,
  error: 3,
  firstNode: 4,
  nodeCount: 5,
  firstTriangle: 6,
  triangleCount: 7,
  boxMin: 8,
  boxMax: 11,
} as const
/** The bit of a record's flags that says the primitive's material is double-sided. */
export const RAY_TRACING_FLAG_TWO_SIDED = 1
/** The bit of a record's flags that says the primitive's material is alpha-masked: its coverage
 *  cuts holes in the surface. The records only carry the fact; the surface cache's shadow rays do
 *  not test coverage and take a hit on such a primitive as opaque. */
export const RAY_TRACING_FLAG_MASKED = 2
/** The bit of a record's flags that says the primitive's material is translucent (blended or
 *  transmissive): it is not an occluder as an opaque surface is. */
export const RAY_TRACING_FLAG_TRANSLUCENT = 4

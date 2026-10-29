/**
 * The ray-tracing product, written once and read by the runtime's ray tracer and the compiler's
 * Rust (`scripts/build/shared-rules/rayTracing.ts` prints it into `ray_tracing/abi.rs`).
 *
 * The compiler cuts the cluster DAG of every compiled primitive at a coarse error (a hundredth of
 * the mesh's size) and builds over the triangles of that cut a tree of eight children a node, each
 * child box quantised in the node's own frame, and writes the trees of all the primitives in
 * `rayTracing.bin`, one record per primitive that has a triangle. The lengths are metres, in the
 * primitive's object space.
 *
 * Each HLOD actor of the world is a mesh of its own, as in a scene where it is an instance: it has
 * a record (`RAY_TRACING_FLAG_ACTOR`) over the cut of its DAG at its own error, in the world's space,
 * naming the HLOD cell whose switch shows it. The world's last record (`RAY_TRACING_FLAG_WORLD`) is
 * the directory of the actors: a tree over their boxes, whose entries name the actors' records. A
 * ray entering a placement of the world DAG walks the directory and enters only the actors whose cell
 * the cut draws this frame.
 */

/** The product holding every primitive's tree, and the manifest's section naming it. */
export const RAY_TRACING_FILE = 'rayTracing.bin'
/** The first four bytes of `rayTracing.bin`: `T3RT` read as a little-endian `u32`. */
export const RAY_TRACING_MAGIC = 0x54523354
/** Format of `rayTracing.bin` and of the manifest's `rayTracing` section
 *  (`asset-compiler-rust/src/ray_tracing/encode.rs` lays it out): the triangles name their corners
 *  in a table of the file's vertices (`RAY_TRACING_INDEXED_TRIANGLE_BYTES`). */
export const RAY_TRACING_VERSION = 4
/** The format before, which the engine still reads: each triangle holds its corners
 *  (`RAY_TRACING_TRIANGLE_BYTES`), and the file has no vertices. */
export const RAY_TRACING_FLAT_VERSION = 3
/** The bytes of the file's head: the magic, the version, the record count, the node count, the
 *  triangle count and the vertex count (six `u32`; a zero word in the flat format), then two zero
 *  words. */
export const RAY_TRACING_HEAD_BYTES = 32
/** The bytes of a primitive's record: its compiled mesh and its number in the mesh (the two
 *  numbers a cluster root names its primitive by, `ClusterRoot.mesh` and `ClusterRoot.primitive`;
 *  both `RAY_TRACING_NO_PRIMITIVE` in the world's record),
 *  its flags (`RAY_TRACING_FLAG_*`), the error of its cut in metres (`f32`), the rank of its first
 *  node and how many it has, the rank of its first triangle and how many it has (four `u32`, ranks
 *  within the file's node and triangle tables), the low and the high corner of its box in metres
 *  (six `f32`), the HLOD cell of an actor's record (`RAY_TRACING_RECORD_AT.cell`; zero in the others)
 *  and a zero word. */
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
/** The bytes of a triangle as the GPU reads it, and as the flat format holds it: its three corners
 *  in metres (nine `f32`), the rank of its cluster in
 *  the primitive's DAG and its own rank in the cluster (two `u32`) and its tag, a zero word. An entry
 *  of the world's directory (`RAY_TRACING_FLAG_WORLD`) takes the place of a triangle: the low and the
 *  high corner of an actor's box and the low corner again, the actor's rank among the actors' records
 *  (`cluster`, the records just before the directory's, in order), zero, and the actor's HLOD cell
 *  (the tag). */
export const RAY_TRACING_TRIANGLE_BYTES = 48
/** The bytes of a vertex of the file: a corner, three `f32` in metres, the bits of a triangle's own.
 *  The file holds each corner once, in the order the triangles first name them. */
export const RAY_TRACING_VERTEX_BYTES = 12
/** The bytes of a triangle as the file holds it: its three corners among the file's vertices
 *  (three `u32`: zero for a corner first named, the next vertex; else how far back it lies from
 *  the next, the next vertex's rank less its own), then the triangle's last three words
 *  (`RAY_TRACING_TRIANGLE_AT`). The reader lays it out as the GPU reads it
 *  (`RAY_TRACING_TRIANGLE_BYTES`), the same bytes. */
export const RAY_TRACING_INDEXED_TRIANGLE_BYTES = 24
/** The words of a triangle after its nine corner floats, by name (`RAY_TRACING_TRIANGLE_BYTES`). */
export const RAY_TRACING_TRIANGLE_AT = { cluster: 9, triangle: 10, tag: 11 } as const
/** The children of a node: the slots of its metas and its masks, in no order the walk reads — it
 *  measures the span of every child it meets and goes to the nearest. */
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
  cell: 14,
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
/** The bit of a record's flags that says it is the world's directory: a tree over the boxes of the
 *  HLOD actors, whose entries stand where triangles do (`RAY_TRACING_TRIANGLE_BYTES`). It names no
 *  primitive, and the actors' records are the ones just before it. */
export const RAY_TRACING_FLAG_WORLD = 8
/** The bit of a record's flags that says it is an HLOD actor's: the cut of its DAG at its own error, in
 *  the world's space, wearing its material's flags (`RAY_TRACING_FLAG_*`), shown by the HLOD cell the
 *  record names (`RAY_TRACING_RECORD_AT.cell`). It names no primitive. */
export const RAY_TRACING_FLAG_ACTOR = 16
/** The bit of a record's flags that says every primitive of its mesh is translucent (an HLOD actor
 *  being a mesh of one material): a mesh no part of which is opaque is left out of every ray whatever
 *  the ray asks, as the scene a ray tracer builds leaves it out unless it traces translucent geometry. The
 *  compiler sets it on each record of such a mesh, each of which has `RAY_TRACING_FLAG_TRANSLUCENT`
 *  too; a mesh with an opaque primitive has it on none, its translucent primitives being left out
 *  only of the rays that ask. */
export const RAY_TRACING_FLAG_ALL_TRANSLUCENT = 32
/** The compiled mesh and primitive number the world's records name: none. */
export const RAY_TRACING_NO_PRIMITIVE = 0xffffffff
/** The nodes a walk of any tree of the file holds on its stack at most: the compiler gives a tree no
 *  walk of which needs more (the walk keeps, at a node, all the hit internal children but the nearest,
 *  so a tree needs at the deepest the sum along a path of its internal children less one), and the
 *  shader's stack holds as many. */
export const RAY_TRACING_STACK = 64
/** The least exponent a node's scale takes (`RAY_TRACING_NODE_BYTES`): a box that is flat along an
 *  axis gets it, its children's coordinates there being zero whatever the scale. The compiler writes no
 *  lesser and the shader reads no lesser, so that both read the same power of two. */
export const RAY_TRACING_MIN_EXPONENT = -126

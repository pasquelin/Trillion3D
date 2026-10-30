# `rayTracing.bin`

Trees a ray tracer walks: one per compiled primitive with a triangle in its coarse cut; with HLOD
actors, one per actor plus a directory (`rust/ray_tracing/encode.rs`, read by
`sdk-core/src/lighting/rayTracingFile.ts`; the cut is in
[COMPILER.md](../compiler/ray-tracing.md#ray-tracing)). Little-endian; lengths in metres, in object
space (world space for the world's records).

Head, 32 bytes (`u32` each): magic `T3RT`, version (7), counts of records, nodes, triangles, vertices,
number of corners whose attributes follow the triangles (three a triangle, or zero), number of
corners of the cutout's table that closes the file (three a triangle of records naming a texture
set, or zero). Then a 64-byte record per primitive in manifest primitives order, the actors' records,
the directory's. A record:

| Word | Content |
| - | - |
| 0-1 | compiled mesh and number in it; `RAY_TRACING_NO_PRIMITIVE` (`0xffffffff`) twice in the directory's, and as mesh in an actor's, whose second word is its material rank (`hlodMaterials`) |
| 2 | flags (below) |
| 3 | error of its cut, metres (`f32`) |
| 4-5 | rank of first node, node count (file's node table) |
| 6-7 | rank of first triangle, triangle count (file's triangle table) |
| 8-13 | low and high corner of its triangles' box (six `f32`) |
| 14 | HLOD cell whose switch shows the actor (actor's record); else zero |
| 15 | rank of its first triangle in the cutout's table; zero when no texture set |

After the records, in order:
- nodes of every record, 80 bytes each;
- vertices, 12 bytes each;
- triangles, 24 bytes each;
- when the head counts corners, each triangle's corner attributes (`RAY_TRACING_CORNER_BYTES`, 16
  bytes a corner): texture coordinate (two `f32`), shading normal (octahedral, two `snorm16`, read
  only with `RAY_TRACING_FLAG_NORMALS`), vertex colour (four `unorm8`; white without one); zero for a
  record without `RAY_TRACING_FLAG_ATTRIBUTES`;
- when the head counts them, the cutout's table: texture coordinate (two `f32`, 8 bytes) of each
  corner of each triangle of records whose flags name a texture set.

A masked material reads its base map's alpha at the texture set that map names (glTF `texCoord`, 0 to
7). The compiler writes that set in flag bits 8 to 10 when it is past the first and the mesh carries
it; only those records' corners carry its coordinate in the cutout's table; the corners' own
coordinate is the first set's. A `texCoord` past 7 compiles, cuts by the first set, and the tables'
event carries a `RAY_TRACING_TEXCOORD_OUT_OF_RANGE` warning (T3D-W236). Versions 5 (no cutout table)
and 6 are still read; 6 gave every corner a second texture coordinate (24 bytes a corner instead of
16), dropped by the reader, so a masked record reads set 0 only.

A record's nodes are consecutive, root first; links count from the record's first node and first
triangle. A node has up to eight children in eight slots. A node:

| Bytes | Content |
| - | - |
| 0-11 | `p`, low corner of the node's box (three `f32`) |
| 12-14 | `e`, exponent per axis (three `i8`): the least with `2^e · 255` at least the node's side, no less than `RAY_TRACING_MIN_EXPONENT` (-126), which a flat side has |
| 15 | mask of internal children: bit `s` set when slot `s` holds a node |
| 16-19 | rank of the first internal child among the record's nodes; internal children lie in slot order |
| 20-23 | rank of the first leaf-children triangle, from the record's first triangle; in slot order |
| 24-31 | meta per slot: 0 when empty or internal; leaf: `(count << 5) \| offset`: count 1 to 3, offset (below 32) the rank of its first triangle from the node's first |
| 32-79 | children's boxes, a byte a coordinate: low x of the eight slots, low y, low z, then high x, y, z |

A child's box is `p + 2^e · q` per axis, `q` the byte; low corner rounded down, high corner up. The
internal child in slot `s` is the `popcount(mask & ((1 << s) - 1))`-th internal child. A tree needs
at most `RAY_TRACING_STACK` (64) stack nodes: the compiler splits a deeper tree in halves, and stops
with `RAY_TRACING_TREE_TOO_DEEP` if those still need more.

A vertex is a corner (three `f32`), each once, in the order triangles first name them. A triangle, 24
bytes: its three corners among the vertices (zero for a corner first named, the next vertex; else how
far back it lies: next vertex's rank less its own), cluster rank among the DAG clusters, own rank in
the cluster, tag (`u32` each; zero but in the directory). The reader lays each triangle out as the
GPU reads it, 48 bytes (`RAY_TRACING_TRIANGLE_BYTES`): three corners' floats, then the last three
words; it refuses a triangle naming a missing vertex. Version 3, still read, has no vertices (count
zero) and holds triangles so laid out.

Flags (word 2):

| Bit | Name | Meaning |
| - | - | - |
| 0 (`1`) | `RAY_TRACING_FLAG_TWO_SIDED` | double-sided material |
| 1 (`2`) | `RAY_TRACING_FLAG_MASKED` | alpha-masked material: a hit is tested against coverage |
| 2 (`4`) | `RAY_TRACING_FLAG_TRANSLUCENT` | blended or transmissive material |
| 3 (`8`) | `RAY_TRACING_FLAG_WORLD` | the HLOD actors' directory; no other flag set |
| 6 (`64`) | `RAY_TRACING_FLAG_NORMALS` | corner attributes include a shading normal (with `RAY_TRACING_FLAG_ATTRIBUTES`) |
| 7 (`128`) | `RAY_TRACING_FLAG_ATTRIBUTES` | triangle corners carry attributes |
| 8-10 | `RAY_TRACING_FLAG_MASK_SET` | texture set (1 to 7) its alpha mask is read at, coordinates in the cutout's table; zero for the first |
| 4 (`16`) | `RAY_TRACING_FLAG_ACTOR` | HLOD actor's record, over its material's flags (bits 0 to 2, 7 to 11); word 14 the cell, word 1 the material rank |
| 11 (`2048`) | `RAY_TRACING_FLAG_SKY` | sky material: left out of rays through the scene's triangles unless the project includes the sky (`rayTracingExcludeSky`) or the ray is a path tracer's camera ray |

A primitive whose cut holds no triangle has no record; a skinned or morphed one has one, at rest pose.

**HLOD actors.** Spliced into the world's one DAG, in world space; each is cut as a primitive's DAG,
at the error of its own finest clusters, into a record naming no mesh, its material rank
(`hlodMaterials`) and that material's flags (flattened material as published, blended or masked as
its base image's alpha says; scene material as any primitive wearing it), with corner attributes and,
for a mask reading a set past the first, that set's coordinates. The runtime keeps a cutout per rank
an actor names and tests the actor's triangles with it. Actors' records come just before the
directory's, in actor order.

The directory (`RAY_TRACING_FLAG_WORLD`, last record, present only when an actor has a triangle) is
a tree over the actors' boxes whose entries stand where triangles do, in leaf order: box low and
high corner and low corner again (nine `f32`), actor's rank among the actors' records (cluster word),
zero (triangle word), actor's HLOD cell (tag). The reader refuses an entry naming a missing actor or a
cell other than its actor's, a directory whose flags are not the world's alone, and a cell word in a
non-actor record. A voxel actor has no record.

A ray enters an HLOD actor only where the cut draws its cell this frame. The runtime keeps one word
per HLOD cell of each world DAG instance: top bit says the cut draws the cell's actor; under it, the
rank plus one of the object a hit is told by (zero for none; the hit names `NO_INDEX`, as a miss).

The manifest's `rayTracing` section:

```json
{ "rayTracing": { "version": 7, "file": "rayTracing.bin", "bytes": 2672 } }
```

A scene with no triangle in any cut writes neither file nor section. Constants:
`RAY_TRACING_VERSION`, `RAY_TRACING_FLAT_VERSION`, `RAY_TRACING_MAGIC`, `RAY_TRACING_HEAD_BYTES`,
`RAY_TRACING_RECORD_BYTES`, `RAY_TRACING_NODE_BYTES`, `RAY_TRACING_VERTEX_BYTES`,
`RAY_TRACING_INDEXED_TRIANGLE_BYTES`, `RAY_TRACING_TRIANGLE_BYTES`, `RAY_TRACING_WIDTH`,
`RAY_TRACING_LEAF_TRIANGLES`, `RAY_TRACING_LEAF_COUNT_SHIFT`, `RAY_TRACING_LEAF_OFFSET_MASK`,
`RAY_TRACING_CORNER_BYTES`, `RAY_TRACING_MASK_CORNER_BYTES`, `RAY_TRACING_FLAG_*`,
`RAY_TRACING_NO_PRIMITIVE`, `RAY_TRACING_STACK`, `RAY_TRACING_MIN_EXPONENT`
(`packages/sdk-core/src/contracts/rayTracingAbi.ts`).

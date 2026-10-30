# `rayTracing.bin`

The trees a ray tracer walks: one for each compiled primitive that has a triangle in its coarse cut and,
for a world with HLOD actors, one for each actor and the directory of them (`rust/ray_tracing/encode.rs`,
read by `sdk-core/src/lighting/rayTracingFile.ts`; the cut is in
[COMPILER.md](../compiler/ray-tracing.md#ray-tracing)). Words are little-endian; lengths are metres, in
the primitive's object space, or, for the world's records, in the world's space.

The head, 32 bytes (`u32` each): the magic `T3RT`, the version (7), the number of records, nodes,
triangles and vertices, the number of corners whose attributes follow the triangles (three a triangle,
or zero) and the number of corners of the cutout's table that closes the file (three a triangle of the
records that name a texture set, or zero). Then a record of 64 bytes for each primitive in the order of
the manifest's primitives, then the actors' records, then the directory's. A record holds, in this order:

| Word | Content |
| --- | --- |
| 0-1 | the primitive's compiled mesh and its number in the mesh (the two numbers a placed root names its primitive by); `RAY_TRACING_NO_PRIMITIVE` (`0xffffffff`) twice in the directory's, and as the mesh in an actor's, whose second word is the rank of the material it wears (`hlodMaterials`) |
| 2 | the flags (below) |
| 3 | the error of its cut, in metres (`f32`) |
| 4-5 | the rank of its first node and how many nodes it has (ranks in the file's node table) |
| 6-7 | the rank of its first triangle and how many triangles it has (ranks in the file's triangle table) |
| 8-13 | the low and the high corner of the box of its triangles (six `f32`) |
| 14 | the HLOD cell whose switch shows the actor, in an actor's record; zero in every other |
| 15 | the rank of its first triangle in the cutout's table (below); zero in a record that names no texture set |

After the records, in this order: the nodes of every record, 80 bytes each, one record after the other;
the vertices, 12 bytes each; their triangles, 24 bytes each; when the head counts corners, the attributes
of the corners of every triangle (16 bytes a corner, three a triangle, in the triangles' order: the
texture coordinate as two `f32`, the shading normal octahedral as two `snorm16`, the vertex colour as
four `unorm8`; zero for a record without `RAY_TRACING_FLAG_ATTRIBUTES`); then, when the head counts
them, the cutout's table: the texture coordinate (two `f32`, 8 bytes) of each corner of each triangle of
the records whose flags name a texture set, in the triangles' order.

A masked material reads its base map's alpha at the texture set its base map names (glTF `texCoord`, 0 to
7). The compiler writes that set in bits 8 to 10 of the flags of the records of such a material when it
is past the first and the mesh carries it, and the corners of those records alone carry its coordinate in
the cutout's table; the corners' own coordinate is the first set's. A `texCoord` past 7 names a set no
vertex carries (the glTF importers read `TEXCOORD_0` to `TEXCOORD_7` only): the model compiles, the
material cuts by the first set, and the tables' event carries a `RAY_TRACING_TEXCOORD_OUT_OF_RANGE`
warning (T3D-W236) naming it. The ray reads the cutout's table where the surface it hits reads the set
the record names, else the first set: the same holes as the raster wherever the two agree. Versions 5 (no
cutout table) and 6 are still read, as a legacy: version 6 gave every corner a second texture coordinate
(24 bytes a corner instead of 16), which the reader drops, so that a masked record reads set 0 only (the
corners' own coordinate).

The attributes of a corner (`RAY_TRACING_CORNER_BYTES`, 16 bytes, three a triangle in the triangles'
order): the texture coordinate (two `f32`), the shading normal (octahedral, two `snorm16`, read only in a
record with `RAY_TRACING_FLAG_NORMALS`) and the vertex colour (four `unorm8`; white for a mesh without
one), zero in a record without `RAY_TRACING_FLAG_ATTRIBUTES`. A record's nodes are consecutive, its root
the first, and the links of a node count from its record's first node and first triangle.

A node has up to eight children, in eight slots. The slots are in the order the compiler opened the
children in, which no ray's direction chooses: a walk measures the span of every child it meets and goes
to the nearest. A node holds, in this order:

| Bytes | Content |
| --- | --- |
| 0-11 | `p`, the low corner of the node's box (three `f32`) |
| 12-14 | `e`, the exponent of each axis (three `i8`): the least with `2^e · 255` at least the node's side, and no less than `RAY_TRACING_MIN_EXPONENT` (-126), which a flat side has |
| 15 | the mask of the internal children: bit `s` set when slot `s` holds a node |
| 16-19 | the rank of the first internal child among the record's nodes, counted from the record's first node; the internal children lie one after the other, in slot order |
| 20-23 | the rank of the first triangle of the leaf children, counted from the record's first triangle; the leaves' triangles lie one after the other, in slot order |
| 24-31 | the meta of each slot: 0 when empty and for an internal child (the mask says it); for a leaf child, `(count << 5) \| offset`: the count is 1, 2 or 3, the offset (below 32) the rank of its first triangle from the node's first |
| 32-79 | the boxes of the children, a byte a coordinate: the low x of the eight slots, the low y, the low z, then the high x, y and z |

A child's box is `p + 2^e · q` on each axis, `q` being the byte: the low corner is rounded down and the
high corner up, so the box holds the child's. The internal child in slot `s` is the
`popcount(mask & ((1 << s) - 1))`-th of the node's internal children. No tree needs a walk to keep more
than `RAY_TRACING_STACK` (64) nodes on its stack (a walk keeps, at a node, every internal child it meets
but the nearest): the compiler splits a tree whose cheapest cuts need more in halves, and stops with
`RAY_TRACING_TREE_TOO_DEEP` if even those need more.

A vertex is a corner (three `f32`), each corner of the file once, in the order the triangles first name
them. A triangle, 24 bytes, holds its three corners among the vertices (zero for a corner first named,
which is the next vertex; else how far back it lies from the next, the next vertex's rank less its own),
the rank of its cluster among the DAG clusters, its own rank in the cluster and its tag (`u32` each).
The tag is zero but in the directory. The reader lays each triangle out as the GPU reads it, 48 bytes
(`RAY_TRACING_TRIANGLE_BYTES`): its three corners' floats, then its last three words; it refuses a
triangle naming a vertex the file lacks. Version 3, which the reader still reads, has no vertices (the
vertex count is zero) and holds the triangles so laid out.

The record's third word holds flags:

| Bit | Name | Meaning |
| --- | --- | --- |
| 0 (`1`) | `RAY_TRACING_FLAG_TWO_SIDED` | the primitive's material is double-sided |
| 1 (`2`) | `RAY_TRACING_FLAG_MASKED` | its material is alpha-masked: a hit must be tested against the material's coverage |
| 2 (`4`) | `RAY_TRACING_FLAG_TRANSLUCENT` | its material is translucent (blended or transmissive): it is no occluder as opaque is |
| 3 (`8`) | `RAY_TRACING_FLAG_WORLD` | the record is the world's directory of the HLOD actors; no other flag is set |
| 6 (`64`) | `RAY_TRACING_FLAG_NORMALS` | its corners' attributes include a shading normal (with `RAY_TRACING_FLAG_ATTRIBUTES`) |
| 7 (`128`) | `RAY_TRACING_FLAG_ATTRIBUTES` | its triangles' corners carry attributes (the table after the triangles) |
| 8-10 | `RAY_TRACING_FLAG_MASK_SET` | the texture set (1 to 7) its alpha mask is read at, whose coordinates are in the cutout's table; zero for the first set |
| 4 (`16`) | `RAY_TRACING_FLAG_ACTOR` | the record is an HLOD actor's, over its material's flags (bits 0 to 2, 7 to 11); word 14 is the cell showing it, word 1 the rank of its material |
| 11 (`2048`) | `RAY_TRACING_FLAG_SKY` | the primitive's material is a sky material: left out of the rays through the scene's triangles unless the project includes the sky (`rayTracingExcludeSky`) or the ray is a path tracer's camera ray |

A primitive whose cut holds no triangle has no record; a skinned or morphed primitive has one, at its
rest pose, and the reader decides what to do with it.

**HLOD actors.** The world's HLOD actors are meshes of their own, all spliced into the world's one DAG,
in the world's space: each is cut as a primitive's DAG is, at the error of its own finest clusters, into
an actor's record that names no mesh, the rank of the material the actor wears (`hlodMaterials`) and the
flags of that material (a flattened material as it is published, blended or masked as its base image's
alpha says; a material of the scene as any primitive wearing it), with the corners' attributes of its cut
and, for a mask reading a texture set past the first, that set's coordinates, as a primitive's. The
runtime keeps a cutout for each rank an actor names and tests the actor's triangles with it, never with
the world's placement they are walked through. The actors' records are the ones just before the
directory's, in the actors' order.

The directory (`RAY_TRACING_FLAG_WORLD`, the file's last record, present only when an actor has a
triangle) is a tree over the actors' boxes whose entries stand where triangles do and lie in its tree's
leaf order, each naming its actor by rank: the low and the high corner of an actor's box and the low
corner again (nine `f32`), the actor's rank among the actors' records (the cluster word), zero (the
triangle word) and the actor's HLOD cell (the tag). The reader refuses a file whose entry names an actor
the file lacks, or a cell other than its actor's, a directory whose flags are not the world's alone, and
a cell word in a record that is no actor's. A voxel actor has no record: its clusters hold a box's
corners, no surface.

A ray enters an HLOD actor only where the cut draws its cell this frame. The runtime keeps for it,
beside the records and the placements' table, one word for each HLOD cell of each instance of the world
DAG: its top bit says the cut draws the cell's actor, and under it stands the rank, plus one, of the
object a hit on the actor is told by (zero for an actor with none, which a hit names `NO_INDEX`, as a
miss does).

The manifest's `rayTracing` section names the file and its size:

```json
{ "rayTracing": { "version": 7, "file": "rayTracing.bin", "bytes": 2672 } }
```

A scene none of whose primitives nor actors has a triangle in its cut writes neither the file nor the
section. Constants: `RAY_TRACING_VERSION`, `RAY_TRACING_FLAT_VERSION`, `RAY_TRACING_MAGIC`,
`RAY_TRACING_HEAD_BYTES`, `RAY_TRACING_RECORD_BYTES`, `RAY_TRACING_NODE_BYTES`,
`RAY_TRACING_VERTEX_BYTES`, `RAY_TRACING_INDEXED_TRIANGLE_BYTES`, `RAY_TRACING_TRIANGLE_BYTES`,
`RAY_TRACING_WIDTH`, `RAY_TRACING_LEAF_TRIANGLES`, `RAY_TRACING_LEAF_COUNT_SHIFT`,
`RAY_TRACING_LEAF_OFFSET_MASK`, `RAY_TRACING_CORNER_BYTES`, `RAY_TRACING_MASK_CORNER_BYTES`,
`RAY_TRACING_FLAG_*`, `RAY_TRACING_NO_PRIMITIVE`, `RAY_TRACING_STACK`, `RAY_TRACING_MIN_EXPONENT`
(`packages/sdk-core/src/contracts/rayTracingAbi.ts`).

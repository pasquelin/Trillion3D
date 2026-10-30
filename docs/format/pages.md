# Pages

Index pages (`u32` indices, concatenated in bundles) and `WGP3` geometry pages, quantized clusters. A
geometry page lives in two forms. ON DISK (format 12, `VERSION`) it is what the compiler writes, the
containers hold and the browser reads: its triangles are strips, the vertices it shares with other
clusters are references to them, every other attribute a stream of deltas, split in byte planes
([On disk](#on-disk)). RESIDENT (format 10, `RESIDENT_VERSION`) it is what the geometry pool holds and
the shaders read in place, each field of every stream at its own width: the install passes of the
engine transcode the first into the second as the page lands in its slot, on the GPU. The first
pass, one workgroup a page, unpacks the strips and writes every field of the vertices the page
stores; the second, a level of pages a dispatch, copies the vertices a page names from the clusters
that hold them, once those are installed — the pages whose references are installed first. The two
sizes differ: the page assignment fills a streaming page by the RESIDENT bytes, the bundles lay the
pages by their bytes on disk, and a page's record names both (`geometry.bytes`,
`geometry.residentBytes`) and where it lies in the pool's place of its streaming page
(`geometry.residentOffset`). A bundle is stored in its container compressed alone by raw DEFLATE
(RFC 1951, no header, the best level) when that is strictly smaller than its pages end to end, and
as they are otherwise: its `offset`, `bytes` and `sha256` are those of the stored bytes, its
`decodedBytes`, named only when it is compressed (the manifest binary's `bundleDecodedBytes` column,
0 otherwise), the pages' once inflated, and a page's `streamOffset` and `geometry.bytes` count in the
inflated bundle. The browser reads a bundle by one HTTP Range, checks its digest, then inflates a
compressed one with `DecompressionStream('deflate-raw')`; the server never compresses a container,
which a Range reads.
A page holds at most `MAX_PAGE_TRIANGLES` (128) triangles on
`MAX_PAGE_VERTICES` (256) vertices laid: a cluster's.

- Versions: `VERSION`, `RESIDENT_VERSION`, `HEADER_WORDS`, `DISK_HEADER_WORDS`, `STRIP_REF_BITS`,
  `REF_PLACE_BITS`, `SELF_PLACE`, `NO_UNIT` (`codec/lib.rs`), printed into
  `GEOMETRY_PAGE_FORMAT_VERSION`, `GEOMETRY_PAGE_RESIDENT_VERSION` and the other constants of
  `core/page/format.ts` (`pnpm run generate:shared-rules`), declared by the manifest's `geometryPages`.
  Format 10 wrote the page on disk as delta streams; format 11 writes its triangles as strips and
  the vertices it shares with other clusters as references; format 12 carries up to eight texture
  sets (`MAX_UV_SETS`, the glTF `TEXCOORD_0` to `TEXCOORD_7`), the ranges of those past the fourth in
  an extension of the header ([Resident](#resident)): a reader refuses a page of any other format,
  and a cache whose manifest binary is of another version. The resident layout is format 10's streams
  behind a table of their offsets (`GEOMETRY_PAGE_RESIDENT_VERSION` 11, [Resident](#resident)): a cache
  compiled before it holds `residentBytes` too small by the table: the manifest binary's version (21)
  says so, a reader refuses the file and the compiler cooks it again.
- Writes `codec/encode.rs:encode_deformed`, the one encoder, which lays a cluster's triangles in
  strips in their order (`codec/clusters/strip.rs:strips_in_order`), gathers the values of every
  field (`codec/streams.rs`) and writes the cluster alone on disk (`codec/refs.rs:alone`,
  `codec/disk.rs:write`), naming only the vertices a strip lays twice: the compiler's
  `rust/compiler/pages/record.rs:encode_page`, `rust/hlod/chain/pages.rs:encode_pages` and
  the run-time cut (`browser/geometry/codec/encodeGeometryPage.ts`, `codec/wasm/encode.rs`) call it; the
  grid, one a primitive (`codec/bits/grid.rs:PageGrid::of`, `rust/geometry_page/quant.rs:page_grid`).
  Once the streaming pages are assigned, `rust/compiler/pages/bundles/lay.rs:lay_bundles` writes the
  clusters of each again in the order they lie in it, each naming the vertices the earlier ones store
  and, where its page is relative (`rust/compiler/pages/bundles/relative.rs`), those of the clusters
  of the pages it depends on directly (`codec/refs.rs:share`).
  The install passes are `browser/geometry/pages/install/transcodeWgsl.ts` (`PAGE_TRANSCODE_WGSL`,
  `PAGE_LINK_WGSL`), run by `browser/geometry/pages/install/installer.ts` from
  `browser/geometry/pages/pool/commit.ts`; their CPU twin is `codec/resident.rs:expand_in`, the
  resident layout's one writer (`resident::write`), which the tests compare the passes to
  (`browser/geometry/codec/geometryPage.ts:residentGeometryPage`).
- Reads `browser/geometry/cluster/pages.ts:fetchVerified`, `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`,
  `codec/disk.rs:read_raw` (the gate of a page on disk), `codec/disk.rs:read` and `read_in` (the
  vertices it names found), `codec/unpack.rs:decode`, `browser/geometry/cluster/decodeWgsl.ts` (the
  resident page).

## On disk

A page on disk (format 12) is, in order: the 23 header words of the resident page — their version
word the disk's, their vertex count the vertices LAID —, the morph targets' records, the ranges of the
texture sets past the fourth ([Resident](#resident)), the
`DISK_HEADER_WORDS` (12) words, the strips, the references, the three byte planes (each closed on a
word) and the raw words of the skin and the morph targets, which the pass copies as they are.

The `DISK_HEADER_WORDS` words are: how many vertices the page names; how many pairs of clusters it
names them in; the vertices the strips NAMED and the vertices they LAID before the second, third and
fourth word of 32 triangles — ten bits each, the total of the first word lowest —; then the byte the
distances start at, the pairs, the bits that say which vertices are named, the vertices named, the
three planes and the raw words, from the page's first.

**The strips.** A cluster's triangles are laid in strips (`strip.rs`, the module doc), a vertex
reused named by how far back among the vertices laid so far it was laid, `STRIP_WINDOW` (32) at
most: a vertex further back is laid again, so a vertex can be laid twice and the vertices laid
outnumber the cluster's; a cluster whose merged vertices (those that quantize alike) lay more than
`MAX_PAGE_VERTICES` is laid again with them kept apart, as the cluster came. The page holds, per 32 triangles — `MASK_GROUPS` (4) groups of them, the
most a page holds, the bits past its last triangle zero —, three words of one bit a triangle — S, a
strip starts; L, a start naming two or three vertices, or a growth to the left; W, a start naming one
or three vertices, or a growth naming its third —, then, in triangle order, one distance of
`STRIP_REF_BITS` (5) bits for each vertex a triangle names, closed on a word. A start names 0 to 3
vertices (L and W their count, two bits), which come first, and lays the others after them; a growth
names at most its third vertex, the other two being the edge it grew across. The two words of counts
give the place of a triangle in the code from its own word alone (`unpack_triangle`, read the same
by `PAGE_TRANSCODE_WGSL`, a lane a triangle). The vertices of the page are numbered in the order
they are laid, and so are the resident page's, whose corners are the triangles unpacked: the
resident triangle order is the order of the strips (every triangle in the order the cluster lists
it, each turned to the corner its strip lays it from), where it was the cluster's own and the
vertices numbered by first use.

**The references.** A vertex of a page is NAMED when another cluster holds a vertex that quantizes
alike on the same grids — the same precisions, the same attributes — : in a cluster of a streaming
page this page depends on, in an earlier cluster of its own streaming page that stores it, or
earlier in the very page, a vertex a strip laid twice (`refs.rs`, the module doc: the order of the
search). The page then stores no field of it, only where to find it. A PAIR names a cluster: its
streaming page's rank in the page's list of dependencies — the closed list its bundle carries,
`streams.pages[].dependencies`, from 1; 0 for its own — above, in `REF_PLACE_BITS` (24) bits, the
words from the start of that streaming page's place in the pool to the cluster's resident page
(`geometry.residentOffset`); `SELF_PLACE` names the page itself. The page holds its pairs, each
once, ascending; one bit a vertex, set for a vertex it names; and, for each vertex named, in vertex
order, the rank of its cluster's pair, a byte, then its index in that cluster, a byte as the
zig-zag delta (shortest-wrapped to a byte) to the index before it. A page names the vertices of
the pages it depends on only when it is RELATIVE (`rust/compiler/pages/bundles/relative.rs`): a
page of the cover's roots never is — it is always resident, the root of its chains —, a page whose
dependencies are root pages alone always is, any other is unless it has `MAX_RELATIVE_CHAIN` (6)
levels of relative pages below it, counted from the finest, which stores its vertices instead and
starts the count again: no chain of pages installed one after the other is longer. A streaming
page ranked past `MAX_PAIR_RANK` (255) in the list, the most a pair holds, is not searched: its
vertices are stored.

**The fields.** Every field of a vertex the page stores — all but those it names — is the DIFFERENCE
to the field before it in its stream (`disk.rs:put`): the delta wrapped to the field's own width,
the shortest way round its cells (`shortest_wrap`: a field of `b` bits takes the delta as the signed
`b`-bit number it is congruent to), its sign folded into its low bit (`encode_zigzag`: 0, -1, 1, -2
as 0, 1, 2, 3), and its bytes spread over the planes — the low byte of every value in the first, the
middle byte in the second, the high in the third; a value of one byte lies in the first plane alone,
of three in all of them. A value takes as many bytes as the widest component of its stream needs
(`ceil(bits / 8)`). A stream's components lie together per field — `x`, `y`, `z`, `x`, `y`, `z` —,
its streams one after the other in each plane, in this order: the links, of every vertex, when the
page stores each position once (one component, `bits_for(positions - 1)` bits); the positions (three
components) — the whole table of such a page, else those of the vertices the page stores —; the
normals (two), the tangents, the colours (four, a byte each, none where all four widths are zero)
and each texture set present (two), of the vertices the page stores. The first delta of a position
is counted from the middle of its cells (`2^(bits-1)`), the first of every other stream from zero.
A reader sums the deltas and masks each sum to the field's width (`disk.rs:get`), which gives back
the cell, the octahedral cell, the colour byte above its least, the texture code above its least.
Where each section and each stream start follows from the header's counts and widths and the code's
counts, never from the page (`DiskLayout::of`); the words after the header name them and must
match.

**The passes.** The first pass writes, for each vertex the page stores, every field at the vertex's
own place in the resident streams, and zero in the places of the vertices it names. The second reads
each vertex named — the cluster of its pair is found at the start of its streaming page in the pool
(its own, or the one of its rank in the list of dependencies the page was installed with) plus the
words of the pair —, and writes its fields in the page's own grid: a position cell, a colour byte,
a texture code moved from the cluster's range to the page's. The second pass runs a LEVEL a
dispatch: the pages of a batch that name no vertex need no second pass; each of the others installs
a level after the last level of the staged streaming pages its pairs name — the ranks they hold,
not the whole list of dependencies; the first level for a page that names only its own streaming
page or itself —, so that every cluster it names is complete, those of its own streaming page by
the first pass alone: they are only vertices it stores. A chain longer than the levels one submit
holds (`PAGE_INSTALL_LEVELS`, 16) is submitted in turns; no compiled page makes one. A page the
first pass finds wider than its room is left unwritten but for its version word, zeroed, which the
second pass reads as "not installed". A cluster of a streaming page not resident gives no vertex:
the engine installs a page after every page its list names (`dependencies.rs`).

**Bytes.** On the formulas of the first version of format 10, for a page of 128 triangles on 75
vertices — positions stored once at 11, 11 and 10 bits, normals at 8 bits, one texture set of 12 and
12 bits, the corner blocks of the resident page averaging 4 bits a corner —: resident, the same
before and after, `92 + 4 · 230 = 1012` bytes; on disk, format 10, `92 + 16 + 912 + 376 = 1396`
bytes (corner, position, normal and texture planes). In format 11, laid in 4 strips (the least the
32-triangle runs allow) on 75 vertices laid, one page alone: `92` header, `48` disk header words,
`48` masks (4 words of 3), `40` distances (61 vertices named by the strips, 5 bits each), `12` bytes
of bits that say which vertices are named, then the planes of the 75 vertices stored — `528 + 376` —: `1144` bytes, 18% less
than format 10's, 13% over the resident page. With half its vertices named (38 stored, 2 pairs):
`92 + 48 + 48 + 40 + 8 + 12 + 76` (the 37 vertices named, two bytes each) `+ 268 + 192` (the planes
of the 38 stored) = `784` bytes, 44% less than format 10's and 22.5% under the resident page.
These are the formulas' numbers, measured on none: `geometry.bytes` against
`geometry.residentBytes` of a cooked scene's `clusters.json` pages gives the sums.

The gate of a page on disk (`disk::read_raw`, `Header::parse`, checked once on arrival,
`page_check`) refuses, before reading any stream, a header outside the format's bounds, a count
outside the page's (`MAX_PAGE_*`), a length that is not the counts', a section named elsewhere, a
strip that lays other vertices than the header's count or that has a bit past its last triangle, a
pair that is not above the one before it and a rank past the pairs; and after it, a corner past the
vertices (`GEOMETRY_PAGE_INDEX`), a link past the stored positions, a corner stream whose blocks do
not take the bits the header says and a raw float that is not finite. A page whose references find
nothing — a pair that names no cluster of the pool, a vertex past a cluster's, a vertex that does
not fit this page's grids — is refused when it is made whole (`GEOMETRY_PAGE_REFS`).

## Resident

- Format 9 puts every attribute on a grid of its own, named by the header (`HEADER_WORDS`, 23 words,
  then the morph targets' records and the extension of format 12, below):
  word 5 the position widths, six bits an axis, and the position precision as the signed top byte;
  words 6 to 8 the least cell of each axis, signed; words 9 to 16 the first four texture sets' ranges, two
  words a set, `min << 5 | bits` for `u` then `v`; word 17 the least byte of each colour channel,
  red lowest; word 18 the colour channels' widths, four bits each from bit 0, then the normal
  precision from bit 16 and the tangent precision from bit 20; word 19 the corner bits; word 20 the
  positions stored; word 21 the skin and morph record; word 22 the skin influences. No word holds an
  error: nothing adds a page's rounding to a cluster's error.
- The table of offsets (`RESIDENT_TABLE_WORDS`, 15 words) closes the header, the morph records and the
  extension, and the streams follow it. It holds the word offset, from the page's first word, of
  every stream a shader reads, two to a word, 16 bits each, the first in the low half, in this order:
  the block table, the corners, the three positions, the links, the two normals, the two streams of
  each of the eight texture sets, the four colours, the tangents, the skin
  (`Layout::table`, `clusterTableWord`). A stream the page does not carry has the offset it would
  start at. The install pass writes it from the page on disk's counts and widths
  (`clusterDiskHeader`); a shader loads the offsets it needs (`clusterOffsets`) and recomputes none,
  and the morph targets' records count from the first word behind the table. A page of the format's
  bounds never passes 65535 words (at most 9 829, a header of at most 2 341 included: `MAX_TABLE_OFFSET`, proved
  at compile time in `attributes.rs`), and the install pass refuses a page whose table would; the gate refuses a
  table that is not the layout's.
- Positions are cells of `2^-precision` centimetre. A vertex's cell on an axis is
  `floor((p · 100) · 2^precision + 0.5)`, in `f32` (`codec/bits/quant.rs:rounded_cell`); the page keeps
  the least cell of each axis and, per vertex, its cell above it in the widths of word 5 (at most 21
  bits, `MAX_POSITION_BITS`). A reader converts `start + offset` to `f32` and multiplies it by
  `unit = 2^-precision · (1/100)`, the hundredth rounded to `f32` once (`PositionGrid::metres`;
  `clusterUnit`, `clusterPosition`): the conversion is exact up to 2^24 cells, past which a device
  may round it its own way. The precision is the primitive's, one for all its pages, so that a
  vertex two clusters share is one cell in every page: `meshBuild.positionPrecision` where the mesh
  names it, else seven less the mean of the base-2 logarithms of the finest clusters'
  half-diagonals in centimetres, rounded, and at least 4 (`AUTO_MIN_POSITION_PRECISION`); held to
  −20 to 43, then lowered until each cluster spans at most 21 bits an axis, and the compile refuses
  a cluster too wide for −20 (`PAGE_ATTRIBUTE_RANGE`).
- Normals are two cells of `normal_precision` bits (1 to 15, 8 by default,
  `meshBuild.normalPrecision`), two streams, `x` then `y`: the octahedral map's point, of the four
  cells around it the one whose decoded direction lies closest (`codec/bits/oct.rs:normal_code`,
  each dot's two low bits replaced by the cell's rank, so that near ties go to the later cell). The
  decode takes each cell times `2/(2^bits − 1)` less one, `z` one less their magnitudes, unfolds
  the lower half by what `z` lacks of zero, and makes the vector unit (`normal_decode`,
  `octCellsDecode`).
- Tangents (`FLAG_TANGENT`) are set only on a page whose mesh stores them (`meshBuild.storedTangents`,
  [docs/COMPILER.md](../COMPILER.md)) and always with `FLAG_NORMAL`. Their stream follows the colour's:
  one field of `tangent_precision + 1` bits per vertex (`tangent_precision` 0 to 12, 7 by default,
  `meshBuild.tangentPrecision`): the tangent's angle around the vertex's decoded normal in
  `2^tangent_precision` steps of a turn and above it the bit of a negative bitangent sign
  (`codec/bits/oct.rs:tangent_code`). The angle is measured in the plane the normal fixes: `x` and `z`
  traded when `|z| > |x|`, the axis `(−y, x, 0)`, the normal crossed with it; the decode keeps the
  axis as it is and scales the cosine and the sine by its inverse length. A vertex whose tangent
  names no angle repeats the code of the vertex before it. It decodes to four floats, the unit
  tangent then `±1` (`clusterTangent`).
- Colour is four channels of 8-bit bytes (`color_byte`: the value held within [0, 1], times 255,
  plus a half, truncated), each channel with its least byte and the bits above it, none for a
  channel constant on the page; the least is lowered where the greatest offset its bits hold
  (`2^bits − 1`) would pass 255, which the header's gate refuses (`ColorRange::unpack`). It decodes as the byte times `1/255` in `f32` (`color_value`,
  `clusterColor`).
- Texture coordinates are up to `MAX_UV_SETS` (8) sets, `FLAG_UV` to `FLAG_UV7`,
  each two streams, `u` then `v`, of float codes of 20 bits: a sign, a 5-bit exponent and a 14-bit
  mantissa, the code's order the value's (`codec/bits/quant.rs:uv_code`, `uv_value`; `clusterUvValue`).
  A page stores per coordinate the least code and the bits above it, the least lowered where the
  greatest offset those bits hold would pass the greatest code (`UvRange::unpack`). A material reads a map at the
  set its `texCoord` names (`channelsOf`, `MAP_CHANNEL_BITS` (3) bits a map).
- Format 12 holds the ranges of the sets past the fourth (`HEADER_UV_SETS`) in an extension after
  the morph targets' records: `UV_EXTENSION_WORDS` (2) words, one per coordinate, for each of those
  sets whose flag is set, in set order (`Header::extended_sets`, `clusterSurfaceHeader`). A page of
  four sets or fewer has no extension and is the bytes it was in format 11, but for its version
  word; a page of eight pays 8 words (32 bytes) of header and the two streams of each of the
  sets, no more than a page of four pays for its own.
- Streams, in `Layout::of` order: the block table, the corners, positions `x`, `y`, `z`, the links,
  the two normal streams, each set's `u` and `v`, the four colour channels, the tangents, then the
  skin and the morph targets. The install pass writes the block of each eight triangles — its least
  corner, the width of the distances to it, the widths of the blocks before it — and the corner
  stream from the corners it read, and each stream's words whole, so that the bits past a stream's
  last field are zero: the bytes it writes are `resident::write`'s.

## Voxels

A voxelized mesh's far levels — the per-mesh far field (`rust/voxel`,
[COMPILER.md](../compiler/voxels-far-away.md#voxels-far-away)) — are `voxels.bin` (version 4, the manifest's `voxels`
section): a head — `T3VX`, the version, the group
and brick counts —, a 48-byte record per group (its primitive, `u32::MAX` for a mesh's far group;
its DAG group or compiled mesh; first brick and count; first voxel and count; its error, the error
it is replaced at and its voxels' side as `f32`; its first brick's corner, `f32` × 3), 16-byte bricks
(mask `u64`, bit `x + 4y + 16z`; corner in bricks from the group's first, `u16` × 3; joint `u16`,
`0xFFFF` none), 12-byte voxels in each brick's mask order (sRGB base colour and a zero; occlusion,
roughness, metalness and a zero; normal, octahedral: the axis of the fitted
distribution of the normals (`voxelNdf`), else the direction of their mean; the ratio of the fitted
distribution's two widths, from which the resolve draws each pixel's shading normal, else zero; a
zero): what the runtime reads of a voxel, no more. Version 4: a voxel's coverage and material stay in the compiler, and a
page's brick holds the rank of its first voxel. The runtime joins a group's bricks to its DAG as
pages.

A voxel page (`T3VP`, the pool's words read in place by `browser/visibility/shader/voxelWgsl.ts`):
six words — magic, voxel count and, in the high half, brick count, the corner (`f32` × 3), the
voxels' side —, five words per brick (the file's 16-byte brick as it is: mask, corner in bricks
`u16` × 3, joint `u16`; then the rank in the page of its first voxel, so a voxel's rank is one read
and a popcount), three words per voxel (its file record), the bricks' voxels in turn. At most 21
bricks: each draws its box, 8 corners and 12 triangles, so the visibility identifier names the box
triangle and the resolve traces the voxel from it. A page's geometry descriptor carries
`GEOMETRY_VOXEL` (`0x100`), 8 vertices and 36 indices a brick.

- Versions: `VOXEL_VERSION` (`rust/voxel.rs`); the page constants `VOXEL_PAGE_MAGIC`,
  `VOXEL_PAGE_HEAD_WORDS`, `VOXEL_BRICK_WORDS`, `VOXEL_PAGE_BRICKS`, `VOXEL_BRICK_CORNERS`,
  `VOXEL_BRICK_TRIANGLES`, `GEOMETRY_VOXEL`
  (`codec/voxel.rs`), printed into `core/contracts/writtenFormats.ts`.
- Writes `rust/voxel/stage.rs:stage_voxels`, `rust/voxel/page.rs:voxel_dag` through
  `codec/voxel.rs:encode_voxel_page`;
  `core/page/voxelPage.ts:encodeVoxelPage` lays a group's bricks out as pages at run time.
- Reads `core/contracts/voxel.ts:decodeVoxelFile`, `core/page/voxelJoin.ts:joinVoxelLevels`,
  `core/page/voxelPage.ts:checkVoxelPage`, `browser/visibility/shader/voxelWgsl.ts`.

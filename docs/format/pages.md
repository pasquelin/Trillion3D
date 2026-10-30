# Pages

Index pages (`u32` indices, concatenated in bundles) and `WGP3` geometry pages, quantized clusters. A
geometry page has two forms:

- ON DISK (format 12, `VERSION`): compiler output, held by containers. Triangles are strips; vertices
  shared with other clusters are references; every other attribute a delta stream split in byte planes
  ([On disk](#on-disk)).
- RESIDENT (format 10, `RESIDENT_VERSION`): held by the geometry pool, read in place by shaders, each
  field of every stream at its own width. Install passes transcode disk to resident on GPU. Pass 1 (one
  workgroup a page) unpacks strips and writes every field of the vertices the page stores. Pass 2 (a
  level of pages a dispatch) copies vertices a page names from the clusters holding them.

Page assignment fills a streaming page by RESIDENT bytes, bundles lay pages by disk bytes; a page
record names both (`geometry.bytes`, `geometry.residentBytes`) and its place in its streaming page's
pool place (`geometry.residentOffset`). A bundle is stored raw-DEFLATE compressed (RFC 1951, no header,
best level) when strictly smaller than its pages end to end, else as is: `offset`, `bytes`, `sha256` are
of the stored bytes; `decodedBytes` (named only when compressed; manifest binary `bundleDecodedBytes`,
0 otherwise) is the inflated pages'; `streamOffset` and `geometry.bytes` count in the inflated bundle.
The browser reads a bundle by one HTTP Range, checks its digest, inflates with
`DecompressionStream('deflate-raw')`; the server never compresses a container. A page holds at most
`MAX_PAGE_TRIANGLES` (128) triangles on `MAX_PAGE_VERTICES` (256) vertices laid.

- Versions: `VERSION`, `RESIDENT_VERSION`, `HEADER_WORDS`, `DISK_HEADER_WORDS`, `STRIP_REF_BITS`,
  `REF_PLACE_BITS`, `SELF_PLACE`, `NO_UNIT` (`codec/lib.rs`), printed into
  `GEOMETRY_PAGE_FORMAT_VERSION`, `GEOMETRY_PAGE_RESIDENT_VERSION` and other constants of
  `core/page/format.ts` (`pnpm run generate:shared-rules`), declared by the manifest's `geometryPages`.
  Format 10: disk page as delta streams; 11: triangles as strips, shared vertices as references; 12: up
  to eight texture sets (`MAX_UV_SETS`, glTF `TEXCOORD_0` to `TEXCOORD_7`), ranges past the fourth in a
  header extension ([Resident](#resident)). A reader refuses any other page format and any cache whose
  manifest binary has another version. Resident layout is format 10's streams behind an offsets table
  (`GEOMETRY_PAGE_RESIDENT_VERSION` 11, [Resident](#resident)); an earlier cache (manifest binary
  version 21) is refused and recooked.
- Writes `codec/encode.rs:encode_deformed`, the one encoder: strips
  (`codec/clusters/strip.rs:strips_in_order`), field values (`codec/streams.rs`), cluster alone on disk (`codec/refs.rs:alone`,
  `codec/disk.rs:write`). Callers: `rust/compiler/pages/record.rs:encode_page`,
  `rust/hlod/chain/pages.rs:encode_pages`, run-time cut (`browser/geometry/codec/encodeGeometryPage.ts`,
  `codec/wasm/encode.rs`); grid one a primitive (`codec/bits/grid.rs:PageGrid::of`,
  `rust/geometry_page/quant.rs:page_grid`). After streaming pages are assigned,
  `rust/compiler/pages/bundles/lay.rs:lay_bundles` rewrites each page's clusters in in-page order,
  naming vertices earlier ones store and, where its page is relative
  (`rust/compiler/pages/bundles/relative.rs`), those of pages it directly depends on
  (`codec/refs.rs:share`). Install passes: `browser/geometry/pages/install/transcodeWgsl.ts`
  (`PAGE_TRANSCODE_WGSL`, `PAGE_LINK_WGSL`), run by `browser/geometry/pages/install/installer.ts` from
  `browser/geometry/pages/pool/commit.ts`; CPU twin `codec/resident.rs:expand_in`, the resident
  layout's one writer (`resident::write`), compared in tests
  (`browser/geometry/codec/geometryPage.ts:residentGeometryPage`).
- Reads `browser/geometry/cluster/pages.ts:fetchVerified`,
  `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`, `codec/disk.rs:read_raw` (disk page
  gate), `codec/disk.rs:read` and `read_in`, `codec/unpack.rs:decode`,
  `browser/geometry/cluster/decodeWgsl.ts` (resident page).

## On disk

Format 12 page, in order: the resident page's 23 header words (version word = disk's, vertex count =
vertices LAID), morph targets' records, ranges of texture sets past the fourth
([Resident](#resident)), the `DISK_HEADER_WORDS` (12) words, strips, references, three byte planes
(each closed on a word), raw skin and morph-target words.

`DISK_HEADER_WORDS`: vertices the page names; pairs of clusters naming them; vertices the strips NAMED
and LAID before the 2nd, 3rd, 4th word of 32 triangles (ten bits each, the first word's total lowest);
byte offsets, from the page's first, of: distances, pairs, named-vertex bits, vertices named, the three
planes, raw words.

**The strips** (`strip.rs`). A reused vertex is named by how far back among vertices laid it was laid,
`STRIP_WINDOW` (32) at most; farther back is laid again. A cluster whose merged vertices lay more than
`MAX_PAGE_VERTICES` is laid again with them kept apart. Per 32 triangles (`MASK_GROUPS` (4) groups at
most, bits past the last triangle zero), three words of one bit a triangle:

- S: a strip starts;
- L: a start naming two or three vertices, or a growth to the left;
- W: a start naming one or three vertices, or a growth naming its third;

then, in triangle order, one `STRIP_REF_BITS` (5)-bit distance per vertex a triangle names, closed on a
word. A start names 0 to 3 vertices (L and W give the count), which come first; a growth names at most
its third vertex. The count words give a triangle's code place from its own word alone
(`unpack_triangle`, same in `PAGE_TRANSCODE_WGSL`, a lane a triangle). Page vertices are numbered in
laid order; resident triangle order is strip order.

**The references.** A page vertex is NAMED when another cluster holds a vertex quantizing alike on the
same grids: in a cluster of a streaming page this page depends on, in an earlier cluster of its own
streaming page that stores it, or earlier in the same page (`refs.rs` module doc: search order). The
page stores only where to find it. A PAIR names a cluster: its streaming page's rank in the page's
dependency list (`streams.pages[].dependencies`, from 1; 0 own) above, in `REF_PLACE_BITS` (24) bits,
the words from that streaming page's pool place start to the cluster's resident page
(`geometry.residentOffset`); `SELF_PLACE` names the page itself. The page holds its pairs, each once,
ascending; one bit per vertex, set for a named one; per named vertex, in vertex order, its cluster's
pair rank (a byte) then its index in that cluster (a byte: zig-zag delta, shortest-wrapped, to the
previous index).

A page names vertices of pages it depends on only when RELATIVE
(`rust/compiler/pages/bundles/relative.rs`): a page of the cover's roots never is; a page depending on
root pages alone always is; any other is, unless it has `MAX_RELATIVE_CHAIN` (6) levels of relative
pages below it (counted from the finest), and then stores its vertices and restarts the count. A
streaming page ranked past `MAX_PAIR_RANK` (255) in the list is not searched: its vertices are stored.

**The fields.** Every stored-vertex field is the DIFFERENCE to the previous field in its stream
(`disk.rs:put`): delta wrapped to the field's width (`shortest_wrap`: a `b`-bit field takes the signed `b`-bit congruent number), sign folded into the low bit
(`encode_zigzag`: 0, -1, 1, -2 as 0, 1, 2, 3), bytes spread over planes (low byte in the first, middle
in the second, high in the third). A value takes `ceil(bits / 8)` bytes of its stream's widest
component. Components lie together per field (`x`, `y`, `z`, `x`, `y`, `z`); streams lie one after
another in each plane, in this order:

1. links, of every vertex, when the page stores each position once (one component,
   `bits_for(positions - 1)` bits);
2. positions (three components): the whole table of such a page, else the stored vertices';
3. normals (two), tangents, colours (four, a byte each, none where all four widths are zero) and each
   present texture set (two), of stored vertices.

A position's first delta counts from the cells' middle (`2^(bits-1)`); every other stream's from zero.
The reader sums deltas and masks to field width (`disk.rs:get`). Section and stream starts follow from
header counts/widths and code counts (`DiskLayout::of`); the words after the header must match.

**The passes.** Pass 1 writes, per stored vertex, every field in the resident streams, and zero at
named vertices' places. Pass 2 reads each named vertex (its pair's cluster is at the start of its
streaming page in the pool, own or the one at its rank in the dependency list the page was installed
with, plus the pair's words) and writes its fields in the page's grid: position cell, colour byte,
texture code. Pass 2 runs a LEVEL a dispatch: pages naming no vertex need none; each other installs one
level after the last level of staged streaming pages its pairs name (first level for a page naming
only its own streaming page or itself). A chain longer than `PAGE_INSTALL_LEVELS` (16) is submitted in
turns. A page pass 1 finds wider than its room is left unwritten but for a zeroed version word, which
pass 2 reads as "not installed". The engine installs a page after every page its list names
(`dependencies.rs`).

**Bytes.** Formulas of format 10's first version, page of 128 triangles on 75 vertices (positions
stored once at 11, 11, 10 bits, normals 8 bits, one texture set of 12 and 12 bits, resident corner
blocks averaging 4 bits a corner):

- resident, before and after: `92 + 4 · 230 = 1012` bytes;
- disk, format 10: `92 + 16 + 912 + 376 = 1396` bytes (corner, position, normal, texture planes);
- format 11, 4 strips, 75 vertices laid, page alone: `92` header, `48` disk header words, `48` masks (4
  words of 3), `40` distances (61 strip-named vertices, 5 bits each), `12` bytes of named-vertex bits,
  planes of the 75 stored (`528 + 376`): `1144` bytes, 18% under format 10, 13% over resident;
- half the vertices named (38 stored, 2 pairs): `92 + 48 + 48 + 40 + 8 + 12 + 76` (37 named, two
  bytes each) `+ 268 + 192` (planes of the 38 stored) = `784` bytes, 44% under format 10, 22.5% under
  resident.

Formula numbers, measured on none: `geometry.bytes` against `geometry.residentBytes` of a cooked
`clusters.json`'s pages gives the sums.

The disk-page gate (`disk::read_raw`, `Header::parse`, once on arrival, `page_check`) refuses, before
reading any stream: header outside format bounds; count outside the page's (`MAX_PAGE_*`); length not
the counts'; a section named elsewhere; a strip laying other vertices than the header's count or with a
bit past its last triangle; a pair not above the previous; a rank past the pairs. After it: corner past
the vertices (`GEOMETRY_PAGE_INDEX`); link past stored positions; corner stream whose blocks do not
take the header's bits; non-finite raw float. A page whose references find nothing (pair naming no pool
cluster, vertex past a cluster's, vertex not fitting this page's grids) is refused when made whole
(`GEOMETRY_PAGE_REFS`).

## Resident

- Header (`HEADER_WORDS`, 23 words, then morph targets' records and the format 12 extension): word 5
  position widths (six bits an axis) and position precision as signed top byte; words 6-8 least cell
  per axis, signed; words 9-16 first four texture sets' ranges, two words a set, `min << 5 | bits` for
  `u` then `v`; word 17 least byte of each colour channel, red lowest; word 18 colour channel widths
  (four bits each from bit 0), normal precision from bit 16, tangent precision from bit 20; word 19
  corner bits; word 20 positions stored; word 21 skin and morph record; word 22 skin influences. No
  word holds an error.
- Offsets table (`RESIDENT_TABLE_WORDS`, 15 words) closes the header, morph records and extension;
  streams follow. It holds each shader-read stream's word offset from the page's first word, two to a
  word, 16 bits each, first in the low half, in this order: block table, corners, three positions,
  links, two normals, two streams of each of the eight texture sets, four colours, tangents, skin
  (`Layout::table`, `clusterTableWord`). A stream the page lacks has the offset it would start at. The
  install pass writes it from the disk page's counts and widths (`clusterDiskHeader`); a shader loads
  offsets (`clusterOffsets`); morph records count from the first word behind the table. A page within
  format bounds never passes 65535 words (at most 9 829, header up to 2 341 included:
  `MAX_TABLE_OFFSET`, proof in `attributes.rs`); install refuses a page whose table would; the gate
  refuses a table that is not the layout's.
- Positions: cells of `2^-precision` centimetre. A vertex's cell on an axis is
  `floor((p · 100) · 2^precision + 0.5)` in `f32` (`codec/bits/quant.rs:rounded_cell`); the page keeps
  the least cell per axis and, per vertex, its cell above it in word 5's widths (at most 21 bits,
  `MAX_POSITION_BITS`). Reader: `start + offset` to `f32` times `unit = 2^-precision · (1/100)`
  (`PositionGrid::metres`; `clusterUnit`, `clusterPosition`): exact to 2^24 cells. Precision is the
  primitive's: `meshBuild.positionPrecision` where named, else seven minus the mean base-2 log of the
  finest clusters' half-diagonals in cm, rounded, at least 4 (`AUTO_MIN_POSITION_PRECISION`); held to
  −20..43, then lowered until each cluster spans at most 21 bits an axis; compile refuses a cluster too
  wide for −20 (`PAGE_ATTRIBUTE_RANGE`).
- Normals: two cells of `normal_precision` bits (1 to 15, 8 default, `meshBuild.normalPrecision`), two
  streams `x` then `y`: the octahedral map's point; the closest decoded of the four surrounding cells
  (`codec/bits/oct.rs:normal_code`, each dot's two low bits replaced by the cell's rank). Decode: each
  cell × `2/(2^bits − 1)` − 1, `z` = 1 − their magnitudes, lower half unfolded, normalized
  (`normal_decode`, `octCellsDecode`).
- Tangents (`FLAG_TANGENT`): only on a page whose mesh stores them (`meshBuild.storedTangents`,
  [docs/COMPILER.md](../COMPILER.md)), with `FLAG_NORMAL`. Stream follows the colour's: one
  `tangent_precision + 1`-bit field per vertex (`tangent_precision` 0 to 12, 7 default,
  `meshBuild.tangentPrecision`): tangent angle around the decoded normal in `2^tangent_precision` turn
  steps, above it the negative-bitangent-sign bit (`codec/bits/oct.rs:tangent_code`). Angle measured in
  the plane the normal fixes: `x` and `z` swapped when `|z| > |x|`, axis `(−y, x, 0)`, normal crossed
  with it. A vertex whose tangent names no angle repeats the previous code. Decodes to four floats,
  unit tangent then `±1` (`clusterTangent`).
- Colour: four 8-bit channels (`color_byte`: value held in [0, 1], × 255, + half, truncated), each with
  least byte and bits above it, none for a page-constant channel; the least is lowered where the
  greatest offset its bits hold (`2^bits − 1`) would pass 255 (the header gate refuses it,
  `ColorRange::unpack`). Decodes as byte × `1/255` (`color_value`, `clusterColor`).
- Texture coordinates: up to `MAX_UV_SETS` (8) sets, `FLAG_UV` to `FLAG_UV7`, two streams each (`u`, `v`)
  of 20-bit float codes: sign, 5-bit exponent, 14-bit mantissa, code order = value order
  (`codec/bits/quant.rs:uv_code`, `uv_value`; `clusterUvValue`). A page stores per coordinate the least
  code and bits above it, the least lowered where the greatest offset would pass the greatest code
  (`UvRange::unpack`). A material reads a map at the set its `texCoord` names (`channelsOf`,
  `MAP_CHANNEL_BITS` (3) bits a map).
- Format 12 holds ranges of sets past the fourth (`HEADER_UV_SETS`) in an extension after morph records:
  `UV_EXTENSION_WORDS` (2) words, one per coordinate, per such set whose flag is set, in set order
  (`Header::extended_sets`, `clusterSurfaceHeader`). A page of four sets or fewer has no extension (its
  format 11 bytes but for the version word); a page of eight pays 8 header words plus two streams per
  extra set.
- Streams in `Layout::of` order: block table, corners, positions `x`, `y`, `z`, links, two normal
  streams, each set's `u` and `v`, four colour channels, tangents, skin and morph targets. The install
  pass writes each eight-triangle block (least corner, width of distances to it, widths of preceding
  blocks) and the corner stream, and each stream's words whole (bits past a stream's last field are
  zero): its bytes are `resident::write`'s.

## Voxels

A voxelized mesh's far levels (per-mesh far field, `rust/voxel`,
[COMPILER.md](../compiler/voxels-far-away.md#voxels-far-away)) are `voxels.bin` (version 4, manifest
`voxels` section): head (`T3VX`, version, group and brick counts), then:

- 48-byte record per group: its primitive (`u32::MAX` for a mesh's far group); DAG group or compiled
  mesh; first brick and count; first voxel and count; error, error it is replaced at and voxel side as
  `f32`; first brick's corner, `f32` × 3;
- 16-byte bricks: mask `u64`, bit `x + 4y + 16z`; corner in bricks from the group's first, `u16` × 3;
  joint `u16`, `0xFFFF` none;
- 12-byte voxels in each brick's mask order: sRGB base colour and a zero; occlusion, roughness,
  metalness and a zero; normal, octahedral (axis of the fitted normal distribution, `voxelNdf`, else the
  mean direction); ratio of the fitted distribution's two widths, else zero; a zero.

Version 4: coverage and material stay in the compiler; a page's brick holds its first voxel's rank. The
runtime joins a group's bricks to its DAG as pages.

A voxel page (`T3VP`, pool words read in place by `browser/visibility/shader/voxelWgsl.ts`): six words
(magic; voxel count with brick count in the high half; corner `f32` × 3; voxel side); five words per
brick (file's 16-byte brick as is, then its first voxel's rank in the page); three words per voxel (its
file record); the bricks' voxels in turn. At most 21 bricks: each draws its box (8 corners, 12
triangles). A page's geometry descriptor carries `GEOMETRY_VOXEL` (`0x100`), 8 vertices and 36 indices
a brick.

- Versions: `VOXEL_VERSION` (`rust/voxel.rs`); page constants `VOXEL_PAGE_MAGIC`,
  `VOXEL_PAGE_HEAD_WORDS`, `VOXEL_BRICK_WORDS`, `VOXEL_PAGE_BRICKS`, `VOXEL_BRICK_CORNERS`,
  `VOXEL_BRICK_TRIANGLES`, `GEOMETRY_VOXEL` (`codec/voxel.rs`), printed into
  `core/contracts/writtenFormats.ts`.
- Writes `rust/voxel/stage.rs:stage_voxels`, `rust/voxel/page.rs:voxel_dag` via
  `codec/voxel.rs:encode_voxel_page`; `core/page/voxelPage.ts:encodeVoxelPage` lays a group's bricks out
  as pages at run time.
- Reads `core/contracts/voxel.ts:decodeVoxelFile`, `core/page/voxelJoin.ts:joinVoxelLevels`,
  `core/page/voxelPage.ts:checkVoxelPage`, `browser/visibility/shader/voxelWgsl.ts`.

# Cache formats — where the code defines them

A compilation writes a cache folder; the SDK reads it. The code is the contract: each section names
a file, its version constants, the Rust that writes it and the TypeScript that reads it. A reader
refuses an unknown version before reading a field, never half-reads.

Paths: `rust/` is `packages/asset-compiler-rust/src/`, `codec/` `packages/page-codec-wasm/src/`,
`core/` `packages/sdk-core/src/`, `browser/` `packages/sdk-browser/src/`.

## The version rule

A file family's bytes for unchanged sources change only with a change of that family's version, the
constant each section below names (the per-format one: `WORLD_ROOTS_VERSION` for `world-roots.*`,
`MANIFEST_BINARY_VERSION` for the column files, and so on; `FORMAT_VERSION` for the pointer, the
source copy and what no family owns). A change of output with no version change leaves old and new
caches sharing a version with different bytes, which a reader cannot tell apart: bump the family's
version in the same change, with its fixtures. The `Compiler` workflow enforces it
(`scripts/native/compiler-hashes.ts`): the five platforms agree byte for byte; against `develop` a family
may differ only when its version differs too, listed `changed on purpose (name vN → vM)`, and a byte
change with no version change fails, naming the version to bump. `clusters.json`, the head page and
the content-addressed objects embed several families and are allowed by any version change.

## Layout

`native/<scope>/manifest.json`, the pointer, names `native/<scope>/<key>/`: `clusters.json`, its
pages and the products below. Shared objects are `native/objects/<sha256>.bin`, named by content
(`rust/compiler/cache/storage.rs:object_path`); every texture's level chain lives under `native/textures/v<N>/<sha>/`, one folder per chain source and sheet (`texture/gate.rs:GateSheet::key`), written once, pruned by folder
(`rust/compiler/cache/prune_textures.rs`).

## Pointer

`manifest.json`: status, format, key, scope (`slice` or `full`) and the URL of `clusters.json`.

- Versions: `FORMAT_VERSION` 11, `CLUSTERED_BLEND_FORMAT_VERSION` 12 (`rust/compiler/cache/format.rs:cache_format`
  picks; `core/contracts/base.ts`).
- Writes `rust/compiler/cache/publish.rs:write_pointer`; reads `core/contracts/cache.ts:assertCachePointer`.

## `clusters.json`

The manifest as a page tree: a fixed-size root, a head page with every other field, and mesh pages
of slim primitives, each page with its column file. No run measure is written: a rebuild writes the
same bytes.

- Versions: the cache format; `DAG_ERROR_MODEL` (`rust/lib.rs`, `core/contracts/base.ts`).
- Writes `rust/compiler/pages/manifest.rs:write_manifest`.
- Reads `core/contracts/cache.ts:assertCacheRoot`, `core/manifest/paged.ts:readPagedManifest`,
  `core/contracts/cache.ts:assertCacheIdentity`; types `core/contracts/geometry.ts:ClusterManifest`.

### Column files

`manifest-page-<sha256>.bin`: per-cluster numbers as typed-array columns, mapped, not parsed.

- Version: `MANIFEST_BINARY_VERSION` 22 (21 still read), 27 columns in `COLUMN_NAMES` order, with the
  `texturePreviewBc7`, `texturePreviewAstc` and `texturePreviewEtc2` block columns
  (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`). 22 empties the head's pixel column: the
  previews' RGBA8 tails are their own file ([Textures](#textures)). 20 keeps every column: the pages are
  the `WGP3` format 12, which carries up to eight texture sets ([Pages](#pages)). 19 widens a geometry page's record,
  the `geometryU32` column, from five words to seven — its bytes on disk, vertex count, index count,
  flags and decoded bytes, then the bytes it takes in the pool once installed and its offset in its
  streaming page's place there ([Pages](#pages)) — and its pages are the `WGP3` format 11: a 18
  reader would stride through the records wrongly. 18 drops the page normal-cone
  column, the last, which the runtime read none of: a 17 reader would expect 28 columns. 17 keeps
  every column: the pages are then the `WGP3` format 9 ([Pages](#pages); format 11 from 19), and the culling boxes bound the
  positions the pages decode to, so the pages, the box columns and the page sizes differ from a 16
  cook's; no record carries a quantization error any more. 16 lays the clusters in the order
  their streaming pages are filled in, and the `cullingNodes` column holds `CULLING_STRIDE` (16)
  numbers a node, the least own error beside the ceiling, the tree's leaves the group parts
  ([Cluster DAG](#cluster-dag)): a 15 reader would read the nodes off their stride. 15 keeps every column: the
  clusters are assigned to streaming pages ([Cluster DAG](#cluster-dag)), a group spreading over
  several, so the `stream` and `streamOffset` columns and the dependency lists differ from a 14
  cook's. 14 keeps every column: a pinned
  bundle holds the DAG's whole root page — its roots, then whole groups, coarsest first, up to
  32 KiB and 64 clusters ([Cluster DAG](#cluster-dag)) —, not its roots alone. 13 lays every geometry page in a
  streaming bundle of the compile's geometry containers: a bundle names its file by rank in the
  manifest's `geometryFiles`, its offset and its digest, a page its bundle and its place there; the
  `pageSha` and `geometrySha` columns are gone; it also rounded the clusters cut free (each pair
  re-cut where their smallest balls were narrowest, since replaced by the parts of the triangles'
  graph, `codec/partition.rs`), so the level-0 clusters and every page differ from a 12 cook's. 12 cut the clusters by the one clusterer
  (`codec/clusters.rs`, the spatial rule) and built the culling tree, which the page order follows,
  by the one builder (`codec/culling.rs`, each split on the axis of least cost).
- Writes `rust/manifest_binary.rs:Encoded` (each column encoded once, a page cut from them); reads `core/manifest/binaryRead.ts:readManifestColumns`,
  `core/manifest/binaryDecode.ts:decodeManifestBinary`.

### Cluster DAG

Per primitive: clusters, the groups replacing them level by level, a culling tree and STREAMING
PAGES — the bundles of `streams.pages`, the unit the runtime reads, installs, keeps and drops,
one geometry pool slot each — whose dependencies close up to the root pages. The page assignment
(`rust/compiler/pages/bundles.rs:assign_pages`) walks the groups from the coarsest level to the
finest — the roots first, as one group —, within a level by the Morton code of their LOD balls'
centres on a 1024-cell grid along the longest side of the box of every centre, the code's bits
flipped on an odd level so the end of one level lies near the start of the next
(`bundles/order.rs`); each group's clusters along the diagonal of their own balls. Each cluster
fills the current page while it holds its resident bytes ([Pages](#pages)) and one more cluster, else a new page: a group
spreads over several pages. The first pages are the ROOT PAGES — `streams.pinned` counts them —,
32 KiB and 64 clusters at most (`ROOT_PAGE_BYTES`, `ROOT_PAGE_CLUSTERS`), as many as the mesh's
`alwaysResidentKib` fills, one at least ([COMPILER.md](COMPILER.md#mesh-build-settings)), and every
page up to the last holding a root; the others 128 KiB and 256 clusters at most
(`STREAM_BUNDLE_BYTES`, `STREAM_PAGE_CLUSTERS`). A cluster page past a streaming page's bytes is
refused (`CLUSTER_PAGE_TOO_LARGE`). Every page holding a cluster of a group lists every page of
each group holding one of its outputs, the root pages of the roots for one nothing replaces
(`rust/compiler/pages/dependencies.rs`), closed transitively; a root page lists root pages only.
A session keeps every cluster of a root page and of a page holding a root, whatever the view
(`browser/frame/prepare/rootCover.ts`, `PageRec.pinned`).

The clusters' RANKS — what `pages`, `structure` and the culling tree name them by — are the order
the pages are filled in, page after page. The CULLING TREE (`primitives[].culling`, `CULLING_STRIDE`
16 numbers a node: box min and max, LOD ball, replacement error ceiling — -1 over a subtree holding
a root —, least own error, first child, child count, first page, page count) has one leaf per GROUP
PART, the run of ranks of one group one page holds (a root a part of its own): its box the box of
its clusters', its group's LOD ball and replacement error, the least of its clusters' own errors.
Each level's parts get a tree of their own, complete with four children a node (`CULLING_FANOUT`),
its parts sorted at each binary split along the axis whose two sides' boxes have the least summed
surface; the three coarsest levels' roots and a tree of the others hang under the root. An inner
node holds its children's box, the ball of their balls, the least own error and the largest ceiling
below it; its children lie side by side after it (`rust/compiler/hierarchy.rs`,
`codec/culling/tree.rs`).

A position a simplification leaves on a source vertex's comes back from the build's frame bit for
bit (`rust/simplify/region.rs`): the coarse pages of a simplified cook, in the content-addressed
`objects/*.bin` (any version change allows them) and in `world-roots.dag` (`WORLD_ROOTS_VERSION`),
differ from an earlier cook's for the same source.

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/geometry/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler/pages/bundles.rs:assign_pages`,
  `rust/compiler/pages/dependencies.rs`; the culling tree
  `codec/culling.rs:build_culling_bvh`, the one builder of a primitive's, the world's
  (`world-roots.dag`) and a run-time cut's hierarchy.

## Pages

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
(`geometry.residentOffset`). A page holds at most `MAX_PAGE_TRIANGLES` (128) triangles on
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

### On disk

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

### Resident

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
  [docs/COMPILER.md](COMPILER.md)) and always with `FLAG_NORMAL`. Their stream follows the colour's:
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

### Voxels

A voxelized mesh's far levels — the per-mesh far field (`rust/voxel`,
[COMPILER.md](COMPILER.md#voxels-far-away)) — are `voxels.bin` (version 4, the manifest's `voxels`
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

## Textures

Every atlas texture's mip chain: the tail in the head's column file, then one block file per level
above it. BC is the stored family: the level files are written in it (`bc7` RGBA, `bc5` for a
normal map's two channels); ASTC and ETC2/EAC (`etc2`, `eac-rg`) are written beside it on demand
(`--textures-format`, default `bc7`; a family name cooks BC and it, `all` every family), kept
only where the quality gate passes. BC is never gated: a BC7 chain is encoded once with the
encoder's basic search, every mode tried (`blocks.rs:bc7_settings`), and kept, its figures in the
report. A block whose read-back flips a texel across an alpha cutoff is encoded again
(`blocks/quality/alike.rs:sided`). A level file opens on a head of one little-endian `u32` per
tile record — where its compressed bytes end, counted from the head's end —, then each record (the
tile's blocks and gutter) raw DEFLATE alone: one Range reads the head, one a tile, and the browser
inflates it (`DecompressionStream`). The runtime takes the first family the device's features allow
(`browser/materials/texture/blockFormats.ts:chooseBlockFormat`); a device with none reads the BC files and
decodes them to RGBA8 (`browser/materials/texture/blockDecode.ts`).
The tails' RGBA8 texels are a file of their own beside the head page, `preview-pixels-<sha256>.bin`:
the bytes of the sidecar's pixel column, entry after entry, each entry's offset word counted in it;
the head's sidecar keeps that column empty (`binary.texturePreviewBytes` 0) and names the file in
`binary.texturePreviewPixels` (`url`, `bytes`, `sha256`), listed in `files`
(`rust/compiler/pages/manifest.rs`), since `MANIFEST_BINARY_VERSION` 22. A session reads it only when
one of its lanes pins tails made from those texels — the lossless lane, no block family, a channel pool
of R8, R16 or R32 texels, half-floats held in 32 bits or without BC6H blocks
(`browser/materials/texture/poolTail.ts:tailReadsLevels`, `textureCaches.ts:ensureLevels`): a device
sampling BC never downloads it (sponza: 1 485 476 of the head sidecar's 1 867 504 bytes). The reader
still takes version 21, whose sidecar holds the column inline.
Mip levels: the mean of the four texels of each channel (`rust/texture/reduce.rs`), the colours in
linear light for the colour atlas, alpha as it is; the levels a DDS stores are kept and the rest
reduced from the last. A 16-bit PNG is reduced from its 16-bit samples, in `f32`, each level rounded
to 8 bits once when it is written (`reduce.rs:chain_wide`), and counted (`image-depth-reduced`). The
engine builds the mips of a host texture the same way, the mean of the four texels of every channel
(`browser/materials/texture/mipsWgsl.ts`).

A texture whose file stores floating point (OpenEXR, Radiance HDR) read as a base colour or an
emissive map is chained in `f32` and held in half-float RGBA, the atlas of word 2 (`hdr`,
`rust/texture/hdr.rs`): the previews' pixel file holds its tail at eight bytes a texel, no block
family holds it (all three layout words are `lossless`), and the levels above the tail are
`hdr-<level>.rgba16f` files, tile records of half-float texels cut as the block files are
(`levels.rs:tile_records`, `HALF_CELL`). A value past the half-float range holds at its largest
finite value; a NaN reads as zero; no gate or codec touches it. The runtime holds it in the colour
atlas's third pool, `rgba16float`, where the data atlas holds its two-channel one
(`browser/materials/texture/blockFormats.ts:atlasLanes`): the sampled textures a stage binds stay
within the sixteen WebGPU guarantees. A floating image read only as a metal-roughness, normal,
occlusion or height map is not baked (`image-float-data-unsupported`).

A texture can name how it is stored: `extras.compression` of its glTF texture, one of `default`,
`masks`, `normalmap`, `bc7`, `alpha`, `grayscale`, `displacementmap`, `vectorDisplacementmap`, `hdr`,
`hdrF32`, `halfFloat`, `singleFloat` or `hdrCompressed` (`rust/texture/setting.rs`; a name outside the
list is cooked as `default` and reported, `texture-compression-unknown`). `default` and `masks` are
the gated BC7 (BC5 for a normal map) above; `normalmap` and `bc7` fix the layout whatever reads the
texture; `alpha` writes one channel in BC4, eight bytes a block (layout word 4, level files `bc4`,
no gate); `grayscale` writes the red channel in eight-bit texels (layout word 5, level files `g8`), and
`displacementmap` the alpha channel (layout word 6, level files `a8`): sixteen-byte "blocks" holding a
4 × 4 square row by row, kept to the bit, no codec; their sidecar tails hold the RGBA8 texels the
engine reads (the channel in RGB and opaque, or in all four); `vectorDisplacementmap` writes no block: the
tail in RGBA8 and the source image; `hdr` is the half-float atlas above (a byte image is read as linear
values; values hold at the half-float range); `hdrF32` keeps the four channels as 32-bit floats (layout
word 7, level files `rgba32f`), `singleFloat` the red channel as 32-bit floats of the data atlas (word 8,
`r32f`) and `halfFloat` as half-floats (word 9, `r16f`): files and sidecar tails of 4 × 4 squares of exact
texels, row by row (`rust/texture/blocks/texels.rs`), the sidecar's own texels a half-float or grey copy;
a one-channel float on a colour map is cooked as `hdr`. The runtime holds the half-float lane's pool in
`rgba32float` where a chain is kept so and the device has `float32-filterable` (the engine requests it
among its optional features), else in `rgba16float`, the 32-bit values cut to the half range, said once
(`material-textures-float32-unfiltered`); the data atlas's channel pool holds the float maps in `r32float`
or `r16float` likewise, beside no normal map. No pool is added: a scene picks the format of the pools it
has, so the sampled textures of a stage stay as counted below. `hdrCompressed` writes a half-float chain in BC6H, unsigned RGB, sixteen-byte blocks (layout word 3
of the stored family, level files `bc6h` in place of `rgba16f`; its sidecar entry keeps the
half-float pixel tail as well). A floating-point setting on a map the data atlas reads is cooked as
`default` (`texture-compression-float-data-unsupported`). The runtime samples BC6H blocks where the
device has `texture-compression-bc` and every half-float chain is BC6H, else decodes them to
half-float texels. The data atlas binds a fourth pool for the one-channel layouts (words 4, 5 and 6;
`browser/materials/texture/blockFormats.ts:atlasLanes`): BC4 blocks, `bc4-r-unorm`, half a byte a
texel, where the device has `texture-compression-bc` and every chain of the lane is BC4; else `r8unorm`,
one byte a texel, the BC4 blocks decoded (`blockDecodeMore.ts`) and the eight-bit blocks unpacked. The
shader reads it by the texture's tap: BC4 in R alone, `grayscale` in RGB and opaque, `displacementmap`
in all four. A colour map with one of these settings is read from the lossless pool, decoded to RGBA8
(a colour needs the sRGB curve, which no one-channel format has). The sampled textures a stage binds
count three for the colour atlas and four for the data atlas, at most 13 in the fragment stage of the
transparents, under the sixteen WebGPU guarantees. The layout words 3 to 6 are new chains under names
of their own: no existing byte moves, the version stays.

```json
{ "textures": [{ "source": 0, "extras": { "compression": "grayscale" } }] }
```

- Version: `TEXTURE_PREVIEW_VERSION` 12 (`rust/texture.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/texture/bake/write.rs:write_levels`, `rust/texture/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture/blocks/quality.rs`; the
  half-float cook `rust/texture/bake/half.rs:cook`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/materials/texture/levelReader.ts:createTextureLevelReader`, `browser/materials/texture/tileRecords.ts:tileRecord`.

## Prepared scene tables

`scene-tables.json`: nodes, cameras, skins, clips, materials, textures and geometry layout;
the runtime builds its scene from them, parsing no glTF. One `document` holds the published scene;
there is no second scene. Lamps are not here: [`lights.json`](#lightsjson) is the one reading of a
light, and no node names one.

- `hlodMaterials`: per HLOD actor the chain builds, by the rank its world clusters name, the
  `materials` rank of the material it wears.
- A material's `displacement` ([Displacement](COMPILER.md#displacement)): only a displaced
  material has the field, `{ "map": slot, "magnitude", "center", "fade": { "start", "end" } | null,
"uvDensities": [d0, d1, d2, d3] }`, `map` a texture slot as the other maps' (`texture`,
  `texCoord`, `slotTexCoord`, `transform`), `uvDensities` the measured density of each of the first
  four coordinate sets (0 for a set no triangle measured; the field is absent when none was). The
  table's version is unchanged: a reader that does not know a field reads the material flat, as
  before, and a displaced material with no `uvDensities` reads a density of 1 for every set.
- A material's `responsive` ([Temporal anti-aliasing](COMPILER.md#temporal-anti-aliasing)): only a
  material above `off` has the field, `"medium"` or `"full"`, the compiler's one resolution of the
  job's `materials`, its `responsive` match and the material's `extras`.
- Versions: `SCENE_TABLES_VERSION` 9, `NODE_TABLE_VERSION` 7, `MATERIAL_TABLE_VERSION` 6,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler/tables.rs`, `core/scene/core/tableContracts.ts`).
  Material table 6 names the level in `responsive`; versions 4 and 5 wrote `responsive: true` and a
  `temporalAntialiasing` number there.
  Tables 8 / node table 6 dropped `lights` and each node's `light`: they copied the glTF fields raw
  and failed the compile on a non-punctual type, where `lights.json` counts it in `rejected`.
  Node table 7: an animated node that streams carries `"streamed": true` — its mesh is drawn only
  by a row of the cell that holds it ([World partition](#world-partition)), its own host mesh that
  row's animation source —, and an instanced skinned node loaded with the scene carries
  `"bank": <item>` — the item of [`animation-banks.bin`](#animation-banksbin) its mesh plays —,
  hung under its skin's frame at no pose (glTF ignores a skinned node's own transform).
  A static object the core keeps as the frame of the nodes under it, its mesh drawn by a row of its
  cell, carries `"meshStreams": true`: its collider is made and let go of with that cell. A node
  that is no such frame carries no byte of it, so the version is as it was; a runtime that does not
  read it streams that collider by distance alone.
- Writes `rust/compiler/tables.rs:stage_scene_tables`; reads
  `core/scene/core/tableContracts.ts:assertSceneTables`, `browser/scene/host/prepared/build.ts:buildPreparedScene`.

### World partition

Nodes that place a mesh move into spatial cells (`scene-cell-<n>.json`) under paged slots
(`scene-page-<sha256>.json`) and the fixed-size root `partition`. The cells are those of the grids
of the job's scheme (`partitionScheme`, `rust/compiler/tables/partition/grid.rs`,
[COMPILER.md](COMPILER.md#the-partitions-grids)): the loose hierarchical grids of `hashSet` by
default, each cell streaming by the box around its content or the bounds the job names, or the
square grids over the world of `spatialHash`, each cell streaming by its square. Every batch — the
topmost object above a node and every object under it — goes to the cell of the main grid the box
around its objects goes to — 2D, glTF's `+Y` dropped, unless a `hashSet` job lays its grids off the
ground; the grid the job sets (`partitionGrid`), cells of 128 m loaded within 256 m by default, or, with
several (`partitionGrids`), the one its object names —, a
grid cell's nodes packed in files of one stream unit each, grouped by their
HLOD 0 cell. Each cell names its HLOD 0 cell, the bounds that cell streams by, its grid and the
level of its cell there, and its main grid when that is not the first (`rust/hlod/cells.rs`,
`rust/hlod/grids.rs`).

- A cell file's node is `{parent, mesh, matrix | translation, rotation, scale}` — a static
  leaf under its nearest core node, at its declared pose —, `{parent, mesh}` — a static object
  with nodes under it, under its own core node, which keeps no mesh and says so (`meshStreams`), at
  no pose —,
  `{parent, mesh, "track": <item>}` —
  an instanced skinned object under its skin's frame (the node its top joints hang under), at no
  pose, playing that item of [`animation-banks.bin`](#animation-banksbin) —, or
  `{parent, mesh, "source": true}` — an animated object of the core (skinned, morphed, moved by a
  clip, or a joint), drawn by a row under its own node at no pose, its host mesh the row's
  animation source. Every object streams on its main grid unless its `objectSettings` say
  `spatiallyLoaded: false`. An object [`physics.json`](#physicsjson--cooked-colliders) moves or
  bends — a soft body it declares, a moving rigid body it or a node above it declares — is an
  animated object: its node stays in the core and its cell draws it (`"source": true`); its body is
  made when that cell is placed and let go when it leaves, a static collider's alike, as render and
  physics of one object stream together. Every cell node names the source node it draws
  (`"sourceNode"`, its rank in eight lowercase hexadecimal digits, as in the node table of
  [`scene-tables.json`](#prepared-scene-tables)). An object an animation moves — itself or through a parent — takes no
  HLOD layer, nor does an instanced skinned object of `movable` mobility. An instanced skinned
  object's box is its item's sampled bounds at its frame's world, a plain skinned one's the bounds
  of every clip moving its skin, a morphed one's its mesh's grown by its targets' extents. A node
  whose object names a draw distance (`drawDistance` of `objectSettings`,
  [COMPILER.md](COMPILER.md#object-settings)) carries `"drawDistance": {"min", "max", "perInstance"}`,
  in the scene's units (`perInstance` a boolean: the object is one instance of an instanced mesh,
  tested at its bounds' centre; a `min` or `max` of 0 names none of its end), here and in the node
  table of [`scene-tables.json`](#prepared-scene-tables); one naming none carries no byte of it, so
  the versions are as they were.
  A node that is an instance of an assembly (`allowAssemblies`,
  [COMPILER.md](COMPILER.md#assemblies)) carries `"rootParents"`, here and in the node table of
  [`scene-tables.json`](#prepared-scene-tables): a list with one entry for each primitive of the
  mesh it draws, in order — `[error, x, y, z, radius]`, the error and the LOD ball, in the
  primitive's own space, of the group that replaces its root in the assembly's primitive —, or
  `null` for a primitive no group replaces. A node that is no instance carries no byte of it, so
  the versions are as they were (`PARTITION_VERSION` 13, `CELL_VERSION` 4). A runtime that does not
  read the field never closes an instance: it draws every instance down to its parts' roots, and
  the merged clusters of the assembly's primitive draw beside them far away — a doubled surface
  there, not only finer detail — a known break of an older runtime, which the unmoved versions do
  not announce. The assembly's mesh names the primitives that carry its levels in its own
  `extras.assemblyBuilt` of `source.gltf`, and each node of the assembly carries
  `extras.assemblyInstance` `{ "of": mesh, "at": rank }`. Two more marks of the load stay in the
  document the compile reads: a primitive the load added to carry an assembly's levels (a
  placeholder, never read) carries `extras.assemblyTop`, and a mesh drawn as a part of an assembly
  carries `extras.assemblyPart`, the rank of the assembly's mesh, which gives it the tangents, the
  voxel settings and the voxelization of its assembly. A placeholder no instance can join builds no
  primitive of the compiled scene: `source.gltf` keeps it, the manifest does not list it.
- Versions: `PARTITION_VERSION` 13, `CELL_VERSION` 4 (`rust/compiler/tables/partition.rs`,
  `core/scene/core/tablePartition.ts`, `core/scene/core/tableCell.ts`). Version 5: a lamp's node
  may stand in a cell. Version 6: a cell record adds `grid` (`[level, x, z]`), `bounds` and `hlod`, the root `hlod`. Version 7: the HLOD grids
  `· (2 << i)` the main one's. Version 8: every grid is a square grid over the world, its cells of
  one side per level, centred on its origin; a cell record's `bounds` is its grid cell's square on
  the plane, its content's up axis kept, and its `hlod` is `[HLOD 0 cell, the square that cell
streams by on its grid, that grid's rank]`, `null` for objects in no layer, which stream with
  their cell alone; the root's `hlod` is `grids` — per grid, the main one first, its finest cell
  side and its loading range as `f64` bits in sixteen hexadecimal digits each, then its load
  priority in eight (the main grid's the job's, 0 by default; an HLOD grid's 100 plus its level)
  — and `cells`, the HLOD 0 cells' count in eight. Version 9 / cell 3: animated objects stream
  (no longer always loaded, nor do joints pin the nodes under them), a cell node may name a
  `track` or a `source`, and its pose fields are left out where it has none. Version 10: the root
  names its `scheme`, `"hashSet"` or `"spatialHash"`; each of its `grids` adds its HLOD level in
  eight hexadecimal digits after its priority (forty-eight in all), an HLOD grid's priority 0 under
  `hashSet`; a cell record's `bounds` is the box around its content under `hashSet`, and its
  `hlod` adds the level of its HLOD 0 cell on its grid (`[HLOD 0 cell, bounds, grid, level]`), an
  HLOD cell on its loose grid's finest level streaming by its content clipped to its square; an
  object with nodes under it streams, and the objects attached under one another share one cell.
  Version 11: the root says whether its grids lie `flat` (a boolean; a cell record's `grid` is
  then `[level, x, z]`, else `[level, x, y, z]`), and its `hlod` adds `coarser` — per grid, the
  main one first, `null`, or for a square grid whose wished cells pull in the coarser cells
  overlapping them its origin on the ground as two `f64` bit patterns of sixteen hexadecimal digits
  then its finest level's cells per side in eight; a loose main cell on its finest level streams
  by the bounds the job names, an object overruns the finer cell by a quarter cell in whole
  centimetres, and a square grid's levels below its top hold one cell more per side unless the job
  nests them, a small object placed by its centre. Version 12: each of its `grids` adds its flags
  in eight hexadecimal digits after its HLOD level (fifty-six in all): bit 0 set when a load blocks
  on the grid's slow streaming — the main grid's as the job names it (`blockOnSlowStreaming`), an
  HLOD grid's never. Version 13: a layer's HLOD 0 cells are a main cell's objects of that layer —
  on the main grid, an instanced layer's on its own grid —, and bit 1 of a grid's flags is set when
  cell files stream on it: the main grid, and each grid an HLOD 0 cell lies on, an instanced
  layer's whatever its HLOD level — what the runtime walks the cell index and sizes its rows
  within (`browser/geometry/partition/reach.ts`, `placedReach`). Version 14 is version 13 for a
  scene of several main grids (`partitionGrids`, two or more): a runtime that reads one grid
  refuses it by name, one that reads both streams it. A one-grid scene stays version 13, byte for
  byte. Added to the version 13 fields, for several main grids only: in the root's `hlod`, `mains`
  (how many of the first `grids` are main grids, the ones objects stream on); in a cell record,
  `main`, the rank among `hlod.grids` of the main grid the cell lies on (left out for the first); in
  a grid's flags word, a bit `4`: the grid lies flat unlike the root's `flat`, which stays the first
  grid's (no bit for a job whose grids agree). A cell record's `grid` has three values on a flat
  grid, four on one that is not, by its own grid. An HLOD 0 cell of a layer that is not instanced
  lies on the main grid of the cell its objects are in (its `hlod[2]` is that rank). The flag bit `2`
  (cell files stream on the grid) is set on a main grid only when a cell file or an HLOD 0 cell lies
  on it. Cell 4: every cell node names the source node it draws (`sourceNode`), and an object the
  cooked physics moves or bends streams with its cell, its body with it, instead of staying whole in
  the core.
- Writes `rust/compiler/tables/partition.rs:partition`, `rust/compiler/tables/partition/pages.rs:write_page`.
- Reads `core/scene/core/tablePartition.ts:readCellPage`, `core/scene/core/tableCell.ts:assertCellNodes`.

### World HLOD

HLOD chains of the layers a job names (`rust/hlod/options.rs`,
`rust/hlod/cells.rs`), only over the objects a mark or a rule assigns a layer:
HLOD 0 is the layer the objects take: an instanced layer's the placed objects' own pages
instanced, any other's built per main cell of its objects; each level above is, per cell of the
level below, the closed shell, the merge, the voxels or the instances of the cell's original objects
— every object under the cell, at every level: no level reads an actor of the level below, its
shape nor its texture —, each at its layer's accuracy and simplified within its geometric
deviation, a merge taking each object's LOD as its layer selects (`lodSelection`) and never
simplifying the merged mesh. Each shell is simplified
by volume-preserving quadrics, given unique texture coordinates and baked: those objects'
materials read onto it, so every detail under a pixel lives in the texture. Each actor is its own
mesh and wears its flattened material. A layer that asks for a cluster DAG (`clusterDag`) builds
the actor into its own DAG, its errors its own; by default the actor is its level 0 alone — exact
clusters, every one a root, none made by a group, every page a root page held with its cell —,
which the runtime draws whole at every distance: its roots of one cell stand in together, none
drawn while another is not resident, none cut by an error
(`browser/geometry/hlod/worldHlod.ts`, `rust/hlod/chain/builds.rs:build`). That flattened
material is a material of `source.gltf`
— a base colour and the maps its layer bakes beside it, each texel's own: a shell's, by default,
a normal map, its roughness 0.5 and metallic 0 the material's factors, or a metal-roughness map
where the layer bakes either — a shell's holding its baked specular, where its layer bakes it, in
the red channel no glTF input reads —, and a shell's emission map where its layer bakes one, its
`emissiveFactor` and `KHR_materials_emissive_strength` the emission's largest channel; each image
at its own side where the layer sizes its maps apart; a shell's texel reads the view of its sources that faces it most
squarely, a view drawing no translucent surface and seeing through a cut-away one onto what lies
behind, and a texel no view sees is filled from its neighbours —, its atlas
images' chains in the texture section, each image the one-pixel stand-in `data:` address of a baked
image — a PNG product beside it (`hlod-*.png`) only where a chain lacks a level
(`rust/hlod/flatten/bake/publish.rs`). Each layer's actors stream on the grid of its level
(`rust/hlod/grids.rs`): under the default `hashSet` scheme a loose grid of `2 << i` times the main
grid's cell and range for HLOD level `i` — HLOD 0 to 3 on 256, 512, 1 024 and 2 048 m cells,
loaded within 512, 1 024, 2 048 and 4 096 m by default —, an HLOD cell streaming by its content,
clipped to its square on the grid's finest level; under `spatialHash` the square grid the layer
names (`cellSize`, `loadingRange`), an HLOD cell streaming by its square. An actor built by a
layer not spatially loaded, or, on a square grid, held whole by no cell below its grid's top, is
always loaded, and nothing is built of it: its chain's top, held like any cell's roots while it
stands (`browser/geometry/hlod/worldBundles.ts`). `world-roots.table` and `world-roots.dag` (fixed-size records) and
`world-roots.bin` (the bundles, `rust/hlod/chain.rs`). Each actor's clusters are assigned to
streaming pages as a primitive's are, as a resource of its own ([Cluster DAG](#cluster-dag)), one
root page at least; each HLOD cell holds its actor's root pages while its actor is loaded, pinned
in the page cache, every cluster of them in the cover, each world page naming its streaming page
(`browser/geometry/hlod/worldRootPages.ts`, `PageRec.streamUrl`).

- A blended primitive is a source as any; the flattened material is opaque: the shell stands in
  far away, where sorting its layers would cost more than the blend shows.
- An `approximate` layer's pages store the shell's tangents (`FLAG_TANGENT`), the frame its normal
  map is baked in; a `merge` layer's pages store none, their normal map baked in the frame the
  engine rebuilds from each triangle.
- A `voxel` layer's actor (`rust/hlod/chain/voxels.rs`) is the cell's original objects voxelized
  together, at every level: each of its clusters is a voxel page ([Voxels](#voxels)), its page
  facts' flags `GEOMETRY_VOXEL`, its triangles its bricks' boxes'; its levels double from the
  pixel where the cell is first seen, each page replaced by the one above it holding its bricks;
  it wears the material of its first opaque object.
- Table layout (little-endian, version 34): a 64-byte header (magic, version, bundle, page and
  HLOD cell counts, pool length, the binary's length as two words, its 32-byte digest), 56-byte
  bundles, 24-byte pages, 124-byte HLOD cells of the chain, HLOD 0 cells first (its actor's root
  pages, in the pool — an actor built is one with root pages or rows, one not built stands for
  nothing —; the cell its actor lies in, `u32::MAX` for an actor always loaded or a cell
  nothing is built of; its level in the low 8 bits, 1 in the next bit when its actor asks a
  warm-up before it is drawn — every builder's but `instanced`'s —, the level of its cell on its
  grid in the next 7, which its load order reads first, its grid's rank in the partition's root in
  the high 16; its actor's HLOD level, what the HLOD view paints its pages and rows with; its
  actor's rows, the bundle holding them (`u32::MAX` for none) — one of the bundles it holds, of
  no page, 136 bytes a row: its mesh's published rank and the item of the animation banks it plays
  (`u32::MAX` for none), as `u32`s, then its world matrix as sixteen `f64` — and their count; the
  six `f64` bounds
  it streams by, as the scheme says; the six `f64` of its content, the union of the actors in
  it), then a `u32` pool. Version 15 added the flag: a failed top keeps its content standing, a
  cell in no layer — neither built nor failed — follows its range alone (`CHAIN_ACTOR`). Version
  16: a cluster may hold a voxel page. Version 17: that page's head is six words, its bricks five,
  its voxels twelve bytes ([Voxels](#voxels)). Version 18: the bundle a cell holds is its actor's
  root page, its coarsest groups beside its roots, each of its clusters held with the cell; HLOD
  level `i` lies on a grid `· (2 << i)` the main one's, a chain's top is its last layer's actors,
  never built again, an HLOD cell on its grid's finest level streams by its content clipped to its
  cell, an approximated actor is made at a fixed accuracy and deviation in metres, and every layer
  above HLOD 1 reads only its child actors, their shape and their bake. Version 19: every HLOD
  level is built from the cell's original objects, shape and texture. Version 20: the cells are
  those of the square grids, one per layer's level, cell and range, a cell record naming its grid,
  the warm-up its actor asks and its content's bounds; no build-failed flag — an actor whose build
  failed is one not built. Version 22: animated objects stream — their
  bounds widen every grid, an object under a skin's joint no clip moves enters its layer —, an
  object a clip moves, itself or through a node above it, enters none, and an instanced skinned
  object enters no actor above HLOD 0. Version 23: a cell's level word carries the level of its
  cell on its grid in bits 9 to 15, its warm-up in bit 8 alone, and under the default `hashSet`
  scheme a cell streams by its content on loose grids. Version 24: each actor's clusters are
  assigned to streaming pages as a resource of its own — its groups from the coarsest along a
  Morton curve, a group spreading over several pages, root pages of 32 KiB and 64 clusters, the
  others of 128 KiB and 256 —, a cell holding its actor's root pages, and a page lists every page
  of the groups holding its groups' outputs. Version 25: any layer stands at HLOD 0 — a layer not
  instanced builds one HLOD 0 actor per main cell, its HLOD 0 cell on the main grid of that main cell (grid 0 with one main grid),
  streamed as that main cell is and first drawn past its range —, a cell holding actors is at
  level 1 at least, so a level 0 cell is always one of placements; an instanced layer may build
  actors above HLOD 0, and an object standing as itself (`hlodInstance`) is its source
  primitive's DAG placed by its matrix, never merged with another. Version 30: each cell names its
  actor's HLOD level and its actor's rows — every object standing as itself in it, an instanced
  layer's every one, any other's those marked `hlodInstance` —, each its source mesh placed again
  by its world matrix on that mesh's own rows while the actor is loaded and drawn while the cell
  draws the actor, its own pages, nothing copied per actor nor rebuilt from level 0
  (`rust/hlod/chain/builds/instanced.rs`, `browser/geometry/hlod/hlodRows.ts`). Version 31: a row
  also names the item of the animation banks it plays — an instanced skinned object marked
  `hlodInstance` stands in the actors above HLOD 0, its matrix its skin frame's world. Version 32:
  an actor's rows are one bundle of the binary, of no page, after the pages'
  bundles, which its cell holds with its actor's root pages: they stream with the actor, read as
  it is loaded and let go with it (`rust/hlod/chain/builds/instanced.rs`, `lay_rows`); the table
  names that bundle and their count. A world whose built actors are all rows publishes a DAG of
  no cluster, its hierarchy one empty node, which the cut packs to carry the switch. Version 33:
  the pages are then the `WGP3` format 9 ([Pages](#pages); format 11 from version 35), each actor's grid its own, and a cluster's
  page facts carry no quantization error — five words, not six: the cluster record is 180 bytes,
  not 184. Version 34: a row names no more whether it is drawn whole — a
  word that no runtime read —, 136 bytes, not 140.
  Version 35 (`WORLD_ROOTS_VERSION`): the pages are the `WGP3` format 11, and a cluster's page facts
  gain the bytes it takes in the pool and its offset in its streaming page's place there — seven
  words: the cluster record is 188 bytes. Version 36: the pages are the `WGP3` format 12, which
  carries up to eight texture sets. Version 37: an `instanced` layer asking for no cluster DAG
  (`disallowClusterDag`) keeps its objects as rows, each naming the FALLBACK MESH of its source
  mesh in place of the source (`rust/compiler/source/fallback.rs`): a mesh of the published scene
  whose `extras.hlodFallbackOf` is the published rank of its source, one primitive per source
  primitive wearing its material, its clusters the source's fallback (the last LOD, a fraction of
  its triangles) built as exact clusters, every one a root, so drawn whole at every distance. The
  partition's root lists it with no node and no row at any rung (a total of zero), the core's
  `meshPages` name its pages, and its rows come from the actors alone. The layout is the version
  36's: a runtime reads both.
- DAG layout (versions 36 and 37): a 24-byte header (magic, version, cluster count, group count, pool
  length, node count), 188-byte clusters — level, triangles, its actor's rank (`hlodMaterials`),
  bundle, offset, HLOD cell — whose level plus one is its HLOD layer —, two zeros, then the `f64`
  error, parent error (NaN for a root),
  sphere, parent sphere, minimum and maximum, then its page's facts: length on disk, vertex count,
  index count, attribute flags, decoded bytes, bytes resident in the pool and offset in its place
  there —, 64-byte groups, 128-byte culling nodes, then a `u32`
  pool. The clusters lie in the order their streaming pages are filled
  in: a cluster's rank is the one every record names it by, and each node — `CULLING_STRIDE` (16) `f64`,
  a primitive's node layout ([Cluster DAG](#cluster-dag)) — a leaf naming its group part's run of
  those ranks (version 29). Since version 26 each actor's clusters are a subtree of their own,
  built by the one builder a primitive's goes through (`page-codec-wasm/src/culling.rs`), under a
  tree built alike over one item per actor — its subtree root's box, ball and errors —, each of
  whose leaves is that actor's root (`rust/hlod/chain/merge.rs`): the tree's nodes first, the
  actors' roots among them, then each actor's other nodes, a node's children always after it.
  Every node at or under an actor's root holds that actor's clusters alone: its cell's switch
  closes it whole at run time.

- Versions told in no paragraph above: version 2, the records; 3, an object root names its object
  by its table rank; 4, a placed object is one level-0 cluster and a super-root a `WGP3` page
  carrying its attributes; 5, a cell names each node's first object; 6, the DAG lies in the order
  of the world's culling hierarchy and carries its nodes; 7, a placed object's record no longer
  lists its own roots' bundles; 8, a placed object is written at error 0 and every band and
  ceiling raised by the world grid's displacement, and a blended primitive enters no world DAG; 9,
  a placed object stands at its coarsest level and the world's levels count on from it; 10, the
  world is HLOD 1: one merged DAG per HLOD 0 cell from its objects' full geometry, each cluster
  naming its cell and layer, the table its cells' bundles and nothing pinned; 11, the chain runs
  HLOD 1 to HLOD 3, each table cell naming its parent, layer and bounds; 12, each actor above
  HLOD 0 wears its own flattened material, a cluster naming its actor's rank in the scene tables'
  `hlodMaterials` where it named the primitive whose material it wore; 13, a merged layer's actor
  may wear a material of the scene or another actor's flattened one, its rank in `hlodMaterials`
  naming it, and the world's pages carry every attribute its actors carry; 14, a cluster no longer
  names its HLOD layer — its cell's level, which the table carries, gives it; 21, a merged layer
  takes each source's LOD at a screen size, collapses equivalent materials and flattens its
  materials into a grid of cells, one per material and what it bakes on; 26, each actor's clusters
  are a subtree of the world's culling hierarchy of their own, under a tree over the actors' roots
  (`rust/hlod/chain/merge.rs`); 27, an approximated shell reads each source mesh once in its own
  space, every object placing it an instance of it, its thin parts measured under each
  placement's scale, its winding numbers to the second order, its captures framing its objects'
  placed bounds, its hidden faces tested along a seeded stream's rays, and its pages store the
  tangents its normal map is baked in; 28, its seed points are its meshes' vertices as they lie,
  its textures are read anisotropically and its captures keep their buffers' precisions, and its
  layer may cap its base, clip it at a ground plane, read its sources' render meshes, size its
  atlas per map and bake its specular and emission; 29, the clusters lie in the order their
  streaming pages are filled in, each actor's subtree of the culling hierarchy being one tree per
  level of four children a node over its group parts — the clusters of one group a page holds —,
  its levels' roots under one root, and every node of sixteen numbers, its least own error beside
  its ceiling; 31 also, a merged layer's mesh-baked entries lie on their mesh's lightmap texture
  set, its atlas holds the maps its layer names — opacity or mask, occlusion, anisotropy,
  specular, emission — at the sizes it names, and its mesh keeps its sources' vertex colours where
  it asks.
- Versions: `WORLD_ROOTS_VERSION` (`rust/hlod/chain.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/hlod/chain/bundles.rs:pack_world`, `rust/hlod/chain/records.rs:encode_table`,
  `rust/hlod/chain/dag_records.rs:encode_dag`.
- Reads `core/manifest/worldRootsTable.ts:readWorldRoots`, `core/manifest/worldRootsTable.ts:readWorldRootsDag`,
  `core/manifest/worldRoots.ts:bundlePageRanges`.

## `animation-banks.bin`

The clips the scene's instanced skinned objects play on the GPU (`objectSettings`'
`skinnedInstance`, [COMPILER.md](COMPILER.md)), each sampled once. A bake is one skin's clip at its
own rate in frames a second — the first of 30, 24, 23.976, 25, 29.97, 48, 50, 60, 59.94, 72, 90, 100,
120, 144, 165, 240 and 480 at which the clip's duration is a whole number of frames within a
millisecond, else 30 (`ANIMATION_BANK_SAMPLE_RATE`): each joint's transform in the skin's frame — the
node its top joints hang under — per frame, translation then rotation, and each joint's inverse
bind matrix; identical bakes are written once. An item is what objects play: a bake on a mesh,
whether its track loops, the second it starts from, its play rate, the screen size under which it
rests (0 the run-time setting's, negative never) and its sampled bounds — the mesh's box grown by
every joint's translation of every frame, scaled by its `boundsScale` about its centre —, in the
frame's space. Every instance of one item is in one pose: one track.

- Layout (little-endian, version 2): a 5-word header (magic `TBNK`, version, bake count, item
  count, pool length in floats); 5-word bakes (joints, frames, inverse binds' and keys' first
  float in the pool, the rate as `f32`); 12-word items (bake, flags — bit 0 looping —, position, play rate, minimum
  screen size as `f32`, six `f32` bounds, mesh rank); the `f32` pool: per bake its inverse binds
  (twelve floats a joint, the three rows of its affine part) and its keys (seven floats a joint a
  frame: translation, then the rotation quaternion `x y z w`).
- The manifest names it in `animationBanks` (`url`, `version`, `bytes`, `sha256`, `items`), absent
  for a scene with no item. A cell node's `track`, a core node's `bank`, is an item's rank.
- Versions: `ANIMATION_BANKS_VERSION` (`rust/compiler/tables/motion/bank.rs`,
  `core/contracts/writtenFormats.ts`).
- Writes `rust/compiler/tables/motion/bank.rs:bake_banks`; reads
  `core/scene/core/animationBanks.ts:decodeAnimationBanks`.

## `sparseVolumes.bin`

The sparse volume textures a scene's heterogeneous volumes read (`rust/sparse_volume`, read by
`sdk-browser/src/lighting/heterogeneousVolumes/sparseVolumeFile.ts`). A node of the source scene
cites a `.vdb` file by the extension `TRILLION3D_sparse_volume` (`uri`, under the source folder);
a name ending with a number makes the first frame of a sequence of the files that follow it. The
manifest's `sparseVolumes` section holds `version` (1), `file`, `bytes`, and for each volume its
`node`, `uri`, `resolution`, `mipLevels`, `formats` and `frames` (`offset`, `bytes`, `matrix`: the
frame's transform, sixteen numbers, the translation in the last four). Words are little-endian
`u32`; a frame starts on a four-byte boundary.

A frame is, in order: a head of 36 words, the magic `SVTF`, the version (1), the rank of the first
tile that is not of the coarsest level, the mip levels, the pages and the tiles, the volume's
resolution, lowest voxel and highest voxel (excluded), the page table's resolution, lowest page and
highest page (excluded) (`i32` × 3 each), the two attribute formats (1 `R8`, 2 `R8G8`, 3 `R8G8B8A8`,
4 `R16F`, 5 `G16R16F`, 6 `FloatRGBA`, 0 none), the two
fallback values (`f32` × 4 each), the bytes of tile data and a word kept zero; the first page and
the page count of each mip level; three tables with a word a page, the page's coordinates in its
level's page table (11, 11 and 10 bits), its tile and its parent page in the next coarser level
(`0xFFFFFFFF` for none); the offsets of the tiles in the tile data, one more than the tiles; the
voxels each tile stores of its first texture (`u16`, padded to a word); the tile data. A tile is a
cube of 18 voxels a side, 16 and a border of one, and is shared by all the pages whose voxels are
alike. It is stored as the occupancy bits of its textures (183 words each, a bit a voxel, set where
the voxel is not the fallback value), then the voxels of its first texture that are set, then those
of its second. The page table has one level per mip, each half the size of the one before down to
one page.

## `volumetric-lightmap.bin`

The precomputed indirect light of a baked scene: a sparse grid of bricks of third-order spherical
harmonics (`rust/volumetric_lightmap`, read by `sdk-core/src/lighting/volumetricLightmapFile.ts`).
Words are little-endian `u32`. The head, 35 words: the magic `T3VL`, the version (2; a file of version 1 is still read), the brick
size (4), the world box the grid covers (lower then upper corner, `f32` × 3 each), the indirection
volume's size in texels and the atlas's (`u32` × 3 each), then for each of the ten layers its texel
format (1 `rgba8uint`, 2 `rg11b10ufloat`, 3 `rgba8unorm`, 4 `r8unorm`) and its byte length. The
layers follow, each on a four-byte boundary, texels in x, then y, then z order. Version 2 adds two
words after the head, the side of a streaming cell in finest bricks and the number of cells (0 for a
file whose bricks are all in its layers, as in version 1), and, after the layers, a record of 14 words
for each cell: its three coordinates in the grid of cells, its bricks, where its bytes start in the
file and their length, then their SHA-256 (32 bytes). The cells' bytes follow the records. A cell
holds, in this order, each part brick after brick: the three coordinates of every brick in the
indirection volume (`u32`), then the 5 × 5 × 5 texels of its ambient, of its six coefficient layers,
of its bent normal (where the file has one) and of its sun's shadowing, in the formats of the layers.
With cells, the layers hold the coarser bricks alone and the indirection volume names, for a finest
brick's place, the coarser brick over it; a cell loaded takes slots of the atlas past the layers' and
points its indirection texels at them. The part always read, from the head to the end of the records,
is `baseBytes` long in the manifest's section, with `baseSha256`; a cell is read by a Range and
checked against its own digest.

| Layer  | Format          | Volume      | Holds                                                                                                                                                                         |
| ------ | --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | `rgba8uint`     | indirection | per texel of the finest level: the brick's place in the atlas layout (three bytes) and how many finest bricks it spans                                                        |
| 1      | `rg11b10ufloat` | atlas       | the ambient colour (the zeroth coefficient)                                                                                                                                   |
| 2 to 7 | `rgba8unorm`    | atlas       | the other coefficients, red low and high, green low and high, blue low and high: each divided by the ambient and by its basis function's scale, mapped from [-1, 1] to [0, 1] |
| 8      | `rgba8unorm`    | atlas       | the sky's bent normal mapped to [0, 1] (alpha a half), its length the sky's visibility; empty (0 bytes) where the job names no sky light or the sky does not cast shadows     |
| 9      | `r8unorm`       | atlas       | the stationary sun's unshadowed fraction                                                                                                                                      |

The atlas is a layout of up to 256 bricks a side, each brick `brickSize + 1` texels wide: the
`brickSize`³ unique samples and one row of padding on the three upper faces, so that a trilinear read
never leaves its brick. The indirection volume names, for a position, the brick holding it; a brick of
a coarser level spans several texels of it. A file of another version is refused whole.

Written by the compiler when the job names `lightmapBake` ([COMPILER.md](COMPILER.md#volumetric-lightmap)):
`rust/volumetric_lightmap/bake.rs` fills the layers, `writer.rs` lays them out. The manifest's
`volumetricLightmap` section names it: `{ version, file, bytes, bounds, bricks, levels, indirection,
passes, sky }` — the version of the file, its name, its size, the world box the volume covers (lower then
upper corner, metres), the bricks it holds and the levels they come in, the indirection volume's size,
the passes each probe took, and whether the job named a sky light (`sky`); the bent normal layer is
written only where that sky casts shadows.

- Versions: `VOLUMETRIC_LIGHTMAP_VERSION` (`rust/volumetric_lightmap/format.rs`); the head's
  constants `VOLUMETRIC_LIGHTMAP_MAGIC`, `VOLUMETRIC_LIGHTMAP_LAYERS`,
  `VOLUMETRIC_LIGHTMAP_FIXED_WORDS`, `VOLUMETRIC_LIGHTMAP_LAYER_WORDS`,
  `VOLUMETRIC_LIGHTMAP_HEADER_WORDS`, `VOLUMETRIC_LIGHTMAP_MAX_LAYOUT`.

## `distanceFields.bin`

The signed distance fields of the meshes that built one, and of the HLOD cells whose layer allowed one
(`rust/distance_field/encode.rs`, read by `sdk-core/src/lighting/distanceFieldFile.ts`; the settings are in
[COMPILER.md](COMPILER.md#distance-fields)). Words are little-endian. The head, 16 bytes: the magic `T3DF`, the version (2), the
number of fields and a reserved word. Then a record of 200 bytes for each field: two words, the owner
and the flags, the box's low and high corners in metres (six `f32`), then three mip records of 56 bytes,
finest first: the bricks along each axis (three `u32`), the distance scale and bias, the
volume-to-virtual-coordinate scale and add (three `f32` each), the bricks stored, and where the mip's
data starts in the file and how long it is (`u32` each). After the records come the mips' data, each
field's coarsest first so that the mip always loaded leads: the indirection table (a `u32` for each cell of
bricks, `0xffffffff` where none is stored) and the bricks stored, 512 bytes each (8 × 8 × 8 voxels, a byte
the distance to the surface over the band).

The record's third word holds flags:

| Bit     | Name                            | Meaning                                                                                                                                                                                                        |
| ------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (`1`) | `DISTANCE_FIELD_FLAG_TWO_SIDED` | a quarter of the triangles or more are two-sided (or the build asked for all): the field's hits are less accurate                                                                                              |
| 1 (`2`) | `DISTANCE_FIELD_FLAG_HLOD_CELL` | the field is an HLOD cell's: the first word names a cell of the world's chain of HLOD cells ([World HLOD](#world-hlod)), not a compiled mesh, and the box is in the world's space, not the mesh's object space |

Version 2 added the flags (a file of version 1 is refused: `UNSUPPORTED_FORMAT`). The manifest's
`distanceFields` section names the file and lists, for each field, `{ "mesh": <mesh or cell>, "twoSided":
<bool>, "mips": [...] }`, with `"hlodCell": true` on an HLOD cell's:

```json
{
  "distanceFields": {
    "version": 2,
    "file": "distanceFields.bin",
    "meshes": [
      { "mesh": 0, "twoSided": false, "mips": [{ "bricks": [4, 4, 1], "stored": 11 }] },
      {
        "mesh": 5,
        "twoSided": false,
        "hlodCell": true,
        "mips": [{ "bricks": [18, 18, 3], "stored": 240 }]
      }
    ]
  }
}
```

(The section also carries `bytes`, `headBytes`, `meshBytes`, `mipBytes` and the `bricks` total.) The file is read
by parts, since its bricks are megabytes the view mostly never asks for: the head and the records, `baseBytes`
long, once, checked against `baseSha256`, then each mip's data (its table and bricks, at the offset and length its
record gives) by a Range when the atlas takes the mip in, checked against its entry of `mipSha256` (the SHA-256 of
each mip's data, in the records' order, a field's mips finest first). A section without them has its file read
whole. A scene whose meshes build none writes neither the file nor the section. Constants: `DISTANCE_FIELD_VERSION`,
`DISTANCE_FIELD_MAGIC`, `DISTANCE_FIELD_HEAD_BYTES`, `DISTANCE_FIELD_MESH_BYTES`, `DISTANCE_FIELD_MIP_BYTES`,
`DISTANCE_FIELD_FLAG_*` (`packages/sdk-core/src/contracts/distanceFieldAbi.ts`).

## `meshCards.bin`

The cards of the meshes that kept some, and of the HLOD cells whose layer allowed a distance field
(`rust/card_representation/encode.rs`, read by `sdk-core/src/lighting/meshCardsFile.ts`; the settings are in
[COMPILER.md](COMPILER.md#mesh-cards)). A card is a box looking at the mesh along one of the six axis
directions; the cards of a mesh cover its surface. Words are little-endian, lengths are metres in the
mesh's object space (the world's space for an HLOD cell's). The head, 16 bytes: the magic `T3MC`, the version
(1), the number of meshes and the number of cards. Then a record of 40 bytes for each mesh: two words, the
owner and the flags, the low and high corners of the box the cards were fitted in (six `f32`), the rank of
the mesh's first card in the card table and how many cards it has (`u32` each). The records are followed by
the card table, 64 bytes a card, the cards of each mesh one after the other in the order of the records:
the centre of the card's box (three `f32`), its half-extents along its own axes (three `f32`), its three
axes (three `f32` each: unit vectors, the third facing out of the mesh) and the direction it looks along
(`u32`).

| Direction | Faces out along | Direction | Faces out along |
| --------- | --------------- | --------- | --------------- |
| 0         | `-x`            | 3         | `+y`            |
| 1         | `+x`            | 4         | `-z`            |
| 2         | `-y`            | 5         | `+z`            |

The record's third word holds flags:

| Bit     | Name                        | Meaning                                                                                                                                                                                                              |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (`1`) | `MESH_CARDS_FLAG_TWO_SIDED` | a quarter of the triangles or more are two-sided (or the build asked for all): the mesh was covered as foliage is, by its outer cards alone                                                                          |
| 1 (`2`) | `MESH_CARDS_FLAG_HLOD_CELL` | the cards are an HLOD cell's: the first word names a cell of the world's chain of HLOD cells ([World HLOD](#world-hlod)), not a compiled mesh, and the lengths are in the world's space, not the mesh's object space |

A mesh whose build keeps no card (`maxMeshCards` 0) has no record; a mesh the cards found none for has a
record of no card. The manifest's `meshCards` section names the file and lists, for each record,
`{ "mesh": <mesh or cell>, "twoSided": <bool>, "cards": <count> }`, with `"hlodCell": true` on an HLOD
cell's:

```json
{
  "meshCards": {
    "version": 1,
    "file": "meshCards.bin",
    "cards": 14,
    "meshes": [
      { "mesh": 0, "twoSided": false, "cards": 6 },
      { "mesh": 5, "twoSided": false, "hlodCell": true, "cards": 8 }
    ]
  }
}
```

(The section also carries `bytes`, `headBytes`, `meshBytes` and `cardBytes`.) A scene whose meshes keep no
card writes neither the file nor the section. Constants: `MESH_CARDS_VERSION`, `MESH_CARDS_MAGIC`,
`MESH_CARDS_HEAD_BYTES`, `MESH_CARDS_MESH_BYTES`, `MESH_CARDS_CARD_BYTES`, `MESH_CARDS_DIRECTIONS`,
`MESH_CARDS_FLAG_*` (`packages/sdk-core/src/contracts/meshCardsAbi.ts`).

## `rayTracing.bin`

The trees a ray tracer walks: one for each compiled primitive that has a triangle in its coarse cut and, for a
world with HLOD actors, one for each actor and the directory of them
(`rust/ray_tracing/encode.rs`, read by `sdk-core/src/lighting/rayTracingFile.ts`; the cut is in
[COMPILER.md](COMPILER.md#ray-tracing)). Words are little-endian; lengths are metres, in the primitive's object
space, or, for the world's records, in the world's space. The head, 32 bytes: the magic `T3RT`, the version (4),
the number of records, the number of nodes, the number of triangles, the number of vertices (`u32` each) and two
zero words. Then a
record of 64 bytes, one for each primitive in the order of the manifest's primitives, then the actors' records,
then the directory's. A record holds, in this order:

| Word  | Content                                                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-1   | the primitive's compiled mesh and its number in the mesh (the two numbers a placed root names its primitive by); `RAY_TRACING_NO_PRIMITIVE` (`0xffffffff`) twice in the world's    |
| 2     | the flags (below)                                                                                                                                                                |
| 3     | the error of its cut, in metres (`f32`)                                                                                                                                          |
| 4-5   | the rank of its first node and how many nodes it has (ranks in the file's node table)                                                                                            |
| 6-7   | the rank of its first triangle and how many triangles it has (ranks in the file's triangle table)                                                                                |
| 8-13  | the low and the high corner of the box of its triangles (six `f32`)                                                                                                              |
| 14    | the HLOD cell whose switch shows the actor, in an actor's record; zero in every other                                                                                            |
| 15    | zero                                                                                                                                                                             |

The records are followed by the nodes of every record, 80 bytes each, one record after the other, then by the
vertices, 12 bytes each, then by their triangles, 24 bytes each. A record's nodes are consecutive, its root the first, and the links of a node count from
its record's first node and first triangle.

A node has up to eight children, in eight slots. The slots are in the order the compiler opened the children
in, which no ray's direction chooses: a walk measures the span of every child it meets and goes to the nearest.
A node holds, in this order:

| Bytes | Content                                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-11  | `p`, the low corner of the node's box (three `f32`)                                                                                                                                                                                                                       |
| 12-14 | `e`, the exponent of each axis (three `i8`): the least with `2^e · 255` at least the node's side, and no less than `RAY_TRACING_MIN_EXPONENT` (-126), which a flat side has                                                                                               |
| 15    | the mask of the internal children: bit `s` set when slot `s` holds a node                                                                                                                                                                                                 |
| 16-19 | the rank of the first internal child among the record's nodes, counted from the record's first node; the internal children lie one after the other, in slot order                                                                                                         |
| 20-23 | the rank of the first triangle of the leaf children, counted from the record's first triangle; the leaves' triangles lie one after the other, in slot order                                                                                                               |
| 24-31 | the meta of each slot: 0 when empty and for an internal child (the mask says it); for a leaf child, `(count << 5) \| offset`: the count is 1, 2 or 3, the offset (below 32) the rank of its first triangle from the node's first |
| 32-79 | the boxes of the children, a byte a coordinate: the low x of the eight slots, the low y, the low z, then the high x, y and z                                                                                                                                              |

A child's box is `p + 2^e · q` on each axis, `q` being the byte: the low corner is rounded down and the high
corner up, so the box holds the child's. The internal child in slot `s` is the `popcount(mask & ((1 << s) - 1))`-th
of the node's internal children. No tree needs a walk to keep more than `RAY_TRACING_STACK` (64) nodes on its stack
(a walk keeps, at a node, every internal child it meets but the nearest): the compiler splits a tree whose cheapest
cuts need more in halves, and stops with `RAY_TRACING_TREE_TOO_DEEP` if even those need more.

A vertex is a corner (three `f32`), each corner of the file once, in the order the triangles first name them. A
triangle, 24 bytes, holds its three corners among the vertices — zero for a corner first named, which is the next
vertex; else how far back it lies from the next, the next vertex's rank less its own —, the rank of its cluster
among the DAG clusters, its own rank in the cluster and its tag (`u32` each). The tag is zero but in the directory. The reader
lays each triangle out as the GPU reads it, 48 bytes (`RAY_TRACING_TRIANGLE_BYTES`): its three corners' floats,
then its last three words; it refuses a triangle naming a vertex the file lacks. Version 3, which the reader still
reads, has no vertices (the vertex count is zero) and holds the triangles so laid out.

The record's third word holds flags:

| Bit      | Name                           | Meaning                                                                                               |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 0 (`1`)  | `RAY_TRACING_FLAG_TWO_SIDED`   | the primitive's material is double-sided                                                              |
| 1 (`2`)  | `RAY_TRACING_FLAG_MASKED`      | its material is alpha-masked: a hit must be tested against the material's coverage                    |
| 2 (`4`)  | `RAY_TRACING_FLAG_TRANSLUCENT` | its material is translucent (blended or transmissive): it is no occluder as opaque is                 |
| 3 (`8`)  | `RAY_TRACING_FLAG_WORLD`       | the record is the world's directory of the HLOD actors; no other flag is set                          |
| 4 (`16`) | `RAY_TRACING_FLAG_ACTOR`       | the record is an HLOD actor's, over its material's flags (bits 0 to 2); word 14 is the cell showing it |

A primitive whose cut holds no triangle has no record; a skinned or morphed primitive has one, at its rest pose,
and the reader decides what to do with it. The world's HLOD actors are meshes of their own, all spliced into the
world's one DAG, in the world's space: each is cut as a primitive's DAG is, at the error of its own finest
clusters, into an actor's record that names no primitive and wears the flags of the material the actor wears
(a flattened material as it is published, blended or masked as its base image's alpha says; a material of the scene
as any primitive wearing it). The actors' records are the ones just before the directory's, in the actors' order: the
directory's entries lie in its tree's leaf order and each names its actor by rank. The directory (`RAY_TRACING_FLAG_WORLD`, the file's last record, present only when an actor has a
triangle) is a tree over the actors' boxes whose entries stand where triangles do: the low and the high corner of
an actor's box and the low corner again (nine `f32`), the actor's rank among the actors' records (the cluster
word), zero (the triangle word) and the actor's HLOD cell (the tag). The reader refuses a file whose entry names
an actor the file lacks, or a cell other than its actor's, a directory whose flags are not the world's alone, and a cell word in
a record that is no actor's. A voxel actor has no record: its clusters hold a box's
corners, no surface.

A ray enters an HLOD actor only where the cut draws its cell this frame. The runtime keeps for it, beside the
records and the placements' table, one word for each HLOD cell of each instance of the world DAG: its top bit says
the cut draws the cell's actor, and under it stands the rank, plus one, of the object a hit on the actor is told
by (zero for an actor with none, which a hit names `NO_INDEX`, as a miss does).

The manifest's `rayTracing` section names the file and its size:

```json
{ "rayTracing": { "version": 4, "file": "rayTracing.bin", "bytes": 2672 } }
```

A scene none of whose primitives nor actors has a triangle in its cut writes neither the file nor the section.
Constants: `RAY_TRACING_VERSION`, `RAY_TRACING_FLAT_VERSION`, `RAY_TRACING_MAGIC`, `RAY_TRACING_HEAD_BYTES`,
`RAY_TRACING_RECORD_BYTES`, `RAY_TRACING_NODE_BYTES`, `RAY_TRACING_VERTEX_BYTES`,
`RAY_TRACING_INDEXED_TRIANGLE_BYTES`, `RAY_TRACING_TRIANGLE_BYTES`, `RAY_TRACING_WIDTH`, `RAY_TRACING_LEAF_TRIANGLES`,
`RAY_TRACING_LEAF_COUNT_SHIFT`, `RAY_TRACING_LEAF_OFFSET_MASK`, `RAY_TRACING_FLAG_*`, `RAY_TRACING_NO_PRIMITIVE`,
`RAY_TRACING_STACK`, `RAY_TRACING_MIN_EXPONENT` (`packages/sdk-core/src/contracts/rayTracingAbi.ts`).

## `lights.json`

The source's punctual lights in the engine's light contract (candela and lux as the source writes
them), world space: the one
product that reads a light (type, colour, intensity, range, cone, transform). A light of another
type, a bad matrix or a non-positive intensity is counted in `rejected`, never a failed compile.

- Versions: `SCENE_LIGHTS_VERSION`, `SCENE_LIGHT_CONTRACT` (`rust/compiler/lights.rs`);
  `IMPORTED_LIGHTS_VERSION` (`browser/lighting/importedLights.ts`). 2 writes the intensities as the
  source declares them, in candela and lux; 1 divided them by 683, and a 1 file is read as no light.
  `sceneLightVersion` is `SCENE_LIGHT_CONTRACT`, 4: the contract's lamp has an `intensityUnits`
  (unitless when it names none) and a spot an `innerConeAngle` and an `outerConeAngle`; a point or
  spot record here names `candelas`, the same light as under 2, and a spot its two cones as the
  source writes them (3 wrote a `coneAngle` alone). `SCENE_LIGHTS_VERSION` is 3 for the same change.
- Writes `rust/compiler/lights.rs:stage_scene_lights`; reads
  `browser/lighting/importedLights.ts:loadImportedLights` (an unknown version reads as no light).

## `physics.json` — cooked colliders

Colliders as Jolt binary state, readable only by the Jolt commit that wrote them, and their static
instances.

- Versions: `PHYSICS_FORMAT_VERSION`, `PIECES_FORMAT_VERSION`, `JOLT_COMMIT` (`rust/physics_cook.rs`);
  `PHYSICS_FORMAT_VERSIONS` (`core/physics/cooked.ts`).
- Writes `rust/physics_cook/stage.rs:stage_physics`; reads `core/physics/cooked.ts:readCookedPhysics`.
- A `node` names the source node — its `sourceNode` in the [prepared scene tables](#prepared-scene-tables),
  never its rank in a partition's core —; the node of a body that moves or bends stays in the core
  and a cell draws it ([World partition](#world-partition)), each cell node naming the source node
  it draws; the runtime finds a body's node by that source rank, and makes the body while a placed
  cell draws it.

### `bodies` — declared rigid bodies

Declared motion and shape, or a cooked hull with its mass: `rust/physics_cook/declared.rs`;
`browser/physics/cooked/cookedBodies.ts:createCookedBodies`.

### `softBodies` — cooked soft bodies

Cloth, rope and volume as Jolt settings at the node's scale: `rust/physics_cook/soft_record.rs:soft_record`;
`browser/physics/soft/cookedSoft.ts:createCookedSoftBodies`.

## Source glTF

`source.gltf`/`source.bin`, the compacted selection: `rust/compiler/source/scene.rs:write_source_scene`;
read through the [prepared scene tables](#prepared-scene-tables), which lay out this one document.

## Source files

The input: a folder with a source manifest, a folder with one glTF or GLB, or the file.
`SOURCE_FORMAT_VERSION` (`rust/compiler/cache/format.rs`); `rust/compiler/source/load.rs:load_model_file`,
`rust/compiler/source/safe_path.rs:is_safe_source_name`, `rust/compiler/accessor/layout.rs`.

## Deformation in geometry page format 9

Joints, weights, morph deltas and simulation-source IDs behind a geometry page's flags;
`primitives[].deformation` bounds their reach.

- Flags: `FLAG_SKIN`, `FLAG_MORPH` (`codec/deform.rs`), `FLAG_SOFT_SOURCE` (`codec/lib.rs`).
- Writes `codec/encode/deformation.rs:page_deformation`; reads
  `codec/deform.rs:parse` (through `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`), `browser/deformation/softSource.ts:cookedSoftSource`.

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

- Version: `MANIFEST_BINARY_VERSION` 18, 27 columns in `COLUMN_NAMES` order, with the
  `texturePreviewBc7`, `texturePreviewAstc` and `texturePreviewEtc2` block columns
  (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`). 18 drops the page normal-cone
  column, the last, which the runtime read none of: a 17 reader would expect 28 columns. 17 keeps
  every column: the pages are the `WGP3` format 9 ([Pages](#pages)), and the culling boxes bound the
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
fills the current page while it holds its bytes and one more cluster, else a new page: a group
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
`objects/*.bin` (any version change allows them), in `world-roots.dag` (`WORLD_ROOTS_VERSION`) and in
the cuts `proxy.bin` holds (`SCENE_PROXY_VERSION`), differ from an earlier cook's for the same source.

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/geometry/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler/pages/bundles.rs:assign_pages`,
  `rust/compiler/pages/dependencies.rs`; the culling tree
  `codec/culling.rs:build_culling_bvh`, the one builder of a primitive's, the world's
  (`world-roots.dag`) and a run-time cut's hierarchy.

## Pages

Index pages (`u32` indices, concatenated in bundles) and `WGP3` geometry pages, quantized clusters a
shader reads in place, decoded alike by Rust, JavaScript and WGSL.

- Versions: `VERSION`, `HEADER_WORDS` (`codec/lib.rs`), printed into `GEOMETRY_PAGE_FORMAT_VERSION`
  and the other constants of `core/page/format.ts` (`pnpm run generate:shared-rules`), declared by the
  manifest's `geometryPages`.
- Writes `codec/encode.rs:encode_deformed`, the one encoder: the compiler's
  `rust/compiler/pages/record.rs:encode_page`, `rust/hlod/chain/pages.rs:encode_pages` and
  the run-time cut (`browser/geometry/codec/encodeGeometryPage.ts`, `codec/wasm/encode.rs`) call it; the
  grid, one a primitive (`codec/bits/grid.rs:PageGrid::of`, `rust/geometry_page/quant.rs:page_grid`).
- Reads `browser/geometry/cluster/pages.ts:fetchVerified`, `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`,
  `codec/unpack.rs:decode`, `browser/geometry/cluster/decodeWgsl.ts`.
- Format 9 puts every attribute on a grid of its own, named by the header (`HEADER_WORDS`, 23 words):
  word 5 the position widths, six bits an axis, and the position precision as the signed top byte;
  words 6 to 8 the least cell of each axis, signed; words 9 to 16 the four texture sets' ranges, two
  words a set, `min << 5 | bits` for `u` then `v`; word 17 the least byte of each colour channel,
  red lowest; word 18 the colour channels' widths, four bits each from bit 0, then the normal
  precision from bit 16 and the tangent precision from bit 20; word 19 the corner bits; word 20 the
  positions stored; word 21 the skin and morph record; word 22 the skin influences. No word holds an
  error: nothing adds a page's rounding to a cluster's error.
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
  `clusterOctahedron`).
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
- Texture coordinates are up to `MAX_UV_SETS` (4) sets, `FLAG_UV`, `FLAG_UV1`, `FLAG_UV2`, `FLAG_UV3`,
  each two streams, `u` then `v`, of float codes of 20 bits: a sign, a 5-bit exponent and a 14-bit
  mantissa, the code's order the value's (`codec/bits/quant.rs:uv_code`, `uv_value`; `clusterUvValue`).
  A page stores per coordinate the least code and the bits above it, the least lowered where the
  greatest offset those bits hold would pass the greatest code (`UvRange::unpack`). A material reads a map at the
  set its `texCoord` names (`channelsOf`, two bits a map).
- Streams, in `Layout::of` order: the block table, the corners, positions `x`, `y`, `z`, the links,
  the two normal streams, each set's `u` and `v`, the four colour channels, the tangents, then the
  skin and the morph targets.

### Voxels

A voxelized mesh's far levels — the per-mesh far field (`rust/voxel`,
[COMPILER.md](COMPILER.md#voxels-far-away)) — are `voxels.bin` (version 4, the manifest's `voxels`
section): a head — `T3VX`, the version, the group
and brick counts —, a 48-byte record per group (its primitive, `u32::MAX` for a mesh's far group;
its DAG group or compiled mesh; first brick and count; first voxel and count; its error, the error
it is replaced at and its voxels' side as `f32`; its first brick's corner, `f32` × 3), 16-byte bricks
(mask `u64`, bit `x + 4y + 16z`; corner in bricks from the group's first, `u16` × 3; joint `u16`,
`0xFFFF` none), 12-byte voxels in each brick's mask order (sRGB base colour and normals' spread, 255
when the build drops it (`voxelNdf`); occlusion, roughness, metalness and a zero, or the voxel's
coverage as its opacity when the build keeps it (`voxelOpacity`), which no pass of the engine reads;
mean normal, octahedral; two zeros): what the runtime reads of a voxel, no more. Version 4: a voxel's coverage and material stay in the compiler, and a
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
only where the quality gate passes. BC is never gated: a BC7 chain whose fast read-back fails is
encoded again with the encoder's slow search (`blocks.rs:Effort`) — an HLOD atlas with its
basic search, lighter (`blocks.rs:Ladder`), under a key of its own — and kept, same weight, its
figures in the report. A block whose read-back flips a texel across an alpha cutoff is encoded
again (`blocks/quality.rs:keep_sides`). A level file opens on a head of one little-endian `u32` per
tile record — where its compressed bytes end, counted from the head's end —, then each record (the
tile's blocks and gutter) raw DEFLATE alone: one Range reads the head, one a tile, and the browser
inflates it (`DecompressionStream`). The runtime takes the first family the device's features allow
(`browser/materials/texture/blockFormats.ts:chooseBlockFormat`); a device with none reads the BC files and
decodes them to RGBA8 (`browser/materials/texture/blockDecode.ts`).
Coverage-preserving alpha: `rust/texture/coverage.rs`, mirrored by
`browser/materials/texture/coverageRule.ts`.

- Version: `TEXTURE_PREVIEW_VERSION` 8 (`rust/texture.rs`, `core/texture/previewFormat.ts`).
- Writes `rust/texture/bake/write.rs:write_levels`, `rust/texture/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture/blocks/quality.rs`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/materials/texture/levelReader.ts:createTextureLevelReader`, `browser/materials/texture/tileRecords.ts:tileRecord`.

## Prepared scene tables

`scene-tables.json`: nodes, cameras, skins, clips, materials, textures and geometry layout;
the runtime builds its scene from them, parsing no glTF. One `document` holds the published scene;
there is no second scene. Lamps are not here: [`lights.json`](#lightsjson) is the one reading of a
light, and no node names one.

- `hlodMaterials`: per HLOD actor the chain builds, by the rank its world clusters name, the
  `materials` rank of the material it wears.
- Versions: `SCENE_TABLES_VERSION` 9, `NODE_TABLE_VERSION` 7, `MATERIAL_TABLE_VERSION`,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler/tables.rs`, `core/scene/core/tableContracts.ts`).
  Tables 8 / node table 6 dropped `lights` and each node's `light`: they copied the glTF fields raw
  and failed the compile on a non-punctual type, where `lights.json` counts it in `rejected`.
  Node table 7: an animated node that streams carries `"streamed": true` — its mesh is drawn only
  by a row of the cell that holds it ([World partition](#world-partition)), its own host mesh that
  row's animation source —, and an instanced skinned node loaded with the scene carries
  `"bank": <item>` — the item of [`animation-banks.bin`](#animation-banksbin) its mesh plays —,
  hung under its skin's frame at no pose (glTF ignores a skinned node's own transform).
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
  with nodes under it, under its own core node, which keeps no mesh, at no pose —,
  `{parent, mesh, "track": <item>}` —
  an instanced skinned object under its skin's frame (the node its top joints hang under), at no
  pose, playing that item of [`animation-banks.bin`](#animation-banksbin) —, or
  `{parent, mesh, "source": true}` — an animated object of the core (skinned, morphed, moved by a
  clip, or a joint), drawn by a row under its own node at no pose, its host mesh the row's
  animation source. Every object streams on its main grid unless its `objectSettings` say
  `spatiallyLoaded: false`; an object an animation moves — itself or through a parent — takes no
  HLOD layer, nor does an instanced skinned object of `movable` mobility. An instanced skinned
  object's box is its item's sampled bounds at its frame's world, a plain skinned one's the bounds
  of every clip moving its skin, a morphed one's its mesh's grown by its targets' extents. A node
  whose object names a farthest draw distance (`drawDistance` of `objectSettings`,
  [COMPILER.md](COMPILER.md#object-settings)) carries `"drawDistance": {"min", "max"}`, in the
  scene's units, here and in the node table of [`scene-tables.json`](#prepared-scene-tables); one
  naming none carries no byte of it, so the versions are as they were.
- Versions: `PARTITION_VERSION` 13, `CELL_VERSION` 3 (`rust/compiler/tables/partition.rs`,
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
  on it.
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
deviation, a merge taking each object's LOD at its level's own deviation. Each shell is simplified
by volume-preserving quadrics, given unique texture coordinates and baked: those objects'
materials read onto it, so every detail under a pixel lives in the texture. Each actor is built
into its own DAG, its errors its own, and wears its flattened
material: a material of `source.gltf`
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
  the pages are the `WGP3` format 9 ([Pages](#pages)), each actor's grid its own, and a cluster's
  page facts carry no quantization error — five words, not six: the cluster record is 180 bytes,
  not 184. Version 34 (`WORLD_ROOTS_VERSION`): a row names no more whether it is drawn whole — a
  word that no runtime read —, 136 bytes, not 140: an `instanced` layer asking for no cluster DAG
  builds its objects' fallbacks as a `merge` layer does, none of its objects standing as rows.
- DAG layout (version 34): a 24-byte header (magic, version, cluster count, group count, pool
  length, node count), 180-byte clusters — level, triangles, its actor's rank (`hlodMaterials`),
  bundle, offset, HLOD cell — whose level plus one is its HLOD layer —, two zeros, then the `f64`
  error, parent error (NaN for a root),
  sphere, parent sphere, minimum and maximum, then its page's facts: length, vertex count, index
  count, attribute flags and decoded bytes —, 64-byte groups, 128-byte culling nodes, then a `u32`
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
`skinnedInstance`, [COMPILER.md](COMPILER.md)), each sampled once. A bake is one skin's clip at 30
frames a second (`ANIMATION_BANK_SAMPLE_RATE`): each joint's transform in the skin's frame — the
node its top joints hang under — per frame, translation then rotation, and each joint's inverse
bind matrix; identical bakes are written once. An item is what objects play: a bake on a mesh,
whether its track loops, the second it starts from, its play rate, the screen size under which it
rests (0 the run-time setting's, negative never) and its sampled bounds — the mesh's box grown by
every joint's translation of every frame, scaled by its `boundsScale` about its centre —, in the
frame's space. Every instance of one item is in one pose: one track.

- Layout (little-endian, version 1): a 5-word header (magic `TBNK`, version, bake count, item
  count, pool length in floats); 4-word bakes (joints, frames, inverse binds' and keys' first
  float in the pool); 12-word items (bake, flags — bit 0 looping —, position, play rate, minimum
  screen size as `f32`, six `f32` bounds, mesh rank); the `f32` pool: per bake its inverse binds
  (twelve floats a joint, the three rows of its affine part) and its keys (seven floats a joint a
  frame: translation, then the rotation quaternion `x y z w`).
- The manifest names it in `animationBanks` (`url`, `version`, `bytes`, `sha256`, `items`), absent
  for a scene with no item. A cell node's `track`, a core node's `bank`, is an item's rank.
- Versions: `ANIMATION_BANKS_VERSION` (`rust/compiler/tables/motion/bank.rs`,
  `core/contracts/writtenFormats.ts`).
- Writes `rust/compiler/tables/motion/bank.rs:bake_banks`; reads
  `core/scene/core/animationBanks.ts:decodeAnimationBanks`.

## `lights.json`

The source's punctual lights in the engine's radiometric light contract, world space: the one
product that reads a light (type, colour, intensity, range, cone, transform). A light of another
type, a bad matrix or a non-positive intensity is counted in `rejected`, never a failed compile.

- Versions: `SCENE_LIGHTS_VERSION`, `SCENE_LIGHT_CONTRACT` (`rust/compiler/lights.rs`);
  `IMPORTED_LIGHTS_VERSION` (`browser/lighting/importedLights.ts`).
- Writes `rust/compiler/lights.rs:stage_scene_lights`; reads
  `browser/lighting/importedLights.ts:loadImportedLights` (an unknown version reads as no light).

## `physics.json` — cooked colliders

Colliders as Jolt binary state, readable only by the Jolt commit that wrote them, and their static
instances.

- Versions: `PHYSICS_FORMAT_VERSION`, `PIECES_FORMAT_VERSION`, `JOLT_COMMIT` (`rust/physics_cook.rs`);
  `PHYSICS_FORMAT_VERSIONS` (`core/physics/cooked.ts`).
- Writes `rust/physics_cook/stage.rs:stage_physics`; reads `core/physics/cooked.ts:readCookedPhysics`.

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

## Resident lighting proxy

`proxy.bin`: one proxy a compiled mesh, in the mesh's own space — its coarse cut snapped to a grid and built
into a 4-wide BVH by the one builder the browser's run-time cuts go through (`page-codec-wasm/src/proxy.rs`,
`columns_of`) — which a ray meets through the world of the node that places it. No instance is written: the
engine's placements are the instances (`browser/geometry/dag/proxy/proxyInstances.ts`).

- Version: `SCENE_PROXY_VERSION` (`rust/proxy.rs`, `core/contracts/proxy.ts`): 6.
- Layout, little-endian words: the header (`SCENE_PROXY_HEADER_WORDS`: magic, version, mesh count, triangle
  total, node total, reserved); a table of three words a mesh, in compiled-primitive order — its triangles, its
  nodes, its grid step as an `f32` — (a primitive no shown node places holds zero of both); then every mesh's
  triangles (nine floats), their packed albedo, the nodes' exact bounds (six floats) and the nodes' children
  (twelve words), each column of all the meshes in table order. A mesh's links name its own triangles and nodes,
  from zero.
- Writes `rust/proxy/encode.rs:SceneProxy::encode`; reads `core/scene/core/proxy.ts:decodeSceneProxy`.

## Deformation in geometry page format 9

Joints, weights, morph deltas and simulation-source IDs behind a geometry page's flags;
`primitives[].deformation` bounds their reach.

- Flags: `FLAG_SKIN`, `FLAG_MORPH` (`codec/deform.rs`), `FLAG_SOFT_SOURCE` (`codec/lib.rs`).
- Writes `codec/encode/deformation.rs:page_deformation`; reads
  `codec/deform.rs:parse` (through `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`), `browser/deformation/softSource.ts:cookedSoftSource`.

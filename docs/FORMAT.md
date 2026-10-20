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
(`scripts/compiler-hashes.ts`): the five platforms agree byte for byte; against `develop` a family
may differ only when its version differs too, listed `changed on purpose (name vN → vM)`, and a byte
change with no version change fails, naming the version to bump. `clusters.json`, the head page and
the content-addressed objects embed several families and are allowed by any version change.

## Layout

`native/<scope>/manifest.json`, the pointer, names `native/<scope>/<key>/`: `clusters.json`, its
pages and the products below. Shared objects are `native/objects/<sha256>.bin`, named by content
(`rust/compiler_storage.rs:object_path`); every texture's level chain lives under `native/textures/v<N>/<sha>/`, one folder per chain source and sheet (`texture_preview/gate.rs:GateSheet::key`), written once, pruned by folder
(`rust/compiler_prune_textures.rs`).

## Pointer

`manifest.json`: status, format, key, scope (`slice` or `full`) and the URL of `clusters.json`.

- Versions: `FORMAT_VERSION` 11, `CLUSTERED_BLEND_FORMAT_VERSION` 12 (`rust/compiler_format.rs:cache_format`
  picks; `core/contracts/base.ts`).
- Writes `rust/compiler_publish.rs:write_pointer`; reads `core/contracts/cache.ts:assertCachePointer`.

## `clusters.json`

The manifest as a page tree: a fixed-size root, a head page with every other field, and mesh pages
of slim primitives, each page with its column file. No run measure is written: a rebuild writes the
same bytes.

- Versions: the cache format; `DAG_ERROR_MODEL` (`rust/lib.rs`, `core/contracts/base.ts`).
- Writes `rust/compiler_manifest_pages.rs:write_manifest`.
- Reads `core/contracts/cache.ts:assertCacheRoot`, `core/manifest/paged.ts:readPagedManifest`,
  `core/contracts/cache.ts:assertCacheIdentity`; types `core/contracts/geometry.ts:ClusterManifest`.

### Column files

`manifest-page-<sha256>.bin`: per-cluster numbers as typed-array columns, mapped, not parsed.

- Version: `MANIFEST_BINARY_VERSION` 13, 28 columns in `COLUMN_NAMES` order, with the
  `texturePreviewBc7`, `texturePreviewAstc` and `texturePreviewEtc2` block columns
  (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`). 13 lays every geometry page in a
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

Per primitive: clusters, the groups replacing them level by level, a culling tree and streaming
bundles whose dependencies close up to the pinned roots.

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/geometry/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler_page_bundles.rs:pack_bundles`,
  `rust/compiler_bundle_dependencies.rs`; normal cones `codec/normal_cone.rs`, measured by the
  encoder on the positions each page decodes to (`codec/encode.rs:decoded_cone`), the faces the GPU
  draws, so a cone never rejects a face drawn toward the view; the culling tree
  `codec/culling.rs:build_culling_bvh`, the one builder of a primitive's, the world's
  (`world-roots.dag`) and a run-time cut's hierarchy.

## Pages

Index pages (`u32` indices, concatenated in bundles) and `WGP3` geometry pages, quantized clusters a
shader reads in place, decoded alike by Rust, JavaScript and WGSL.

- Versions: `VERSION`, `HEADER_WORDS` (`codec/lib.rs`), printed into `GEOMETRY_PAGE_FORMAT_VERSION`
  and the other constants of `core/page/format.ts` (`pnpm run generate:shared-rules`), declared by the
  manifest's `geometryPages`.
- Writes `codec/encode.rs:encode_deformed`, the one encoder: the compiler's
  `rust/compiler_page_record.rs:encode_page`, `rust/compiler_world_roots/pages.rs:encode_pages` and
  the run-time cut (`browser/geometry/codec/encodeGeometryPage.ts`, `codec/wasm/encode.rs`) call it; grid
  `codec/bits/grid.rs:grid_exponent`.
- Reads `browser/geometry/cluster/pages.ts:fetchVerified`, `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`,
  `codec/unpack.rs:decode`, `browser/geometry/cluster/decodeWgsl.ts`.

### Voxels

A voxelized mesh's far levels (`rust/voxel`, [COMPILER.md](COMPILER.md#voxels-far-away)) are
`voxels.bin` (version 4, the manifest's `voxels` section): a head — `T3VX`, the version, the group
and brick counts —, a 48-byte record per group (its primitive, `u32::MAX` for a mesh's far group;
its DAG group or compiled mesh; first brick and count; first voxel and count; its error, the error
it is replaced at and its voxels' side as `f32`; its first brick's corner, `f32` × 3), 16-byte bricks
(mask `u64`, bit `x + 4y + 16z`; corner in bricks from the group's first, `u16` × 3; joint `u16`,
`0xFFFF` none), 12-byte voxels in each brick's mask order (sRGB base colour and normals' spread;
occlusion, roughness, metalness and a zero; mean normal, octahedral; two zeros): what the runtime
reads of a voxel, no more. Version 4: a voxel's coverage and material stay in the compiler, and a
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
encoded again with the encoder's slow search (`blocks.rs:Effort`) and kept, same weight, its
figures in the report. A block whose read-back flips a texel across an alpha cutoff is encoded
again (`blocks/quality.rs:keep_sides`). A level file opens on a head of one little-endian `u32` per
tile record — where its compressed bytes end, counted from the head's end —, then each record (the
tile's blocks and gutter) raw DEFLATE alone: one Range reads the head, one a tile, and the browser
inflates it (`DecompressionStream`). The runtime takes the first family the device's features allow
(`browser/materials/texture/blockFormats.ts:chooseBlockFormat`); a device with none reads the BC files and
decodes them to RGBA8 (`browser/materials/texture/blockDecode.ts`).
Coverage-preserving alpha: `rust/texture_preview/coverage.rs`, mirrored by
`browser/materials/texture/coverageRule.ts`.

- Version: `TEXTURE_PREVIEW_VERSION` 8 (`rust/texture_preview.rs`, `core/texture/previewFormat.ts`).
- Writes `rust/texture_preview/bake_write.rs:write_levels`, `rust/texture_preview/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture_preview/blocks/quality.rs`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/materials/texture/levelReader.ts:createTextureLevelReader`, `browser/materials/texture/tileRecords.ts:tileRecord`.

## Prepared scene tables

`scene-tables.json`: nodes, cameras, skins, clips, materials, textures and geometry layout;
the runtime builds its scene from them, parsing no glTF. One `document` holds the published scene;
there is no second scene. Lamps are not here: [`lights.json`](#lightsjson) is the one reading of a
light, and no node names one.

- `hlodMaterials`: per HLOD actor above HLOD 0, by the rank its world clusters name, the
  `materials` rank of the flattened material it wears.
- Versions: `SCENE_TABLES_VERSION` 9, `NODE_TABLE_VERSION` 6, `MATERIAL_TABLE_VERSION`,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler_tables.rs`, `core/scene/core/tableContracts.ts`).
  Tables 8 / node table 6 dropped `lights` and each node's `light`: they copied the glTF fields raw
  and failed the compile on a non-punctual type, where `lights.json` counts it in `rejected`.
- Writes `rust/compiler_tables.rs:stage_scene_tables`; reads
  `core/scene/core/tableContracts.ts:assertSceneTables`, `browser/scene/host/prepared/build.ts:buildPreparedScene`.

### World partition

Nodes that only place a mesh move into spatial cells (`scene-cell-<n>.json`) under paged slots
(`scene-page-<sha256>.json`) and the fixed-size root `partition`. The cells are a loose hierarchical
grid (`rust/compiler_tables/partition/grid.rs`): every placed node in the cell of the main grid its
world box goes to — 2D, glTF's `+Y` dropped, cells of 128 m (half the loading range), loaded within
256 m —, a grid cell's nodes packed in files of one stream unit each. Each cell names its HLOD 0
cell and the bounds the HLOD grids stream it by (`rust/compiler_tables/partition/hlod.rs`).

- Versions: `PARTITION_VERSION` 6, `CELL_VERSION` (`rust/compiler_tables/partition.rs`,
  `core/scene/core/tablePartition.ts`, `core/scene/core/tableCell.ts`). Version 6: a cell record
  adds `grid` (`[level, x, z]`), `bounds` (its grid cell's content, world space) and `hlod`
  (`[HLOD 0 cell, its streaming bounds on the HLOD 0 grid, its HLOD 1 actor's cell's on the HLOD 1
  grid]`); the root adds `hlod`: `ranges`, the main grid's and each HLOD grid's loading range as
  `f64` bits in sixteen hexadecimal digits each (256, 512, 1024, 2048 m: one per level the HLOD
  chain reaches, the HLOD 0 grid's alone for a world naming no HLOD), and `cells`, the HLOD 0
  cells' count in eight. The whole root of a world placing one mesh under the scene, naming no
  HLOD, is 1 816 bytes.
- Writes `rust/compiler_tables/partition.rs:partition`, `rust/compiler_tables/partition/pages.rs:write_page`.
- Reads `core/scene/core/tablePartition.ts:readCellPage`, `core/scene/core/tableCell.ts:assertCellNodes`.

### World HLOD

HLOD chains of the layers a job names (`rust/compiler_args/hlod.rs`,
`rust/compiler_tables/partition/hlod.rs`), only over the objects a mark or a rule assigns a layer:
HLOD 0 is an instanced layer, the placed objects' own pages instanced; each level above is, per
cell of the level below, the closed shell or the merge of its objects at HLOD 1, of the actors
below above it, each at its layer's accuracy and simplified within its geometric deviation. Each
shell is simplified by volume-preserving quadrics, given unique texture coordinates and the
materials of the objects under it baked onto it: every detail under a pixel lives in the texture.
Each actor is built into its own DAG, its errors raised by how far it lies from its sources, and
wears its flattened material: a material of `source.gltf` — a base colour and a normal map, metallic
0 and roughness 0.5 since no other map is baked, translucent surfaces passed through —, its atlas
images' chains in the texture section, each image the one-pixel stand-in `data:` address of a baked
image — a PNG product beside it (`hlod-*.png`) only where a chain lacks a level
(`rust/compiler_world_roots/flatten/publish.rs`). Each level's grid doubles cell and range; a
level from HLOD 2 on (`TOP_LEVEL`) doubles once more — 256, 512, then 2 048 m cells —, and every
chain's top actors are made by cells of that 2 048 m grid, a shorter chain's top built once more
there; they are always loaded, held within their own budget
(`browser/geometry/hlod/worldBundles.ts`). `world-roots.table` and `world-roots.dag` (fixed-size records) and
`world-roots.bin` (the bundles, `rust/compiler_world_roots.rs`). Each HLOD cell's roots lie in
bundles of their own, held — pinned in the page cache — while its actor is loaded.

- A blended primitive is a source as any; the flattened material is opaque: the shell stands in
  far away, where sorting its layers would cost more than the blend shows.
- A `voxel` layer's actor (`rust/compiler_world_roots/voxels.rs`) is the cell's objects voxelized
  together: each of its clusters is a voxel page ([Voxels](#voxels)), its page facts' flags
  `GEOMETRY_VOXEL`, its triangles its bricks' boxes'; its levels double from the pixel where the
  cell is first seen, each page replaced by the one above it holding its bricks; it wears the
  material of its first opaque object.
- Table layout (little-endian, version 16): a 64-byte header (magic, version, bundle, page and
  HLOD cell counts, pool length, the binary's length as two words, its 32-byte digest), 56-byte
  bundles, 24-byte pages, 64-byte HLOD cells of the chain, HLOD 0 cells first (the bundles holding
  its roots, in the pool; the cell its next level's actor lies in, `u32::MAX` for a cell whose
  actor is its chain's top; its level in the low 16 bits and, in the high 16, 1 when its actor's
  build failed — an actor built is one whose bundles hold roots —; the six `f64` bounds it streams
  by), then a `u32` pool. Version 15 added the flag: a failed top keeps its content standing, a
  cell in no layer — neither built nor failed — follows its range alone (`CHAIN_ACTOR`). Version
  16: a cluster may hold a voxel page. Version 17: that page's head is six words, its bricks five,
  its voxels twelve bytes ([Voxels](#voxels)).
- DAG layout (version 17): a 24-byte header (magic, version, cluster count, group count, pool
  length, node count), 184-byte clusters — level, triangles, its actor's rank (`hlodMaterials`),
  bundle, offset, HLOD cell — whose level plus one is its HLOD layer —, two zeros, then the `f64`
  error, parent error (NaN for a root),
  sphere, parent sphere, minimum and maximum, then its page's facts —, 64-byte groups, 120-byte
  culling nodes, then a `u32` pool. The clusters lie in the order of the world's culling hierarchy,
  built by the one builder a primitive's goes through (`page-codec-wasm/src/culling.rs`): a
  cluster's rank is the one every record names it by, and each node — fifteen `f64`, a primitive's
  node layout — names a contiguous range of those ranks.

- Versions: `WORLD_ROOTS_VERSION` (`rust/compiler_world_roots.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/compiler_world_roots/pack.rs:pack_world`, `rust/compiler_world_roots/records.rs:encode_table`,
  `rust/compiler_world_roots/dag_records.rs:encode_dag`.
- Reads `core/manifest/worldRootsTable.ts:readWorldRoots`, `core/manifest/worldRootsTable.ts:readWorldRootsDag`,
  `core/manifest/worldRoots.ts:bundlePageRanges`.

## `lights.json`

The source's punctual lights in the engine's radiometric light contract, world space: the one
product that reads a light (type, colour, intensity, range, cone, transform). A light of another
type, a bad matrix or a non-positive intensity is counted in `rejected`, never a failed compile.

- Versions: `SCENE_LIGHTS_VERSION`, `SCENE_LIGHT_CONTRACT` (`rust/compiler_lights.rs`);
  `IMPORTED_LIGHTS_VERSION` (`browser/lighting/importedLights.ts`).
- Writes `rust/compiler_lights.rs:stage_scene_lights`; reads
  `browser/lighting/importedLights.ts:loadImportedLights` (an unknown version reads as no light).

## `physics.json` — cooked colliders

Colliders as Jolt binary state, readable only by the Jolt commit that wrote them, and their static
instances.

- Versions: `PHYSICS_FORMAT_VERSION`, `PIECES_FORMAT_VERSION`, `JOLT_COMMIT` (`rust/physics_cook.rs`);
  `PHYSICS_FORMAT_VERSIONS` (`core/physics/cooked.ts`).
- Writes `rust/physics_cook/stage.rs:stage_physics`; reads `core/physics/cooked.ts:readCookedPhysics`.

### `bodies` — declared rigid bodies

Declared motion and shape, or a cooked hull with its mass: `rust/physics_cook/declared.rs`;
`browser/physics/cookedBodies.ts:createCookedBodies`.

### `softBodies` — cooked soft bodies

Cloth, rope and volume as Jolt settings at the node's scale: `rust/physics_cook/soft_record.rs:soft_record`;
`browser/physics/cookedSoft.ts:createCookedSoftBodies`.

## Source glTF

`source.gltf`/`source.bin`, the compacted selection: `rust/compiler_scene.rs:write_source_scene`;
read through the [prepared scene tables](#prepared-scene-tables), which lay out this one document.

## Source files

The input: a folder with a source manifest, a folder with one glTF or GLB, or the file.
`SOURCE_FORMAT_VERSION` (`rust/compiler_format.rs`); `rust/compiler_runtime.rs:load_model_file`,
`rust/compiler_safe_path.rs:is_safe_source_name`, `rust/accessor_validation.rs`.

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

## Deformation in geometry page format 7

Joints, weights, morph deltas and simulation-source IDs behind a geometry page's flags;
`primitives[].deformation` bounds their reach.

- Flags: `FLAG_SKIN`, `FLAG_MORPH` (`codec/deform.rs`), `FLAG_SOFT_SOURCE` (`codec/lib.rs`).
- Writes `codec/encode/deformation.rs:page_deformation`; reads
  `codec/deform.rs:parse` (through `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`), `browser/deformation/softSource.ts:cookedSoftSource`.

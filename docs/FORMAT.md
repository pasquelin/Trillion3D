# Cache formats — where the code defines them

A compilation writes a cache folder; the SDK reads it. The code is the contract: each section names
a file, its version constants, the Rust that writes it and the TypeScript that reads it. A reader
refuses an unknown version before reading a field, never half-reads.

Paths: `rust/` is `packages/asset-compiler-rust/src/`, `codec/` `packages/page-codec-wasm/src/`,
`core/` `packages/sdk-core/src/`, `browser/` `packages/sdk-browser/src/`.

## Layout

`native/<scope>/manifest.json`, the pointer, names `native/<scope>/<key>/`: `clusters.json`, its
pages and the products below. Shared objects are `native/objects/<sha256>.bin`, named by content
(`rust/compiler_storage.rs:object_path`); texture levels live under `native/textures/v<N>/`.

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

- Version: `MANIFEST_BINARY_VERSION` 11, with the `texturePreviewBc7`, `texturePreviewAstc` and
  `texturePreviewEtc2` block columns (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`).
- Writes `rust/manifest_binary.rs:columns`; reads `core/manifest/binaryRead.ts:readManifestColumns`,
  `core/manifest/binaryDecode.ts:decodeManifestBinary`.

### Cluster DAG

Per primitive: clusters, the groups replacing them level by level, a culling tree and streaming
bundles whose dependencies close up to the pinned roots.

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/page/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler_primitive_bundle/pack.rs:pack_bundles`,
  `rust/compiler_bundle_dependencies.rs`; normal cones `codec/normal_cone.rs`.

## Pages

Index pages (`u32` indices, concatenated in bundles) and `WGP3` geometry pages, quantized clusters a
shader reads in place, decoded alike by Rust, JavaScript and WGSL.

- Versions: `VERSION`, `HEADER_WORDS` (`codec/lib.rs`); `GEOMETRY_PAGE_FORMAT_VERSION`
  (`core/manifest/binaryFormat.ts`), declared by the manifest's `geometryPages`.
- Writes `rust/compiler_primitive_bundle.rs:bundle_dag_pages`, `rust/compiler_page_object.rs:store_page`,
  `rust/geometry_page.rs:encode_deformed`; grid `codec/bits/grid.rs:grid_exponent`.
- Reads `browser/cluster/pages.ts:fetchVerified`, `browser/page/codec/geometryPage.ts:decodeGeometryPage`,
  `codec/unpack.rs:decode`, `browser/cluster/decodeWgsl.ts`.

## Textures

Every atlas texture's mip chain: the tail in the head's column file, one lossless PNG per level
above it, and block tile-record files where the quality gate passes: BC (`bc7`, `bc5` for two
channels), ASTC and ETC2/EAC (`etc2`, `eac-rg`). All three families are cooked by default
(`--textures-format`, default `all`); the runtime takes the first family the device's features
allow (`browser/texture/blockFormats.ts:chooseBlockFormat`), PNG the last fallback.
Coverage-preserving alpha: `rust/texture_preview/coverage.rs`, mirrored by
`browser/texture/coverageRule.ts`.

- Version: `TEXTURE_PREVIEW_VERSION` 7 (`rust/texture_preview.rs`, `core/texture/previewFormat.ts`).
- Writes `rust/texture_preview/bake_write.rs:write_levels`, `rust/texture_preview/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture_preview/blocks/quality.rs`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/texture/levelReader.ts:createTextureLevelReader`, `browser/texture/tileRecords.ts:tileRecord`.

## Prepared scene tables

`scene-tables.json`: nodes, lights, cameras, skins, clips, materials, textures and geometry layout;
the runtime builds its scene from them, parsing no glTF. One `document` holds the published scene;
there is no second scene.

- Versions: `SCENE_TABLES_VERSION` 7, `NODE_TABLE_VERSION`, `MATERIAL_TABLE_VERSION`,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler_tables.rs`, `core/scene/core/tableContracts.ts`).
- Writes `rust/compiler_tables.rs:stage_scene_tables`; reads
  `core/scene/core/tableContracts.ts:assertSceneTables`, `browser/host/prepared/build.ts:buildPreparedScene`.

### World partition

Nodes that only place a mesh move into spatial cells (`scene-cell-<n>.json`) under paged slots
(`scene-page-<sha256>.json`) and the fixed-size root `partition`.

- Versions: `PARTITION_VERSION`, `CELL_VERSION` (`rust/compiler_tables/partition.rs`,
  `core/scene/core/tablePartition.ts`, `core/scene/core/tableCell.ts`).
- Writes `rust/compiler_tables/partition.rs:partition`, `rust/compiler_tables/partition/pages.rs:write_page`.
- Reads `core/scene/core/tablePartition.ts:readCellPage`, `core/scene/core/tableCell.ts:assertCellNodes`.

### World super-roots

The DAG continued above placed objects up to a pinned world top: `world-roots.table` and
`world-roots.dag` (fixed-size records) and `world-roots.bin` (the bundles).

- Bundle order: the pinned top's bundles first, then each cell's held roots right after them, one
  run per cell, capped by bytes. A root only one cell needs is held by that cell; only the roots
  several cells share are pinned, so the pinned top stays within 4 MB (`WORLD_TOP_BUDGET_BYTES`).
  The schema is unchanged.
- Table layout (little-endian, version 5): an 80-byte header, 56-byte bundles, 24-byte pages,
  16-byte cells, 24-byte objects, then a `u32` pool. A cell record is four `u32` words: the rank of
  its first object, its object count, then the pool offset and length of a list holding each of
  its nodes' first object among the cell's objects (`u32::MAX` for a node with none).

- Versions: `WORLD_ROOTS_VERSION`, budget `WORLD_TOP_BUDGET_BYTES` (`rust/compiler_world_roots.rs`);
  `VERSION` (`core/manifest/worldRootsTable.ts`).
- Writes `rust/compiler_world_roots/pack.rs:pack_world`, `rust/compiler_world_roots/records.rs:encode_table`.
- Reads `core/manifest/worldRootsTable.ts:readWorldRoots`, `core/manifest/worldRoots.ts:worldBundlePages`.

## `lights.json`

The source's punctual lights in the engine's radiometric light contract.

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
`rust/compiler_validate.rs:is_safe_source_name`, `rust/accessor_validation.rs`.

## Resident lighting proxy

`proxy.bin`: simplified world-space triangles light rays hit, their wide BVH and owners.

- Version: `SCENE_PROXY_VERSION` (`rust/proxy.rs`, `core/contracts/proxy.ts`).
- Writes `rust/proxy/encode.rs:SceneProxy::encode`; reads `core/scene/core/proxy.ts:decodeSceneProxy`.

## Impostor atlases

The manifest's `impostors`: a verdict per drawn mesh and, when baked, an octahedral three-map atlas.

- Version: `IMPOSTOR_VERSION` (`rust/impostor/stage.rs`, `core/contracts/impostor.ts`).
- Writes `rust/impostor/stage.rs:stage_stand_ins`, `rust/impostor/octahedron.rs`.
- Reads `core/contracts/impostor.ts:assertImpostorSection`, `browser/impostor/atlas.ts`.

## Deformation in geometry page format 7

Joints, weights, morph deltas and simulation-source IDs behind a geometry page's flags;
`primitives[].deformation` bounds their reach.

- Flags: `FLAG_SKIN`, `FLAG_MORPH` (`codec/deform.rs`), `FLAG_SOFT_SOURCE` (`codec/lib.rs`).
- Writes `rust/geometry_page_deform.rs:page_deformation`; reads
  `browser/page/codec/geometryPageDeform.ts:readDeformation`, `browser/deformation/softSource.ts:cookedSoftSource`.

# Prepared scene tables

`scene-tables.json`: nodes, cameras, skins, clips, materials, textures and geometry layout; the
runtime builds its scene from them, parsing no glTF. One `document` holds the published scene. Lamps
are not here: [`lights.json`](lightsjson.md#lightsjson) reads lights, and no node names one.

- `hlodMaterials`: per HLOD actor the chain builds, by the rank its world clusters name, the
  `materials` rank of the material it wears.
- A material's `displacement` ([Displacement](../compiler/displacement.md#displacement)): only a
  displaced material has it,
  `{ "map": slot, "magnitude", "center", "fade": { "start", "end" } | null, "uvDensities": [d0, d1, d2, d3] }`.
  `map` is a texture slot like the other maps' (`texture`, `texCoord`, `slotTexCoord`, `transform`);
  `uvDensities` is the measured density of the first four coordinate sets (0: no triangle measured;
  absent when none was; a reader then uses 1). A reader that does not know the field reads it flat.
- A material's `responsive`
  ([Temporal anti-aliasing](../compiler/temporal-anti-aliasing.md#temporal-anti-aliasing)): only a
  material above `off` has it, `"medium"` or `"full"` (from the job's `materials`, its `responsive`
  match and the material's `extras`).
- A material's `sky` ([A sky material](../compiler/a-sky-material.md#a-sky-material)): only a sky
  material has it, `true` (from the job's `materials` and the material's `extras`); an unaware reader
  reads a plain material.
- Versions: `SCENE_TABLES_VERSION` 9, `NODE_TABLE_VERSION` 7, `MATERIAL_TABLE_VERSION` 6,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler/tables.rs`, `core/scene/core/tableContracts.ts`).
  - Material table 6 names the level in `responsive` (4 and 5: `responsive: true` and a
    `temporalAntialiasing` number). Tables 8 / node table 6 dropped `lights` and each node's `light`.
  - Node table 7: an animated node that streams carries `"streamed": true` (its mesh is drawn only by a
    row of its cell, [World partition](#world-partition)). An instanced skinned node loaded with the
    scene carries `"bank": <item>` (the item of
    [`animation-banks.bin`](animation-banksbin.md#animation-banksbin) its mesh plays), hung under its
    skin's frame at no pose.
  - A static object kept in the core as the frame of the nodes under it, its mesh drawn by a row of its
    cell, carries `"meshStreams": true`: its collider is made and let go with that cell (else it
    streams by distance alone).
- Writes `rust/compiler/tables.rs:stage_scene_tables`; reads
  `core/scene/core/tableContracts.ts:assertSceneTables`,
  `browser/scene/host/prepared/build.ts:buildPreparedScene`.

## World partition

Nodes that place a mesh move into spatial cells (`scene-cell-<n>.json`) under paged slots
(`scene-page-<sha256>.json`) and the fixed-size root `partition`. Cells are those of the job's scheme
grids (`partitionScheme`, `rust/compiler/tables/partition/grid.rs`,
[COMPILER.md](../compiler/the-partitions-grids.md#the-partitions-grids)): `hashSet` (default) loose
hierarchical grids, each cell streaming by the box around its content or the bounds the job names;
`spatialHash` square grids over the world, each cell streaming by its square.

Each batch (the topmost object above a node and every object under it) goes to the main-grid cell of
the box around its objects: 2D, glTF's `+Y` dropped, unless a `hashSet` job lays its grids off the
ground. The main grid is the job's (`partitionGrid`), cells of 128 m loaded within 256 m by default, or,
with several (`partitionGrids`), the one its object names. A grid cell's nodes are packed in files of
one stream unit each, grouped by HLOD 0 cell. Each cell names its HLOD 0 cell, the bounds it streams
by, its grid and level, and its main grid when not the first (`rust/hlod/cells.rs`,
`rust/hlod/grids.rs`).

- Cell file node kinds:
  - `{parent, mesh, matrix | translation, rotation, scale}`: a static leaf under its nearest core node,
    at its declared pose;
  - `{parent, mesh}`: a static object with nodes under it, under its own core node (`meshStreams`), at
    no pose;
  - `{parent, mesh, "track": <item>}`: an instanced skinned object under its skin's frame, at no pose,
    playing that item of [`animation-banks.bin`](animation-banksbin.md#animation-banksbin);
  - `{parent, mesh, "source": true}`: an animated object of the core (skinned, morphed, moved by a
    clip, or a joint), drawn by a row under its own node at no pose, its host mesh the row's source.
- Every object streams on its main grid unless its `objectSettings` say `spatiallyLoaded: false`. An
  object that [`physics.json`](physicsjson-cooked-colliders.md#physicsjson--cooked-colliders) moves or
  bends (a declared soft body, a moving rigid body declared by it or a node above) is animated: its
  node stays in the core and its cell draws it (`"source": true`); its body, a static collider too, is
  made when that cell is placed and let go when it leaves.
- Every cell node names its source node (`"sourceNode"`, rank in eight lowercase hexadecimal digits,
  as in the node table of [`scene-tables.json`](#prepared-scene-tables)).
- An object an animation moves (itself or through a parent) takes no HLOD layer, nor does an instanced
  skinned object of `movable` mobility. Box: instanced skinned, its item's sampled bounds; plain
  skinned, the bounds of every clip moving its skin; morphed, its mesh's grown by its targets' extents.
- A node whose object names a draw distance (`drawDistance` of `objectSettings`,
  [COMPILER.md](../compiler/the-partitions-grids.md#object-settings)) carries
  `"drawDistance": {"min", "max", "perInstance"}`, in scene units, here and in the node table of
  [`scene-tables.json`](#prepared-scene-tables). `perInstance` (boolean): the object is one instance of
  an instanced mesh, tested at its bounds' centre; `min` or `max` 0 names no such end.
- A node that is an instance of an assembly (`allowAssemblies`,
  [COMPILER.md](../compiler/assemblies.md#assemblies)) carries `"rootParents"`, here and in the node
  table of [`scene-tables.json`](#prepared-scene-tables): one entry per primitive of its mesh, in order,
  `[error, x, y, z, radius]` (error and LOD ball, in the primitive's space, of the group replacing its
  root in the assembly's primitive), or `null` for a primitive no group replaces.
  - A runtime that ignores it never closes an instance: a doubled surface far away.
  - The assembly's mesh names the primitives carrying its levels in `extras.assemblyBuilt` of
    `source.gltf`; each node of the assembly carries `extras.assemblyInstance`
    `{ "of": mesh, "at": rank }`. A placeholder primitive added to carry an assembly's levels (never
    read) carries `extras.assemblyTop`; a mesh drawn as part of an assembly carries
    `extras.assemblyPart`, the assembly mesh's rank, giving it that assembly's tangents, voxel settings
    and voxelization. A placeholder no instance can join builds no compiled primitive (`source.gltf`
    keeps it, the manifest does not list it).
- Versions: `PARTITION_VERSION` 13, `CELL_VERSION` 4 (`rust/compiler/tables/partition.rs`,
  `core/scene/core/tablePartition.ts`, `core/scene/core/tableCell.ts`).
  - 6: a cell record adds `grid`, `bounds`, `hlod`; the root `hlod`.
  - 8: every grid is a square grid over the world. A cell's `bounds` is its grid cell's square on the
    plane, its content's up axis kept; its `hlod` is `[HLOD 0 cell, square it streams by, grid rank]`,
    `null` for objects in no layer. The root's `hlod` is `grids` (per grid, main first: finest cell
    side and loading range as `f64` bits in sixteen hexadecimal digits each, then load priority in
    eight: main grid's the job's, 0 by default; an HLOD grid's 100 plus its level) and `cells`, the
    HLOD 0 cells' count in eight.
  - 9 / cell 3: a cell node may name a `track` or `source`.
  - 7: HLOD grids `· (2 << i)` the main one's.
  - 10: the root names its `scheme` (`"hashSet"` or `"spatialHash"`); each `grids` entry adds its HLOD level in eight hexadecimal digits
    after its priority (forty-eight in all), an HLOD grid's priority 0 under `hashSet`. A cell's
    `bounds` is the box around its content under `hashSet`; its `hlod` is
    `[HLOD 0 cell, bounds, grid, level]`.
  - 11: the root says whether its grids lie `flat` (boolean; a cell's `grid` is then `[level, x, z]`,
    else `[level, x, y, z]`); its `hlod` adds `coarser`: per grid, main first, `null`, or for a square
    grid whose wished cells pull in overlapping coarser cells, its ground origin (two `f64` bit
    patterns, sixteen hexadecimal digits each) then its finest level's cells per side in eight.
  - 12: each `grids` entry adds flags (eight hexadecimal digits, fifty-six in all): bit 0 set when a
    load blocks on slow streaming (main grid: `blockOnSlowStreaming`; HLOD grid: never).
  - 13: a layer's HLOD 0 cells are a main cell's objects of that layer (an instanced layer's on its own
    grid); flags bit 1: cell files stream on the grid (`browser/geometry/partition/reach.ts`,
    `placedReach`).
  - 14 is 13 for a scene of several main grids (`partitionGrids`, two or more): a runtime that reads
    one grid refuses it by name; a one-grid scene stays 13. Added then only: root `hlod.mains` (how
    many of the first `grids` are main grids); cell `main`, the rank among `hlod.grids` of its main
    grid (left out for the first); flags bit `4`: the grid lies flat unlike the root's `flat` (the first
    grid's); flag bit `2` is set on a main grid only when a cell file or an HLOD 0 cell lies on it. An
    HLOD 0 cell of a non-instanced layer lies on the main grid of the cell its objects are in
    (`hlod[2]`).
  - Cell 4: every cell node names its `sourceNode`.
- Writes `rust/compiler/tables/partition.rs:partition`,
  `rust/compiler/tables/partition/pages.rs:write_page`.
- Reads `core/scene/core/tablePartition.ts:readCellPage`, `core/scene/core/tableCell.ts:assertCellNodes`.

## World HLOD

HLOD chains of the layers a job names (`rust/hlod/options.rs`, `rust/hlod/cells.rs`), over objects a
mark or a rule assigns a layer.
- HLOD 0: an instanced layer's is the placed objects' own pages instanced, any other's is built per
  main cell of its objects.
- Each level above is, per cell of the level below, the closed shell, merge, voxels or instances of the
  cell's original objects (every object under the cell); no level reads an actor of the level below.
  Each is at its layer's accuracy, simplified within its geometric deviation; a merge takes each
  object's LOD as its layer selects (`lodSelection`) and never simplifies the merged mesh.
- Each shell: volume-preserving quadric simplification, unique texture coordinates, baked from those
  objects' materials; each actor is its own mesh with its flattened material.
- A layer asking for a cluster DAG (`clusterDag`) builds the actor into its own DAG. By default the
  actor is its level 0 alone: exact clusters, every one a root, every page a root page held with its
  cell; drawn whole at every distance (`browser/geometry/hlod/worldHlod.ts`,
  `rust/hlod/chain/builds.rs:build`).

The flattened material is a material of `source.gltf`:
- a base colour and the maps its layer bakes: by default a normal map, roughness 0.5 and metallic 0 as
  the material's factors, or a metal-roughness map where the layer bakes either; baked specular is in
  the red channel;
- an emission map where the layer bakes one, `emissiveFactor` and `KHR_materials_emissive_strength` the
  emission's largest channel;
- each image at its own side where the layer sizes its maps apart;
- a texel reads the source view facing it most squarely (no translucent surface drawn); a texel no
  view sees is filled from its neighbours;
- atlas image chains are in the texture section, each image the one-pixel stand-in `data:` address of a
  baked image; a PNG beside it (`hlod-*.png`) only where a chain lacks a level
  (`rust/hlod/flatten/bake/publish.rs`).

Each layer's actors stream on the grid of its level (`rust/hlod/grids.rs`): under `hashSet` (default) a
loose grid of `2 << i` times the main grid's cell and range for HLOD level `i` (HLOD 0 to 3: 256, 512,
1 024 and 2 048 m cells, loaded within 512, 1 024, 2 048 and 4 096 m by default), an HLOD cell
streaming by its content clipped to its square on the finest level; under `spatialHash` the square
grid the layer names (`cellSize`, `loadingRange`), an HLOD cell streaming by its square. An actor built
by a layer not spatially loaded, or, on a square grid, held whole by no cell below the grid's top, is
always loaded and nothing is built of it (`browser/geometry/hlod/worldBundles.ts`).

Files: `world-roots.table` and `world-roots.dag` (fixed-size records) and `world-roots.bin` (the
bundles, `rust/hlod/chain.rs`). Each actor's clusters go to streaming pages as a primitive's do
([Cluster DAG](clustersjson.md#cluster-dag)), one root page at least. Each HLOD cell holds its actor's
root pages (pinned in the page cache) while the actor is loaded, each world page naming its streaming
page (`browser/geometry/hlod/worldRootPages.ts`, `PageRec.streamUrl`).

- A blended primitive is a source as any; the flattened material is opaque.
- An `approximate` layer's pages store the shell's tangents (`FLAG_TANGENT`); a `merge` layer's store
  none (frame rebuilt per triangle).
- A `voxel` layer's actor (`rust/hlod/chain/voxels.rs`) is the cell's original objects voxelized
  together: each cluster is a voxel page ([Voxels](pages.md#voxels)), its page facts' flags
  `GEOMETRY_VOXEL`, its triangles its bricks' boxes'. Levels double from the pixel where the cell is
  first seen; it wears the material of its first opaque object.
- Table layout (little-endian, version 34): a 64-byte header (magic, version, bundle, page and HLOD cell
  counts, pool length, the binary's length as two words, its 32-byte digest), 56-byte bundles, 24-byte
  pages, 124-byte HLOD cells (HLOD 0 first), then a `u32` pool. An HLOD cell holds:
  - its actor's root pages, in the pool;
  - the cell its actor lies in (`u32::MAX`: actor always loaded, or nothing built);
  - a level word: level in the low 8 bits; 1 in the next bit when its actor asks a warm-up before it
    is drawn (every builder's but `instanced`'s); the level of its cell on its grid in the next 7; its
    grid's rank in the partition's root in the high 16;
  - its actor's HLOD level (what the HLOD view paints its pages and rows with);
  - its actor's rows: the bundle holding them (`u32::MAX` for none) and their count. The bundle is one
    of the bundles it holds, of no page, 136 bytes a row: its mesh's published rank and the animation
    banks item it plays (`u32::MAX` for none), as `u32`s, then its world matrix as sixteen `f64`;
  - the six `f64` bounds it streams by, and the six `f64` of its content (the union of its actors').
- Table versions:
  - 15: a cell in no layer follows its range (`CHAIN_ACTOR`). 16: a cluster may hold a voxel
    page. 17: its head is six words, its bricks five, its voxels twelve bytes
    ([Voxels](pages.md#voxels)).
  - 18: a cell's bundle is its actor's root page, its coarsest groups beside its roots. 20: a cell
    record names its grid, its actor's warm-up and its content's bounds.
  - 22: an object under a skin's joint no clip moves enters its layer; an object a clip moves enters
    none; an instanced skinned object enters no actor above HLOD 0.
  - 23: level word: cell level on its grid in bits 9 to 15, warm-up in bit 8.
  - 24: each actor's clusters go to pages of their own: groups from the coarsest along a Morton curve,
    root pages of 32 KiB and 64 clusters, the others of 128 KiB and 256.
  - 25: any layer stands at HLOD 0: a non-instanced layer builds one HLOD 0 actor per main cell. An
    instanced layer may build actors above HLOD 0; an object standing as itself (`hlodInstance`) is its
    source primitive's DAG placed by its matrix, never merged.
  - 30: each cell names its actor's HLOD level and rows (every object standing as itself: an instanced
    layer's every one, any other's those marked `hlodInstance`), each its source mesh placed by its
    world matrix on that mesh's own pages (`rust/hlod/chain/builds/instanced.rs`,
    `browser/geometry/hlod/hlodRows.ts`).
  - 31: a row also names its animation banks item; an instanced skinned object marked `hlodInstance`
    stands in the actors above HLOD 0, its matrix its skin frame's world.
  - 32: an actor's rows are one bundle of no page after the pages' bundles
    (`rust/hlod/chain/builds/instanced.rs`, `lay_rows`); the table names it and the count. A world
    whose built actors are all rows publishes a DAG of no cluster, one empty node.
  - 33: pages are `WGP3` format 9 ([Pages](pages.md#pages)); page facts five words, cluster record
    180 bytes. 34: row 136 bytes.
  - 35 (`WORLD_ROOTS_VERSION`): pages are `WGP3` format 11; page facts gain its bytes in the pool and
    its offset there: seven words, cluster record 188 bytes.
  - 36: pages are `WGP3` format 12 (up to eight texture sets).
  - 37: an `instanced` layer asking for no cluster DAG (`disallowClusterDag`) keeps its objects as rows,
    each naming the FALLBACK MESH of its source mesh (`rust/compiler/source/fallback.rs`): a mesh of the
    published scene whose `extras.hlodFallbackOf` is its source's published rank, one primitive per
    source primitive wearing its material, its clusters the source's last LOD as exact root clusters,
    drawn whole at every distance. The partition's root lists it with no node and no row (a total of
    zero); the core's `meshPages` name its pages. Layout is 36's.
- DAG layout (versions 36 and 37): a 24-byte header (magic, version, cluster count, group count, pool
  length, node count), 188-byte clusters, 64-byte groups, 128-byte culling nodes, then a `u32` pool.
  - A cluster holds: level, triangles, its actor's rank (`hlodMaterials`), bundle, offset, HLOD cell
    (its level plus one is its HLOD layer); two zeros; `f64` error, parent error (NaN for a root),
    sphere, parent sphere, minimum and maximum; its page's facts: length on disk, vertex count, index
    count, attribute flags, decoded bytes, bytes resident in the pool and offset in its place there.
  - Clusters lie in streaming-page fill order; that rank names a cluster. Each node
    (`CULLING_STRIDE` (16) `f64`, a primitive's node layout,
    [Cluster DAG](clustersjson.md#cluster-dag)) is a leaf naming its group part's run of ranks.
  - Each actor's clusters are a subtree of their own (`page-codec-wasm/src/culling.rs`), under a tree
    over one item per actor, each leaf an actor's root (`rust/hlod/chain/merge.rs`): the tree's nodes
    first, the actors' roots among them, then each actor's other nodes, children after their node.
- Versions 2 to 14, 21, 26 to 29 are superseded record layouts. 31 also: a merged layer's atlas holds
  the maps its layer names (opacity or mask, occlusion, anisotropy, specular, emission), and its mesh
  keeps its sources' vertex colours where it asks.
- Versions: `WORLD_ROOTS_VERSION` (`rust/hlod/chain.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/hlod/chain/bundles.rs:pack_world`, `rust/hlod/chain/records.rs:encode_table`,
  `rust/hlod/chain/dag_records.rs:encode_dag`.
- Reads `core/manifest/worldRootsTable.ts:readWorldRoots`,
  `core/manifest/worldRootsTable.ts:readWorldRootsDag`, `core/manifest/worldRoots.ts:bundlePageRanges`.

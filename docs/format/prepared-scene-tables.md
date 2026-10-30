# Prepared scene tables

`scene-tables.json`: nodes, cameras, skins, clips, materials, textures and geometry layout;
the runtime builds its scene from them, parsing no glTF. One `document` holds the published scene;
there is no second scene. Lamps are not here: [`lights.json`](lightsjson.md#lightsjson) is the one reading of a
light, and no node names one.

- `hlodMaterials`: per HLOD actor the chain builds, by the rank its world clusters name, the
  `materials` rank of the material it wears.
- A material's `displacement` ([Displacement](../compiler/displacement.md#displacement)): only a displaced
  material has the field, `{ "map": slot, "magnitude", "center", "fade": { "start", "end" } | null,
"uvDensities": [d0, d1, d2, d3] }`, `map` a texture slot as the other maps' (`texture`,
  `texCoord`, `slotTexCoord`, `transform`), `uvDensities` the measured density of each of the first
  four coordinate sets (0 for a set no triangle measured; the field is absent when none was). The
  table's version is unchanged: a reader that does not know a field reads the material flat, as
  before, and a displaced material with no `uvDensities` reads a density of 1 for every set.
- A material's `responsive` ([Temporal anti-aliasing](../compiler/temporal-anti-aliasing.md#temporal-anti-aliasing)): only a
  material above `off` has the field, `"medium"` or `"full"`, the compiler's one resolution of the
  job's `materials`, its `responsive` match and the material's `extras`.
- A material's `sky` ([A sky material](../compiler/a-sky-material.md#a-sky-material)): only a sky material has the field,
  `true`, the compiler's one resolution of the job's `materials` and the material's `extras`. The
  table's version is unchanged: a reader that does not know it reads a plain material.
- Versions: `SCENE_TABLES_VERSION` 9, `NODE_TABLE_VERSION` 7, `MATERIAL_TABLE_VERSION` 6,
  `GEOMETRY_TABLE_VERSION` (`rust/compiler/tables.rs`, `core/scene/core/tableContracts.ts`).
  Material table 6 names the level in `responsive`; versions 4 and 5 wrote `responsive: true` and a
  `temporalAntialiasing` number there.
  Tables 8 / node table 6 dropped `lights` and each node's `light`: they copied the glTF fields raw
  and failed the compile on a non-punctual type, where `lights.json` counts it in `rejected`.
  Node table 7: an animated node that streams carries `"streamed": true` — its mesh is drawn only
  by a row of the cell that holds it ([World partition](#world-partition)), its own host mesh that
  row's animation source —, and an instanced skinned node loaded with the scene carries
  `"bank": <item>` — the item of [`animation-banks.bin`](animation-banksbin.md#animation-banksbin) its mesh plays —,
  hung under its skin's frame at no pose (glTF ignores a skinned node's own transform).
  A static object the core keeps as the frame of the nodes under it, its mesh drawn by a row of its
  cell, carries `"meshStreams": true`: its collider is made and let go of with that cell. A node
  that is no such frame carries no byte of it, so the version is as it was; a runtime that does not
  read it streams that collider by distance alone.
- Writes `rust/compiler/tables.rs:stage_scene_tables`; reads
  `core/scene/core/tableContracts.ts:assertSceneTables`, `browser/scene/host/prepared/build.ts:buildPreparedScene`.

## World partition

Nodes that place a mesh move into spatial cells (`scene-cell-<n>.json`) under paged slots
(`scene-page-<sha256>.json`) and the fixed-size root `partition`. The cells are those of the grids
of the job's scheme (`partitionScheme`, `rust/compiler/tables/partition/grid.rs`,
[COMPILER.md](../compiler/the-partitions-grids.md#the-partitions-grids)): the loose hierarchical grids of `hashSet` by
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
  pose, playing that item of [`animation-banks.bin`](animation-banksbin.md#animation-banksbin) —, or
  `{parent, mesh, "source": true}` — an animated object of the core (skinned, morphed, moved by a
  clip, or a joint), drawn by a row under its own node at no pose, its host mesh the row's
  animation source. Every object streams on its main grid unless its `objectSettings` say
  `spatiallyLoaded: false`. An object [`physics.json`](physicsjson-cooked-colliders.md#physicsjson--cooked-colliders) moves or
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
  [COMPILER.md](../compiler/the-partitions-grids.md#object-settings)) carries `"drawDistance": {"min", "max", "perInstance"}`,
  in the scene's units (`perInstance` a boolean: the object is one instance of an instanced mesh,
  tested at its bounds' centre; a `min` or `max` of 0 names none of its end), here and in the node
  table of [`scene-tables.json`](#prepared-scene-tables); one naming none carries no byte of it, so
  the versions are as they were.
  A node that is an instance of an assembly (`allowAssemblies`,
  [COMPILER.md](../compiler/assemblies.md#assemblies)) carries `"rootParents"`, here and in the node table of
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

## World HLOD

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
streaming pages as a primitive's are, as a resource of its own ([Cluster DAG](clustersjson.md#cluster-dag)), one
root page at least; each HLOD cell holds its actor's root pages while its actor is loaded, pinned
in the page cache, every cluster of them in the cover, each world page naming its streaming page
(`browser/geometry/hlod/worldRootPages.ts`, `PageRec.streamUrl`).

- A blended primitive is a source as any; the flattened material is opaque: the shell stands in
  far away, where sorting its layers would cost more than the blend shows.
- An `approximate` layer's pages store the shell's tangents (`FLAG_TANGENT`), the frame its normal
  map is baked in; a `merge` layer's pages store none, their normal map baked in the frame the
  engine rebuilds from each triangle.
- A `voxel` layer's actor (`rust/hlod/chain/voxels.rs`) is the cell's original objects voxelized
  together, at every level: each of its clusters is a voxel page ([Voxels](pages.md#voxels)), its page
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
  its voxels twelve bytes ([Voxels](pages.md#voxels)). Version 18: the bundle a cell holds is its actor's
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
  the pages are then the `WGP3` format 9 ([Pages](pages.md#pages); format 11 from version 35), each actor's grid its own, and a cluster's
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
  a primitive's node layout ([Cluster DAG](clustersjson.md#cluster-dag)) — a leaf naming its group part's run of
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

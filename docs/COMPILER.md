# The native compiler — `trillion3d-compiler`

One executable prepares a model for the engine. It reads a source through one driver per format —
glTF/GLB, FBX, OBJ, USD/USDZ, Alembic, `.blend`, Maya ASCII, Unity scenes and packages, ZIP and a
dozen image formats ([Input formats](#input-formats)) — builds the cluster hierarchy, cooks the
textures, colliders and lights, and writes the cache [FORMAT.md](FORMAT.md) describes. A host only
launches it, passes paths and options and listens; no external application is needed.

This page is the user guide. For the internals it is a map: the code is the contract
([Internals](#internals)).

## Installing it

`npm install trillion3d` brings the Node adapter and its machine's compiler. In a checkout,
`pnpm run build:native` builds it into `packages/asset-compiler-rust/target/release/`; the physics
cook links native Jolt from the pinned submodule, so the build needs CMake, a C++17 compiler and
`git submodule update --init`.

### Platform packages

The compiler is built for macOS arm64 and x64, Linux arm64 and x64 (glibc) and Windows x64, each
shipped as its own package, `@trillion3d/compiler-<os>-<arch>` (`packages/compiler/`), declared in
the `optionalDependencies` of `trillion3d`: an install takes only its machine's one. The `Compiler`
workflow builds the five (`scripts/native/compiler-dist.ts`) and checks that they write the same cache
bytes. A Linux on musl, or an install without optional dependencies, has no package
([Using it from Node](#using-it-from-node) says how the executable is found).

## Invocation

```
trillion3d-compiler source cache slice|full triangleBudget resourceBaseUrl
trillion3d-compiler source cache slice|full triangleBudget threads ramBudgetMb resourceBaseUrl
trillion3d-compiler source cache slice|full triangleBudget threads ramBudgetMb resourceBaseUrl simplification
trillion3d-compiler --jobs FILE|-
trillion3d-compiler --version
trillion3d-compiler --build-inputs
```

Exactly 5, 7 or 8 positional arguments, plus `--textures-format=`, `--hlod=`,
`--temporal-antialiasing=`, `--responsive=`, `--materials=`, `--voxelize=`, `--partition-scheme=`,
`--partition-grid=`, `--partition-grids=`, `--mesh-build=`, `--object-settings=` and `--lightmap-bake=` anywhere, the last of each kept
(`compiler/args.rs`); a JSON flag that is not JSON is refused (`INVALID_OPTIONS`):
the fields of one job, named as a batch job names them and in the order `JOB_FIELDS` declares
(`packages/sdk-core/src/contracts/compilerAbi.ts`, printed into the compiler's `shared_math/abi.rs`; the mesh-build and object
contracts, `meshBuildAbi.ts` and `objectAbi.ts`, into `shared_math/abi/meshes.rs`).
Both forms are read by one reader. Another count prints the usage, emits `INVALID_ARGS` and exits 2;
a value out of range is refused with `INVALID_OPTIONS`, naming the field (`compiler/validate.rs`).
`--version` prints the compiler and format versions, the drivers and the platform as JSON. `--build-inputs` prints the files its build hashed
into the implementation hash, one path per line from the crate (`build_inputs.rs`): the production
sources of the compiler and of the crates it links, their manifests, the lock file, the build
scripts and the cargo configuration.

| Argument                   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Default                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                   | A folder with `manifest.json`, a `.gltf`/`.glb`, a scene or container of [Input formats](#input-formats), or a folder of such files merged into one scene                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | required                                                                                                                                                                                                                                                                                                                    |
| `cache`                    | Output folder, created if missing; one pointer per scope, pruned after each compile, so one source per cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | required                                                                                                                                                                                                                                                                                                                    |
| `scope`                    | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | required                                                                                                                                                                                                                                                                                                                    |
| `triangleBudget`           | Positive triangle budget of `slice`; ignored by `full`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | required                                                                                                                                                                                                                                                                                                                    |
| `threads`                  | Worker threads of the job, 1–64                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | auto (every core; cores / workers in a batch)                                                                                                                                                                                                                                                                               |
| `ramBudgetMb`              | Admission budget, at least 64: a job estimated above it is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`); a guard, not a process limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `4096`                                                                                                                                                                                                                                                                                                                      |
| `resourceBaseUrl`          | URL prefix under which the host serves the source folder; relative image URIs are rewritten against it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | required                                                                                                                                                                                                                                                                                                                    |
| `simplification`           | `qem-endpoints`: coarser levels above the exact clusters; `none`: exact clusters alone, each a root, every triangle drawn at any distance; the HLOD builds either way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `qem-endpoints`                                                                                                                                                                                                                                                                                                             |
| `--textures-format=`       | `all`, `bc7`, `astc` or `etc2`: the GPU block families cooked beside the stored BC levels, kept only where they pass the quality gate ([FORMAT.md](FORMAT.md#textures))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `bc7`                                                                                                                                                                                                                                                                                                                       |
| `--hlod=`                  | The HLOD layers and the rules assigning objects to them, as JSON in the expert form ([HLOD](#hlod))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                                                                                                                                                                                                        |
| `--temporal-antialiasing=` | The scene's temporal anti-aliasing level, `off`, `low`, `medium`, `high` or `max`, or `true` / `false`, written in its manifest ([Temporal anti-aliasing](#temporal-anti-aliasing))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                                                                                                                                                                                                        |
| `--responsive=`            | The objects whose materials are responsive in the temporal anti-aliasing (level `full`: their pixels' history restarts every image), as JSON: a node's exact name, `{ "regex", "flags" }` on it, or a match ([Temporal anti-aliasing](#temporal-anti-aliasing))                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                        |
| `--materials=`             | Settings by exact material name, as JSON, `{ "name": { "responsive": "medium" } }` ([Temporal anti-aliasing](#temporal-anti-aliasing))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                                                        |
| `--voxelize=`              | The objects whose meshes are voxelized far away, as JSON: a node's exact name, `{ "regex", "flags" }` on it, or a match ([Voxels far away](#voxels-far-away))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                        |
| `--partition-scheme=`      | How the objects are cut into cells and streamed, `hashSet` or `spatialHash`, or `true` the default ([The partition's grids](#the-partitions-grids))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none: `hashSet`                                                                                                                                                                                                                                                                                                             |
| `--partition-grid=`        | The partition's main grid, as JSON: `{ "cellSize", "loadingRange", "priority", "origin" }` and its scheme's own settings, `true` every default, `false` the streaming off ([The partition's grids](#the-partitions-grids))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | none: 128 m cells loaded within 256 m, priority 0, centred on the origin                                                                                                                                                                                                                                                    |
| `--partition-grids=`       | Several main grids instead, as a JSON list of `partitionGrid`'s settings each under a `name`, the first the default grid, never beside `--partition-grid=` ([Several streaming grids](#several-streaming-grids-partitiongrids))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none: one grid                                                                                                                                                                                                                                                                                                              |
| `--mesh-build=`            | How each mesh is built, as JSON: `{ "storedTangents", "keptTriangles", "trimmedError", "dropNearCollapsed", "alwaysResidentKib", "recomputeNormals", "recomputeTangents", "useMikkTSpace", "computeWeightedNormals", "skinnedWeldPosition", "skinnedWeldNormal", "skinnedWeldTexture", "positionPrecision", "normalPrecision", "tangentPrecision", "voxelRays", "voxelLevel", "voxelBackUp", "voxelSeparable", "voxelNdf", "voxelOpacity", "allowAssemblies", "distanceField", "distanceFieldScale", "distanceFieldTwoSided", "distanceFieldDensity", "distanceFieldMaxResolution", "maxMeshCards", "meshCardMinDensity", "meshCardNormalThreshold", "objects" }` ([Mesh build settings](#mesh-build-settings)) | none: no stored tangent, every triangle kept, no near-collapsed triangle dropped, one root page resident, every normal rebuilt, tangents by MikkTSpace, a skinned weld within 200 nm, 2·10⁻⁵ and 1/1024, positions on a grid following the mesh's density, normals of 8 bits an axis, tangents of 7 bits, voxels of 64 rays |
| `--lightmap-bake=`         | Whether the scene gets a volumetric lightmap, and how it is baked, as JSON: `true` every default, `false` none, or `{ "detailCellSize", "qualityMultiplier", "giSamples", "maxRefinementLevels", "irradianceCaching", "irradianceCacheQuality", "irradianceCacheSpacing", "irradianceCacheCornerRejection", "automaticVolumeExpand", "automaticVolumeLimit", "maximumBrickMemory", "sphericalHarmonicSmoothing", "loadingCellSize", "minBrickError", "skyLight", "volumes" }` ([Volumetric lightmap](#volumetric-lightmap))                                                                                                                                                                                                                                                                             | none: no bake                                                                                                                                                                                                                                                                                                               |
| `--object-settings=`       | Each object's settings, as JSON: `{ "spatiallyLoaded", "skinnedInstance", "drawDistance", "runtimeGrid", "farField", "objects" }` ([Object settings](#object-settings))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | none: every object streams, no skinned instance                                                                                                                                                                                                                                                                             |

```sh
trillion3d-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
```

A busy cache is waited for, then refused (`CACHE_LOCKED`); `TRILLION3D_CACHE_LOCK_WAIT_MS`, the one
environment variable read, shortens the wait (milliseconds; `0` refuses at once). A cache never
needs wiping: after each job the compiler removes what no surviving manifest references.

## Batch mode

`--jobs FILE` (or `--jobs -`, read from stdin, which disables cancellation) runs many jobs in one
process, each with its own cache:

```json
{
  "workers": 2,
  "ramBudgetMb": 16384,
  "jobs": [
    {
      "id": "city",
      "source": "scenes/city/city.obj",
      "cache": "cache/city",
      "resourceBaseUrl": "/assets/city/"
    },
    {
      "id": "london",
      "source": "scenes/london",
      "cache": "cache/london",
      "resourceBaseUrl": "/assets/london/",
      "threads": 8
    }
  ]
}
```

| Field                                                                        | Meaning                                                                    | Default                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `workers`                                                                    | Concurrent jobs, at most 64, lowered until the budget holds them           | `1`                                                           |
| `ramBudgetMb`                                                                | Budget of the whole batch, split between workers unless a job sets its own | `4096 × workers`                                              |
| `threads`                                                                    | Default threads per job                                                    | auto (cores / workers)                                        |
| `jobs[].id`                                                                  | Unique job id in events and the summary                                    | `job-<index>`                                                 |
| `jobs[].source`, `cache`, `resourceBaseUrl`                                  | As on the command line                                                     | required                                                      |
| `jobs[].scope`, `triangleBudget`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides                                                          | `full`, `150000`, batch default, batch share, `qem-endpoints` |
| `jobs[].texturesFormat`                                                      | As `--textures-format=`                                                    | `bc7`                                                         |
| `jobs[].hlod`                                                                | As `--hlod=`, a JSON object                                                | none                                                          |
| `jobs[].temporalAntialiasing`                                                | As `--temporal-antialiasing=`, a level or a boolean                        | none                                                          |
| `jobs[].responsive`                                                          | As `--responsive=`, a string or a JSON object                              | none                                                          |
| `jobs[].materials`                                                           | As `--materials=`, a JSON object                                           | none                                                          |
| `jobs[].voxelize`                                                            | As `--voxelize=`, a string or a JSON object                                | none                                                          |
| `jobs[].partitionScheme`                                                     | As `--partition-scheme=`, a scheme's name or `true`                        | none                                                          |
| `jobs[].partitionGrid`                                                       | As `--partition-grid=`, a boolean or a JSON object                         | none                                                          |
| `jobs[].partitionGrids`                                                      | As `--partition-grids=`, a JSON list                                       | none                                                          |
| `jobs[].meshBuild`                                                           | As `--mesh-build=`, a JSON object                                          | none                                                          |
| `jobs[].objectSettings`                                                      | As `--object-settings=`, a JSON object                                     | none                                                          |
| `jobs[].lightmapBake`                                                        | As `--lightmap-bake=`, `true`, `false` or a JSON object                    | none                                                          |

Jobs go in file order to the first free worker. Two jobs writing one cache, under any spelling, or
a job asking for more than the whole budget, refuse the batch before it starts (`INVALID_BATCH`).
stdout then carries the summary, `{"status": "ready" | "partial" | "failed", "completed", "failed",
"cancelled", "jobs"}`, each job a pointer or an error, sorted by id; read it rather than the exit
code.

## The partition's grids

Every object — a visible node that places a mesh, no camera — is spatially loaded unless its
settings say otherwise ([Object settings](#object-settings)): it is drawn while the view lies
within its main grid's loading range of its cell ([ENGINE.md](ENGINE.md#a-partitioned-scene)). A
static leaf leaves the table the runtime reads first and is written in its cell, under its nearest
core node, even one an animation moves: its row follows it. A static object with nodes under it
stays in the core for them, without its mesh, and its cell draws that mesh under it; its mesh
enters its layer's HLOD as a leaf's does. An animated object — skinned, morphed, moved by a clip
itself, or a skin's joint — stays in the core, where its clips, its skin and the page's own code
name it, and its cell draws it: a row of its mesh at its node, its node's host mesh that row's
animation source. An instanced skinned object is written in its cell at its skin's frame — the
node its top joints hang under —, playing its track of the scene's
[animation banks](#animation-banks). An object an animation moves, itself or through a parent,
takes no HLOD layer: past its cell's range nothing stands for it. An object's bounds are its
mesh's, an instanced skinned object's sampled bounds, a plain skinned object's bounds over every
clip moving its skin, a morphed object's mesh grown by its targets' extents.

Objects attached under one another stream together: the topmost object above a node and every
object under it make one batch, placed in one cell by the box around their bounds. A batch one
object of which is not spatially loaded is loaded whole with the scene. A node that draws no mesh
is a frame, not an object: it joins no batch, so a scene root over everything never makes the
whole scene one cell.

The job picks the scheme the objects are cut into cells by (`partitionScheme`,
`--partition-scheme=`, `jobs[].partitionScheme`):

- `hashSet`, the default, the reference's: a loose hierarchical grid with no top, on the main
  grid's origin, flat on the ground unless the job says otherwise (`flat`). A batch goes to the
  level whose cell is as wide as its widest side — on the ground for a flat grid —, one finer
  while it overruns that finer cell by less than a quarter of the finest cell, counted in whole
  centimetres, and to the cell under its centre there. A cell loads while the view comes within its
  grid's range of the bounds it streams by: on the finest level those the job names
  (`streamBounds`: its content's box clipped to its cell's box by default, its content's box alone, or
  its cell's box), on a coarser one its content's box. HLOD level `i` streams on a loose grid of the cell
  side and loading range the job names it (`hlodGrids`), each else `2 << i` times the main grid's,
  on its origin and flat as it is, its cells loaded at priority 0; a cell on its finest level
  streams by its content clipped to its cell. A layer's own `cellSize` and `loadingRange` set
  nothing under this scheme, as the reference deprecates them.
- `spatialHash`, the older one: a square over the world, centred on its origin, as many cells of
  its `cellSize` a side as twice the farthest the objects' bounds lie from the origin on the
  ground, rounded up to a power of two; each level doubles the cell and halves the cells per side,
  up to one cell over the whole square, and each level below the top holds one cell more per side,
  centred too, its edges between those of the levels around it, unless the job nests the levels
  (`nestedLevels`). A batch whose ground box is no larger than a finest cell goes to the finest
  cell under its centre (`smallByCentre`); any other to the first level, from the one whose cell
  is as wide as its widest side on the ground, where its bounds on the ground meet one cell alone;
  the top level's one cell is the always loaded one: a batch it alone holds stays in the core, and
  no HLOD is built of it. A cell loads by its square; with `pullCoarser`, a wished cell pulls in
  every cell of the levels above it, below the top, that its square overlaps, and those in turn.
  Each HLOD layer streams on the grid its `cellSize` and `loadingRange` name ([HLOD](#hlod)),
  centred on the world's origin under the main grid's settings of the scheme, its cells loaded at
  priority 100 plus its level — after the main grid's.

`true` names the default; `false` is refused: `partitionGrid: false` is what turns the streaming
off. A flat grid — a square one always — is 2D: glTF's up axis (`+Y`) never places an object, and
keeps a cell out of range only when the session culls square cells by height
(`worldStreamingZCulling`, [ENGINE.md](ENGINE.md)).

The job sets the main grid (`partitionGrid`, `--partition-grid=`, `jobs[].partitionGrid`), each
setting the reference's main grid's when left out; `true` names every default, and `false` turns
the streaming off: every object is loaded with the scene, no cell is cut and no HLOD is built.
Several main grids are `partitionGrids`, [below](#several-streaming-grids-partitiongrids).

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  partitionScheme: 'hashSet',
  partitionGrid: { cellSize: 64, loadingRange: 192 },
})
```

`trillion3d-compile --partition-scheme=spatialHash '--partition-grid={"cellSize":64,"loadingRange":192}' …`,
or `'--partition-grid=false'` for a scene loaded whole.

| Field                  | Meaning                                                                                                                                                                                                                                                            | Default     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `cellSize`             | The side of the finest cell, metres, above 0                                                                                                                                                                                                                       | `128`       |
| `loadingRange`         | The distance from the view, metres, above 0, within which a cell loads                                                                                                                                                                                             | `256`       |
| `priority`             | The grid's load priority among the grids, a whole number from 0 to 4294967295, the lower the sooner                                                                                                                                                                | `0`         |
| `origin`               | The grid's origin, `[x, z]` on the ground, or under `hashSet` `[x, y, z]`, metres                                                                                                                                                                                  | `[0, 0]`    |
| `blockOnSlowStreaming` | Once the first image is shown, a cell of the grid wished and not yet shown near the view holds the images back till it shows, while the session's `worldStreamingBlockOnSlowStreaming` is on ([ENGINE.md](ENGINE.md#a-partitioned-scene)); the HLOD grids never do | `false`     |
| `streamBounds`         | `hashSet` alone: what a finest cell streams by, `"content"`, `"cell"` or `"clipped"` (the content's box clipped to the cell's)                                                                                                                                                                               | `"clipped"` |
| `flat`                 | `hashSet` alone: the grids lie flat on the ground; `false`, they cut height too and test in 3D                                                                                                                                                                     | `true`      |
| `hlodGrids`            | `hashSet` alone: per HLOD level from 0, `{ "cellSize", "loadingRange" }` or `null`, each left out `2 << level` times the main grid's                                                                                                                               | none        |
| `nestedLevels`         | `spatialHash` alone: each level's cells nest in the next one's                                                                                                                                                                                                     | `false`     |
| `pullCoarser`          | `spatialHash` alone: a wished cell pulls in the coarser cells overlapping it, levels not nested                                                                                                                                                                    | `false`     |
| `smallByCentre`        | `spatialHash` alone: a batch no larger than a finest cell on the ground goes to the one under its centre                                                                                                                                                           | `true`      |

The defaults are those of a world the reference creates. A loose grid placed off the ground and
its HLOD grids sized apart:

```ts
partitionGrid: { flat: false, origin: [0, -50, 0], streamBounds: 'clipped', hlodGrids: [{ cellSize: 512 }, null, { loadingRange: 4096 }] }
```

and a square grid whose levels nest, big objects placed by their bounds alone:

```ts
partitionScheme: 'spatialHash',
partitionGrid: { nestedLevels: true, smallByCentre: false },
```

Each main cell's objects of one layer make that layer's HLOD 0 actor, which lies in the cell of
its layer's grid the scheme gives it; under `spatialHash`, an instanced layer's actor no cell
below its grid's top holds keeps its objects in the core, any other layer's is then always
loaded. The partition's root names its scheme, whether its grids lie flat, every grid — its cell
side, loading range, priority, HLOD level, whether a load blocks on its slow streaming and whether
cell files stream on it: the main grids, and each grid an HLOD 0 cell lies on — and
what each square grid that pulls coarser cells
finds them by; each cell file names the bounds it streams by and its HLOD 0 cell with the level of
its cell on its grid, and the main grid it lies on when that is not the first
([FORMAT.md](FORMAT.md#world-partition)). A job naming a scheme, a grid or grids
moves the cache key; one naming none keeps it. A scheme that is none of the names, a grid value
that is none of the forms, a field the grid does not hold, a setting of the other scheme, a size or
range not above 0, a priority out of its range, a `streamBounds` none of its names, an HLOD level's
grid that is neither an object of its two sizes nor `null`, or an origin that is not two finite
numbers — or three under `hashSet` — refuses the job (`INVALID_OPTIONS`).

### Several streaming grids (`partitionGrids`)

A scene streams on one grid by default (`partitionGrid`). A job that wants objects on grids of
different cell sides, loading ranges or priorities — a fine grid for small props, a coarse one for
towers — names several: `partitionGrids` (`--partition-grids=`, `jobs[].partitionGrids`), a list
whose entries take the settings of `partitionGrid` under a `name`. The first grid is the default:
every object that names no grid, or names one the list does not hold, streams on it. A job names
`partitionGrid` or `partitionGrids`, not both.

An object picks its grid with the `runtimeGrid` setting of `objectSettings` (a rule by object, the
scene's setting, or the node's own glTF `extras`, like every object setting). An object attached
under another streams on the grid of the topmost object above it, as a batch is placed in one cell.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  partitionGrids: [
    { cellSize: 128, loadingRange: 256 }, // the default grid, named MainPartition
    { name: 'towers', cellSize: 1024, loadingRange: 4096, priority: 1 },
  ],
  objectSettings: { objects: [{ match: /^tower/, runtimeGrid: 'towers' }] },
})
```

`trillion3d-compile '--partition-grids=[{},{"name":"towers","cellSize":1024,"loadingRange":4096}]' '--object-settings={"objects":[{"match":{"regex":"^tower"},"runtimeGrid":"towers"}]}' …`

| Entry field                      | Meaning                                                                                                                                     | Default                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `name`                           | The grid's name: a text, not empty, holding neither `:` nor `.`, told from another's without regard to case; required but of the first grid | `"MainPartition"` (first grid) |
| every setting of `partitionGrid` | `cellSize`, `loadingRange`, `priority`, `origin`, `blockOnSlowStreaming`, and each scheme's own                                             | as `partitionGrid`             |

Each grid has its own cells, its own loading range and priority, whether it lies flat (`flat`: a
flat grid and a grid cut in space may live side by side) and — under `hashSet` — its own chain of
HLOD grids, each level the grid's `hlodGrids` or its cell and range times `2 << i`, built only for a
grid that owns an object. Under `spatialHash` the HLOD layers keep the grids their `cellSize` and
`loadingRange` name, shared by the objects of every main grid, and the three square settings
(`nestedLevels`, `pullCoarser`, `smallByCentre`) are the whole partition's: the first grid's, which
a later grid may name alike or not at all. A `partitionGrids` that is no list, is empty or comes beside `partitionGrid`, an entry
that is no object or holds a field no entry holds, a setting of the other scheme, a name that is
missing (past the first grid), not a text, held by two grids or holding `:` or `.`, a square setting
a later grid names unlike the first's, and a `runtimeGrid` that is no grid name (it holds `:` or
`.`) refuse the job (`INVALID_OPTIONS`); a `runtimeGrid` that names no grid of the job streams on
the first grid, and the compile tells it in its assignment warnings. A job naming no
`partitionGrids` compiles, and writes, as before.

### Object settings

`objectSettings` (`--object-settings=` JSON, `jobs[].objectSettings`, `resolveObjectSettings`)
sets each object's settings: the scene's, and under `objects` rules `{ match, …settings }` naming
objects as `voxelize` does. For each setting of an object the first that names it wins: the first
rule matching it, `objectSettings`' own setting, its node's glTF `extras` under the setting's name,
the default — the reference's.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/crowd/',
  objectSettings: {
    objects: [
      { match: '^Walker', skinnedInstance: { clip: 'Walk', mobility: 'static' } },
      { match: 'Lighthouse', spatiallyLoaded: false },
    ],
  },
})
```

`trillion3d-compile '--object-settings={"skinnedInstance":true}' …`; in the glTF,
`"extras": { "spatiallyLoaded": false }` or `"extras": { "skinnedInstance": { "playRate": 0.5 } }`
on a node.

| Setting           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Default        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `spatiallyLoaded` | `true`: the object streams on its main grid; `false`: it is loaded with the scene and always drawn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `true`         |
| `skinnedInstance` | A skinned object plays a clip baked into the [animation banks](#animation-banks) on the GPU: `true` every default, `false` none, or the settings below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `false`        |
| `drawDistance`    | The distances an object is drawn at, from the eye, in the scene's units: `false` none, or `{ min, max, perInstance }`. The cut does not draw the object while the sphere of its bounds lies wholly nearer than `min` or wholly farther than `max`. A `min` or a `max` of 0 names none of its end, and an object naming no distance at all is `false` too (one form for none). `perInstance: true` says the object is one instance of an instanced mesh (a node `EXT_mesh_gpu_instancing` expands into): its bounds' centre is tested instead of the sphere, it is drawn at every distance without a `max`, and a `min` alone is none. Each a finite number of at least 0 | `false`        |
| `runtimeGrid`     | The name of the streaming grid the object streams on ([Several streaming grids](#several-streaming-grids-partitiongrids)): a text holding neither `:` nor `.`; none, or a name no grid of the job holds, the first grid. An object attached under another streams on the grid of the topmost object above it                                                                                                                                                                                                                                                                                                                                                             | the first grid |
| `farField`        | Whether a view's primed depth draws the object (`hizPrime`, a small coarse draw its Hi-Z pyramid is built from before its cut): `true` or `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `false`        |

An instanced skinned object's settings:

| Setting                  | Meaning                                                                                                                                                                                                                         | Default                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `clip`                   | The animation it plays: its rank in the document, or its name                                                                                                                                                                   | the first animation moving a joint of its skin |
| `looping`                | Whether its track wraps at its end; `false`, it holds its last pose                                                                                                                                                             | `true`                                         |
| `playRate`               | The seconds of the clip one second plays                                                                                                                                                                                        | `1`                                            |
| `position`               | The second it starts from, held within the clip                                                                                                                                                                                 | `0`                                            |
| `boundsScale`            | The scale of its sampled bounds about their centre, above 0                                                                                                                                                                     | `1`                                            |
| `animationMinScreenSize` | The screen size — its bounds' diameter over the view's height — under which it is drawn in its rest pose; 0 the run-time setting `animationMinScreenSize` (0.1, [ENGINE.md](ENGINE.md#animation-banks)), a negative value never | `0`                                            |
| `mobility`               | `static` or `stationary`: its cell's HLOD 0 actor plays it on past the main range; `movable`: no HLOD stands for it                                                                                                             | `movable`                                      |

The run-time settings `cutDrawDistanceCulling`, `cutDistanceCullToSphereEdge`, `cutViewDistanceScale` and the
field-of-view scales ([ENGINE.md](ENGINE.md#webgpu-page-raster)) turn the cull of the instances off, measure it to the centre, and scale
the distances at run time; they change no byte of the compiled scene. The compiler writes the distances of each object that names one
into the scene's node table (`nodes[].drawDistance`, `{ min, max, perInstance }`) and, for an object that streams, into its cell's node
row; a scene naming none carries no byte of it.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/meadow/',
  objectSettings: {
    // Every object of the scene is drawn at every distance, unless a rule below says otherwise.
    drawDistance: false,
    objects: [
      // A tower is not drawn nearer than 5 m (its whole sphere), at any distance past it.
      { match: 'Tower', drawDistance: { min: 5 } },
      // Each blade of an instanced grass is drawn up to 80 m, by its centre.
      { match: /^Grass/, drawDistance: { max: 80, perInstance: true } },
      // A lamp post is drawn between 5 m and 400 m.
      { match: 'LampPost', drawDistance: { min: 5, max: 400 } },
    ],
  },
})
```

On the command line: `trillion3d-compile '--object-settings={"objects":[{"match":{"regex":"^Grass"},"drawDistance":{"max":80,"perInstance":true}}]}' …`;
in the glTF, on the node: `"extras": { "drawDistance": { "min": 5, "max": 400 } }`.

A job naming `objectSettings` moves the cache key; one naming none keeps it. A field it does not
hold, a value of another type, a clip naming no animation, a negative position, a bounds scale not
above 0, another mobility, a draw distance that is neither `false` nor an object of `min`, `max` and
`perInstance` (each distance a finite number of at least 0, `perInstance` true or false), or a
`runtimeGrid` that is no text without `:` or `.` refuses the job (`INVALID_OPTIONS`).

### Animation banks

The clips the instanced skinned objects play, baked once into `animation-banks.bin`
([FORMAT.md](FORMAT.md#animation-banksbin)): per skin and clip, at the rate the clip's own duration
fits (30 frames a second when it fits none of the usual rates), each joint's
translation and rotation in the skin's frame and its inverse bind matrix; identical bakes written
once. An item — a bake on a mesh, with its looping, start, play rate, rest screen size and bounds —
is one track: every object playing one item is in one pose. A skin whose joints scale in its frame
cannot be baked (a bank keeps no scale): its objects stay skinned objects their host's clips move,
and the compile names them in its warnings. An instanced skinned object must be a leaf with no
morph target. Its HLOD 0 actor is its own cell rows, playing its track while its cell is held to
the HLOD 0 range; no HLOD layer above HLOD 0 builds anything of it — the merge, the shell and the
voxels take no skinned object.

## HLOD

A job builds an HLOD only when it names one, and only over the objects it assigns a layer. The HLOD
is a list of layers, each with its builder, its settings and the layer its cells' actors are built
by (`parent`): an object names its layer, and follows its layer's chain of parents, one actor per layer and cell, each layer's actors streamed on its own grid
([The partition's grids](#the-partitions-grids)): its `cellSize` and `loadingRange`, 256 m and
512 m when it names none — the simple form doubles both level by level, with four levels HLOD 0
to 3 on 256, 512, 1 024 and 2 048 m cells loaded within 512 m to 4 096 m —, a chain's top, its last layer's actors,
streamed on its own grid like any layer's (`spatiallyLoaded` defaults to `true`: past its loading range nothing stands for them); set `spatiallyLoaded: false` on the last layer to keep them always loaded, so the view is never limited.
Two chains — trees and buildings — build distinct actors over the same ground. Every level's actor
is built from its cell's original objects — every object under the cell, its shape and its
texture —, never from the actors of the level below: the actors of every level are built side by
side, as many at once as the memory allows.

Any layer may take objects, and its actors are then their HLOD 0, one per main cell and layer:
an `instanced` layer's are the objects themselves, their cell rows loaded within that layer's
grid range; any other layer builds its HLOD 0 actor of them, first drawn past the main grid's
range, where their main cell goes. A layer's level is its deepest step up any chain from a layer
the scene's objects take; a layer no such chain reaches builds nothing and streams on no grid.
Any layer may build another's cells' actors — an `instanced` one makes each object its source
mesh placed —, save a parent that wears its sources' own materials (`instanced`, or `merge`
keeping its materials) above a layer whose actors wear materials of their own, which the job
refuses. A layer not spatially loaded lets the parent it names go: nothing is built of actors
always loaded.

An object is assigned once, before any work, to one layer at most: the mark its glTF node carries
— `"extras": { "hlod": "hlod0" }`, a layer's name, written where the code that makes the object
writes it —, else the first rule that matches it, else the `default` layer (the simple form's
`hlod0`). An object none names has no HLOD: it is
streamed and drawn in its cell as any other, and nothing stands for it beyond its cell's range; it
costs the HLOD nothing. Where a mark and a rule name different layers, the mark wins and the
compile report tells it (`worldRoots.assignmentWarnings`), as it tells each marked object no HLOD
takes — it moves, itself or through a node above it, stays in the core, or is turned away by its layer's size filter — and each object its
settings make an instanced skinned one that stays a plain skinned one, with why. A mark naming no
layer, a mark in a job naming no HLOD, and an HLOD assigning a layer to no placed object
that may take one refuse the job. An object
whose node carries `"extras": { "hlodInstance": true }` stands as itself in every actor its chain
builds: its layer's builder leaves it out, and the actor names it as a row — its source mesh and
its world matrix, in the rows bundle its HLOD cell holds with its actor's root pages
(`hlod/chain/builds/instanced.rs`), streamed with the actor —
that the runtime places on that mesh's own rows while the actor is loaded and draws while the
cell draws the actor, its own pages cut by its own error as any row of its mesh, never merged
with another object, no page copied per actor or level; a value other than a boolean fails the
job. An `instanced` layer's actor above HLOD 0 is all rows: every object of its cell standing as
itself, nothing built. An instanced skinned object marked so stands in the actors above too, as a
row at its skin frame's world naming the item of the animation banks it plays; unmarked, it has
its own cell rows alone, no actor above it. An `instanced` layer's `disallowClusterDag: true` takes
its objects out of their cluster DAG: each is drawn at the last LOD of its mesh — for a source whose
LODs are a cluster DAG, its fallback, as a `merge` layer's `lodSelection: 'lowest'` takes it. The
layer stays an `instanced` layer: the compiler makes the fallback of each source mesh once, a mesh of
exact clusters drawn whole, published beside the scene's meshes (its `extras.hlodFallbackOf` names
the source) and listed by the partition with no node, and the layer's actors above HLOD 0 are rows
of it at the objects' matrices — nothing is copied per object or per cell. A skinned, morphing or
simulated object, and one an assembly builds or takes as a part, has no fallback: its rows stand on
its own mesh. The fallback carries no stored tangents: its normal map is read in the frame the
engine rebuilds from each triangle.

An object whose node carries `"extras": { "hlodInclude": false }` enters no layer, whatever its
mark, a rule or the `default` names: it is streamed and drawn in its cell as any object with no
HLOD, nothing standing for it beyond. The default is `true`; a value other than a boolean fails
the job. Leaving one object out of the HLOD this way leaves its layer's other objects alone:

```json
{ "name": "Lamp_Prop", "mesh": 12, "extras": { "hlod": "hlod0", "hlodInclude": false } }
```

From Node, `prepare(..., { hlod })` takes either form; one function, `resolveHlod`
(`packages/sdk-core/src/contracts/hlodOptions.ts`), turns it into the expert form the compiler
reads (`--hlod=`, `jobs[].hlod`): a string is an exact name, a regular expression is written
`{ "regex": source, "flags": "i" }` — the form the Node command line's `--hlod=` takes in either
form's JSON, for instance
`trillion3d-compile '--hlod={"levels":3}' …`. It refuses, in the words written, a field either
form does not hold, `levels` that is not a whole number from 1 to 256, and the simple form's
fields beside `layers`.

The simple form, for most uses, `{ levels }` alone — four levels when it names none: HLOD 0 is the
objects themselves (`instanced`), every coarser level a `merge` layer with the settings of the
reference's default merged layer, the last streamed on its grid like the others (the expert form's `spatiallyLoaded: false` keeps it always loaded). An object no mark names enters `hlod0`;
a mark (`"extras": { "hlod": "hlod1" }`) names another layer, the expert form's rules assign
objects by name:

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/city/',
  hlod: { levels: 3 },
})
```

| Field     | Meaning                                                                                                                                                     | Default  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `levels`  | The chain's levels, HLOD 0 included, 1 to 256: the first `instanced`, every other `merge`; one level is the objects themselves, instanced, on the first grid | `4`      |
| `default` | `none`: an object no mark names has no HLOD, drawn in its cell alone; left out, it enters `hlod0`                                                           | left out |

The chain of `{ levels: 3 }` stands for these expert layers; each merged level takes the settings of the
reference's default merged layer — the LOD of each source its lowest, the materials in one atlas
sized by the distance its actor is first drawn, no double-sided material, the normal, roughness,
metallic, specular and emissive images baked — and every other setting its default:

```ts
const merged = {
  builder: 'merge', lodSelection: 'lowest', mergeMaterials: true, textureSizing: 'drawDistance',
  allowDoubleSided: false,
  maps: { normal: true, roughness: true, metallic: true, specular: true, emissive: true },
}
hlod: {
  layers: [
    { name: 'hlod0', builder: 'instanced', parent: 'hlod1', cellSize: 256, loadingRange: 512 },
    { name: 'hlod1', ...merged, parent: 'hlod2', cellSize: 512, loadingRange: 1024 },
    { name: 'hlod2', ...merged, cellSize: 1024, loadingRange: 2048 },
    // To keep the top always loaded: { name: 'hlod2', ...merged, spatiallyLoaded: false }
  ],
  default: 'hlod0',
}
```

One level is the objects themselves, instanced, streamed on the first grid: no merged layer.

```ts
// One level.
hlod: { levels: 1 }
// stands for
hlod: {
  layers: [{ name: 'hlod0', builder: 'instanced', cellSize: 256, loadingRange: 512 }],
  default: 'hlod0',
}
// Never limit the view: the top layer always loaded.
hlod: {
  layers: [{ name: 'hlod0', builder: 'instanced', spatiallyLoaded: false }],
  default: 'hlod0',
}
```

The expert form, every layer setting:

```ts
hlod: {
  layers: [
    { name: 'buildings', builder: 'instanced', parent: 'city1' },
    { name: 'city1', builder: 'approximate', parent: 'city2', deviation: 0.05, cellSize: 512, loadingRange: 1024 },
    { name: 'city2', builder: 'approximate', textureSize: 2048, spatiallyLoaded: false },
    { name: 'trees', builder: 'instanced', parent: 'canopy' },
    { name: 'canopy', builder: 'approximate', accuracy: 0.5 },
  ],
  assign: [{ match: { node: /^Tree/, extras: { kind: 'tree' } }, layer: 'trees' }],
  default: 'buildings',
}
```

| Field                                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layers[].name`                                            | Unique name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `layers[].builder`                                         | `instanced` (the objects themselves, each its source mesh at its own detail — at the last LOD of its mesh with `clusterDag: false`), `approximate` (one closed shell per cell, its materials baked), `merge` (the cell's objects merged into one mesh), `voxel` (the cell's objects voxelized together, its `meshBuild` the voxels' sampling alone: [Voxels far away](#voxels-far-away)), `simplify` (the cell's objects remeshed through their volume, simplified for the distance the actor is first drawn from, their materials transferred onto its atlas: [Simplified layers](#simplified-layers))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `layers[].parent`                                          | The layer its cells' actors are built by; none at a chain's top, whose actors, one per cell of the level below, are always loaded; an `instanced` layer, or a `merge` layer keeping its materials, builds nothing above a layer whose actors wear materials of their own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `layers[].spatiallyLoaded`                                 | Whether the layer's actors stream on a grid of its own; `false`, always loaded, nothing built of them — its `parent` let go —, so the layer names no `cellSize` nor `loadingRange`; an `instanced` layer's objects (its `clusterDag` left `true`) then stay loaded with the scene; default `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `layers[].cellSize`, `loadingRange`                        | Under the `spatialHash` scheme ([The partition's grids](#the-partitions-grids)): the side of the finest cell of the layer's grid and the distance within which a cell loads, metres, above 0; layers of one level, cell and range share one grid, its cells loaded after the main grid's (priority 100 plus the level); default 256 m and 512 m. The default `hashSet` scheme ignores them: HLOD level `i` streams on a grid of `2 << i` times the main grid's cell and range                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `layers[].accuracy`                                        | An `approximate` layer's voxel, metres, whatever the distance its actors are first seen from: its solid's grid holds the cell's diagonal over it, from 64 voxels to its `voxelClamp`; default 1 m                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `layers[].deviation`                                       | An `approximate` layer's deviation, metres, what its shell is simplified within; default 0.1 m                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `layers[].textureSize`                                     | The atlas side of an `approximate` layer, or of a `merge` layer merging its materials or a `simplify` layer sized `fixed` or `biased`, a power of two from 16 to 8192; default 1024                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `layers[].approximation`                                   | An `approximate` layer's other steps, each its default when left out: `voxelClamp` (most voxels across, 64–1290, 1024); `autoThicken` (true), `thicknessMultiplier` (voxels, 1.5); `ignoreTinyParts` (true), `tinyPartMultiplier` (0.05); `windingThreshold` (0.01–0.99, 0.5); `fillGaps` (true), `gapDistance` (metres, 0.1); `occlusion` (`visibility` or `none`), `occludeFromBelow` (true); `simplification` (`geometricTolerance` to `deviation`, `trianglesPerArea` to `trianglesPerSquareMetre` (0.01 up to the largest single-precision number, 2), `fixedTriangleCount` to `triangleCount` (16–2147483647, 2000)), `simplifyPrePass` (true); `hardNormals` (true), `hardNormalAngle` (degrees, 60); `uvMethod` (`charts`, `patches` or `uvAtlas`), `uvAtlasStretch` (the most stretch the `uvAtlas` charts may reach, from 0, none, to 1, any; 0.1), the patches' `initialPatches` (1–99999999, 250), `curvatureAlignment` (0.01–100, 1), `mergingThreshold` (1 or more, 1.5), `maxAngleDeviation` (degrees, 0–180, 45); the bake's views: `captureResolution` (pixels, 0–16384, 0 the atlas side, 2048), `captureFieldOfView` (degrees, 5–160, 30), `nearPlane` (metres, 0.00001–10, 0.01), `multiSampling` (0–8, 0), `captureAnisotropy` (most samples a texture read takes along its footprint, the views' sampler anisotropy clamp, 1–16, 8); `maps` beside the base colour: `normal` (true), `roughness` (false), `metallic` (false), `specular` (false), `emissive` (false) — a channel not baked is roughness 0.5, metallic 0; the roughness, metallic and specular share one packed image (G, B, R); the emission is its own map over its strength; `baseCapping` (`none`, `convexPolygon` — the convex hull of the vertices within `baseHeight` above the scene's lowest point, flat there and facing down, the scene then read as open meshes —, `convexSolid` — that hull extruded up by `baseThickness`; `true` is `none`, `false` `none`; default `none`), `baseHeight` (metres, 0 or more, 0 twice the `accuracy`), `baseThickness` (metres, 0 or more, 0 the thickening's thickness when `autoThicken`, else 1.25 voxels); `groundClipping` (`none`, `discard` — the triangles whose corners all lie on or under the plane dropped with the hidden ones, only where the occlusion filter drops some —, `cut` — the shell cut along the plane, what lies under removed —, `cutAndFill` — cut and each cut loop filled flat by a constrained Delaunay triangulation; `true` is `none`, `false` `none`; default `none`), `groundHeight` (the plane's height, the world's up coordinate, metres, 0); `useRenderLODMeshes` (each source mesh read as its vertex buffers hold it, split where its attributes are, rather than welded by position; false)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `layers[].lodSelection`, `lodScreenSize`                   | A `merge` layer's LOD of each source, its merged mesh never simplified: `calculate`, the LOD a source shows when its bounding sphere spans `lodScreenSize` of the view (above 0, 1 at most; default 0.25), or `lowest`, its fallback mesh; default `calculate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `layers[].collapseEquivalentMaterials`                     | Whether a `merge` layer collapses equivalent materials — one definition under two names — into the first its sources name; default `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `layers[].mergeMaterials`                                  | Whether a `merge` layer merges its sources' materials into one atlas, one cell per material and what it bakes on; default `false`, each section wearing its source's material                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `layers[].bakeVertexColors`                                | Whether a `merge` layer keeping its materials keeps its sources' vertex colours on its merged mesh, each section carrying the colours its sources carry, white where a source has none; default `false`, a source's tint not riding the merged mesh. Refused beside `mergeMaterials`: the atlas of a layer merging its materials already holds its sources' vertex colours                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `layers[].simplification`                                  | A `simplify` layer's own steps, each its default when left out, lengths in metres: `voxel` (at least 0.001; none derives it from the screen size), `gapWidth` (0), `unresolvedColor` (sRGB bytes, `[0, 0, 0]`), `transferDistance` (none: six voxels), `hardAngle` (degrees 0–180, `true` 130, `false`), `normalMethod` (`angleWeighted`, `areaWeighted`, `equalWeighted`), `gapSteps` (0–64, 7), `transferRays` (`nearest`, `facing`), `separateFoldedWalls` (false), `serialSimplify` (false): [Simplified layers](#simplified-layers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `layers[].textureSizing`                                   | How an `approximate` layer, a `merge` layer merging its materials, or a `simplify` layer, sizes its atlas: `fixed` (`textureSize`), `texelDensity` (the power of two whose texels a metre over its mesh come nearest `texelsPerMetre`, 0.1–1024, default 5 — an approximated shell's over its charts' share of the square), `screenSize` (those its bounding sphere spans filling `atlasScreenSize` of a 1920-texel view, 0.01–1, default 0.5), `drawDistance` (where its actor is first drawn); every layer also `biased` (the normal map at `textureSize`, the base colour at half, 32 at least — 8 for a `merge` layer, which puts its tangent map at half too —, its other maps at a quarter, 16 at least — 4 for a `merge` layer) and `manual` (each map at its `mapSizes` side, 16–8192 rounded up to a power of two, 1024 each: `base`, `normal`, `roughness`, `metallic`, `specular`, `emissive` for an `approximate` layer — the packed metal-roughness map at the largest of its three —, those and `opacity` and `opacityMask` for a `simplify` layer, and for a `merge` layer also `tangent`, `anisotropy`, `ambientOcclusion` — an image taking the largest side of the maps it packs that the layer bakes: the base colour with `opacity` or `opacityMask`, the metal-roughness map with its three, the anisotropy map with `tangent`), the atlas baked at the largest side and each map averaged down to its own; an `approximate` layer's `textureSize` still sizes its views and its packing, a `merge` or `simplify` layer's sizes only a `fixed` or `biased` atlas; default `fixed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `layers[].atlasGutter`, `binByTextureSize`                 | A `merge` layer's atlas cells: each cell's gutter, texels, up to 64, default 2; squares sized by their materials' largest textures rather than a grid, default `false`. A `simplify` layer's `atlasGutter` is the texels kept between two of its charts, default 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `layers[].bakeOnMesh`, `allowDoubleSided`, `maps`          | A `merge` layer's bake: a material whose look its mesh decides — coordinates leaving the unit square, a vertex colour, a baked map reading a second set — baked on that mesh rather than on a quad, default `true`; both faces drawn when one of its materials draws them, default `true`; `maps` beside the base colour: `normal` (true), `roughness`, `metallic`, `specular` (the packed metal-roughness map's red channel), `emissive` (a map of its own over its strength), `opacity` or `opacityMask` — at most one, the base image's alpha, the material drawn blended or masked at 0.3333 —, `ambientOcclusion` (glTF's occlusion map, red), `anisotropy` and `tangent` (one image, `KHR_materials_anisotropy`'s texture: the direction in red and green, the strength in blue; the runtime does not draw it yet), each false unless named. A `simplify` layer takes `allowDoubleSided` and `maps` too, the first seven maps (`normal` to `opacityMask`: a proxy's transfer writes no occlusion nor anisotropy map)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `layers[].reuseLightmapUVs`, `uvMethod`                    | A `merge` layer's coordinates for a mesh baked on its own triangles: where `reuseLightmapUVs` is `true` (the default) and the mesh has a texture set at its lightmap index, it is baked at that set, and its merged coordinates are that set's; else, or with `false`, at coordinates generated by `uvMethod` — per mesh, or with `false` once for all the entries, below —: `default` or `patchBuilder` (the patches unwrap), `xAtlas` (the charts unwrap), `legacy` (the old chart layout of the mesh's own first texture set: its triangles are joined into charts wherever two share an edge whose coordinates and winding agree, charts that meet along a whole side of their boxes are joined, and the charts are packed, in their eight orientations, into a square a quarter of the atlas's side wide — 32 to 512 texels —; each corner takes the coordinates of its own chart, and the whole is then scaled to fill the unit square, an axis of no span, or of no finite span, only moved; a mesh with no first texture set, or whose charts have no area, an area that is no number, or outnumber the texels of the square, takes the patches unwrap instead, scaled the same way) or `uvAtlas` (charts cut by spectral analysis of the surface at a stretch bound of 0.11 and packed into 512 texels with a 2.5-texel gutter; a mesh the cut fails on — one with a vertex shared by two fans of triangles — keeps its own first texture set, and a layer laying its meshes out together, whose cut of the whole fails, lays each mesh out on its own). A mesh imported without generated lightmap coordinates has its lightmap index at its first open set — as many as it has sets, 1 when it holds eight —, which it lacks: a glTF mesh gets generated coordinates, as before. With `reuseLightmapUVs: false` the meshes are laid out together: every entry of the layer is baked on its mesh, whatever `bakeOnMesh` says, at coordinates generated once for the triangles of all the entries as one mesh — its triangles that wear the same values in every texture set and the same colour as an earlier triangle of the same entry (the copies of one mesh) are folded into it and take its coordinates; the `legacy` layout then scales the coordinates of every corner of every entry together to fill the unit square — and all the entries are baked into the one atlas: no cell, no gutter and no binning (`atlasGutter` and `binByTextureSize` change nothing), an entry's texels copied where a triangle wrote them and over any entry's before, the atlas's empty texels then filled from the texels beside them; an entry costs its own triangles' texels, not the atlas's. Where the unwrap of the whole fails (`uvAtlas` on a mesh the spectral charts cannot cut) each mesh is laid out on its own instead, still into the one atlas. With `reuseLightmapUVs: true` (the default) each mesh is laid out on its own, as before. A `simplify` layer reads `reuseLightmapUVs` too (default `true`): an object whose every primitive has a texture set at its lightmap index bakes on those sets, else on coordinates generated for the whole object |
| `layers[].groupIdenticalMeshes`, `allowVertexColors`       | A `simplify` layer's proxy settings. `groupIdenticalMeshes` (default `false`): the objects that place one mesh are baked once, from the first of them — its images and the coordinates generated for its triangles, which each other object's primitives read at their own triangles —, faster and sharper, but a material that reads its world position or per-instance data looks as the first object's. `allowVertexColors` (default `false`): the simplified mesh carries its sources' vertex colours — each vertex the colour of the source triangle nearest it, blended at its projection and set back to the triangle's mean luminance, white where no source answers —, else none; the atlas holds the sources' colours already, so a material that draws vertex colours shows them twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `layers[].clusterDag`                                      | Whether each actor an `approximate`, `merge` or `simplify` layer builds gets a cluster DAG, its coarser levels drawn within the pixel error; `false`, the default, its mesh drawn whole at every distance, as the reference builds a merged, approximated or simplified mesh by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `layers[].allowDistanceField`                              | Whether the mesh of each actor an `approximate`, `merge` or `simplify` layer builds gets a signed distance field, built from the actor's own triangles in the world's space (the cell's sections together, a blended section left out) and written beside the source meshes' in `distanceFields.bin`. The sun's distance-field shadow traces the meshes that are no cluster geometry, as the reference's far cascade does, and every mesh the engine draws is made of clusters, which the shadow maps take at any distance: the field is read by the other distance-field passes, and the sun's shadow of this actor is the maps'. Default `true` for an `approximate` layer, `false` for a `merge` or `simplify` layer. An `instanced` layer's objects draw their own meshes, which have their own fields, and a `voxel` layer builds no triangles: both refuse the setting. The field is built at the settings of the job's own `meshBuild` (`distanceField`, `distanceFieldTwoSided`, `distanceFieldDensity`, `distanceFieldMaxResolution`, their defaults where it names none), so `distanceField: false` there builds none for any layer; its resolution scale is always the default, 1 — `distanceFieldScale` is a source mesh's own, and the mesh of an actor is a new one —, and with `distanceFieldTwoSided` on every triangle counts two-sided, whatever its material. The memory of the field is part of the working set the layer's job is admitted with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `true` (approximate), `false` (merge, simplify) |
| `layers[].disallowClusterDag`                              | An `instanced` layer's objects drawn without their cluster DAG: `false`, the default, each keeps its own DAG and the layer builds no mesh; `true` stands each object it takes on the fallback of its mesh (the last LOD, made once per mesh, drawn whole), the layer staying instanced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `layers[].meshBuild`                                       | How a `merge` or `simplify` layer builds each actor's mesh, as the reference reads it from those layers alone (an `approximate` layer's actors take every default): `keptTriangles`, `trimmedError`, `dropNearCollapsed` and `alwaysResidentKib` as [`meshBuild`](#mesh-build-settings) names them for a mesh — `alwaysResidentKib` the root pages the actor's HLOD cell holds while the actor is loaded —, `shapePreservation` (`none` or `area`), `edgeLengthBound` and `holdTextureCoordinates` as a mesh's `extras` names them ([How a mesh coarsens](#how-a-mesh-coarsens)); each its default when left out. A `voxel` layer's names how its cells' voxels are sampled, the six `voxel…` settings of [`meshBuild`](#how-voxels-are-sampled) and no other. An object standing as itself keeps its own mesh's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `layers[].translucency`                                    | How an `approximate` layer's atlas, a `merge` layer's merging its materials, or a `simplify` layer's flattened sources, bake a translucent source (one that transmits light or one drawn alpha-blended): `seenThrough`, over what lies behind it ([Translucent sources](#translucent-sources)); `surfaceOnly`, its surface alone — an approximation sees what lies behind it, a merged atlas bakes its own colour; `true` is `seenThrough`, `false` `surfaceOnly`; default `seenThrough`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `layers[].emptyTexels`                                     | What an `approximate` or `simplify` layer's atlas holds where it holds no chart's value — its empty texels, outside every chart, and its gutter's copies of texels no view sees: `nearestChart`, the nearest chart's values on every map, the normal map's too, given before the holes are filled and the atlas averaged down, so no black reaches a chart's border nor a mip; `black`, black (the frame's up on the normal map, zero on a baked roughness or metallic), which the holes beside a chart, the averaging down and the mips then read, so a chart's border darkens on far levels; `true` is `nearestChart`, `false` `black`; default `nearestChart`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `layers[].sizeFilter`, `minExtent`, `minArea`, `minVolume` | Which objects an `instanced` layer takes by their world box: `none`, `extent` (largest half extent, metres), `area` (surface, m²), `volume` (m³), each at least its setting (default 0); an object turned away enters no HLOD, an [instanced skinned object](#animation-banks) is never turned away; default `none`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `assign[].match`                                           | `node`, `mesh`, `material` (one of the mesh's), each the exact name or a regular expression, and `extras`, values the node's `extras` holds; every field named must match, at least one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `assign[].layer`                                           | A layer, whose actors are then the object's HLOD 0; the first rule that matches wins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `default`                                                  | The layer of an object no mark nor rule names; none by default: such an object has no HLOD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The merge and instanced settings above, on three layers of one job:

```ts
hlod: {
  layers: [
    // Objects drawn on the fallback of their meshes, never through their cluster DAG.
    { name: 'props', builder: 'instanced', disallowClusterDag: true },
    // Materials merged: more maps beside the base colour, each at its own side, a mesh baked on
    // its own triangles laid at generated charts where it has no lightmap texture set.
    {
      name: 'blocks',
      builder: 'merge',
      mergeMaterials: true,
      textureSizing: 'manual',
      mapSizes: { base: 2048, normal: 2048, roughness: 512, metallic: 512, ambientOcclusion: 512 },
      maps: { roughness: true, metallic: true, specular: true, ambientOcclusion: true, opacityMask: true },
      reuseLightmapUVs: false,
      uvMethod: 'xAtlas',
    },
    // Materials kept: the merged mesh keeps its sources' vertex colours.
    { name: 'tinted', builder: 'merge', bakeVertexColors: true },
  ],
  default: 'blocks',
}
```

A merged chain whose coarse levels shade the far band: a merged shell has no distance field by default,
and asks for one with `allowDistanceField` (an approximated shell has one by default; `false` leaves it
out). The density and the most voxels along an axis are those of the scene's meshes, the HLOD cells'
included:

```js
await compile({
  source: 'district.glb',
  cache: 'cache/district',
  resourceBaseUrl: '/assets/district/',
  hlod: {
    layers: [
      { name: 'hlod0', builder: 'instanced', parent: 'hlod1' },
      {
        name: 'hlod1',
        builder: 'merge',
        parent: 'hlod2',
        lodSelection: 'lowest',
        allowDistanceField: true,
      },
      {
        name: 'hlod2',
        builder: 'merge',
        parent: 'hlod3',
        lodSelection: 'lowest',
        allowDistanceField: true,
      },
      { name: 'hlod3', builder: 'approximate', spatiallyLoaded: false },
    ],
    default: 'hlod0',
  },
  meshBuild: { distanceFieldDensity: 0.2, distanceFieldMaxResolution: 256 },
})
```

The world report (`worldRoots` in the compile result) gains `actorFields`, the number of HLOD cells that
got a field; the cook's step timings (`metrics.hlodStepMs`) gain `distanceField`.

The old chart layout on a `merge` layer, the spectral charts on an `approximate` one:

```ts
hlod: {
  layers: [
    // Each cell's meshes merged into one atlas, a mesh baked on its own triangles laid out by the
    // old chart layout of its first texture set.
    {
      name: 'blocks',
      builder: 'merge',
      mergeMaterials: true,
      reuseLightmapUVs: false,
      uvMethod: 'legacy',
      parent: 'far',
    },
    // The far shells unwrapped by spectral charts at a looser stretch bound.
    {
      name: 'far',
      builder: 'approximate',
      spatiallyLoaded: false,
      approximation: { uvMethod: 'uvAtlas', uvAtlasStretch: 0.2 },
    },
  ],
  default: 'blocks',
}
```

A job that names no `uvMethod` and keeps `reuseLightmapUVs` on keeps its cache key and its bytes. A job with
`reuseLightmapUVs: false` has new bytes (the entries are laid out together now): recompile it.

The compiler refuses the job (`INVALID_OPTIONS`, never the whole batch) for a field a layer's
builder does not take, a name given twice, a parent or a rule naming no layer, a cycle, a parent
wearing its sources' own materials above a layer whose actors wear materials of their own, a
layer not spatially loaded naming a cell size or a loading range, a chain past 256 levels — the
world table writes a level in 8 bits —, a match naming nothing, a regular expression that does not compile, an atlas setting
on a `merge` layer that keeps its materials, `bakeVertexColors` on one that merges them, a sizing's
setting beside another sizing (a `merge` layer's `textureSize` beside a sizing other than `fixed`
and `biased` included), a size filter's setting beside another filter, `opacity` and `opacityMask`
both baked, an `extras.hlodInclude` that is no boolean, and
values out of bounds. The HLOD is part of the cache key.

A `merge` layer merging its materials makes one entry per material and what it is baked on: a
full-frame quad of the material, the tile its sources' own coordinates address, or — where the
look depends on the mesh (`bakeOnMesh`), or on what lies behind a translucent material seen
through (`translucency`), whatever `bakeOnMesh` says — that mesh's triangles at coordinates laid
once per mesh: its lightmap texture set where `reuseLightmapUVs` (on by default) finds one, else
coordinates generated by `uvMethod`. Every quad of one material is one entry, so a material is baked once
however many objects wear it; the copies of a mesh mirrored alike share one entry, read behind
as its first copy lies. Each entry is baked at the atlas's side, one sample a texel at its centre, its
textures filtered over the texel: the compiler decides which texel each triangle covers, and the GPU
reads the material there, by the program an `approximate` layer's atlas reads its sources with, on
the compile's one device — its bytes follow that GPU's arithmetic, as a shell's do; an image of
one value shrinks to one texel, the texels no triangle covers take the mean of their neighbours
ring by ring. The entries then fill a grid of
`⌈√n⌉` cells a side (or binned squares), each brought down to its cell less its gutter by a
Mitchell–Netravali cubic, the gutters and empty cells filled the same way; each object's texture
coordinates move into its entry's cell.

A mesh's generated coordinates — those of a mesh that has no texture set to reuse, or of a layer
with `reuseLightmapUVs: false`, by default its patches (`uvMethod` `default` or `patchBuilder`; `xAtlas` cuts
and packs its charts instead, as an `approximate` layer's `uvMethod: 'charts'` does; `legacy` and
`uvAtlas` as above) — are
unwrapped at fixed settings, whatever the layer:
a hundred initial patches, the normal's turn weighed once, islands merged up to a mean squared
area distortion of 1.5 and a normal turn of 45°. The mesh is first welded and held as a mesh
holds one: a triangle naming a point twice or repeating another is left out and keeps its own
first texture set; one on an edge two triangles hold already gets copies of that edge's points.
A layer with `reuseLightmapUVs: false` unwraps all its entries' triangles as one mesh, once, at
these settings (one packing for all of them): each entry's points are welded among themselves,
never with another entry's.
The initial patches are as many seeds as the area holds at one per the mesh's area over the
patch count (at most one per vertex), each component's next seed the triangle furthest from its
seeds so far, every triangle then given to the seed nearest by a distance weighed by its normal's
turn; a patch of one triangle joins a neighbour and a triangle bordered on all its other sides by
one patch moves into it. The patches and the island candidates are ordered by a fixed unstable
sort, so equal scores always fall in the same order. Each island is flattened by an exponential map
from its vertex furthest from its longest boundary loop — the boundary walked as its triangles
wind it, split at a vertex it passes twice —, in a frame laid along the edge that vertex met first,
then turned about its normal to the world's horizontal axes; the map's vertex normals are weighed
by area and interior angle and smoothed five times, each time a quarter of the way towards their
neighbours'. The map is drawn in the axes of a `z`-up mesh, the scene's `y` and `z` exchanged, and
its fronts take vertices in order of their distance in single precision. A whole map — an open
island, every vertex reached — is turned about the centre of its bounding box to its least-area
bounding box, in single precision: the convex hull of its vertices, one entry each in the order its
triangles first name them, gives the directions tried, one per hull edge, and the map turns only
when an edge's box has strictly less area than the axis-aligned one. The islands are then packed
into a square of 512 texels. Where the packer finds no
layout — more islands than texels, or islands of no area — the maps' own coordinates are kept
and the mesh is baked all the same, reading what of them lies in the square. An `approximate`
layer's `uvMethod: 'patches'` unwraps its shell the same way at its own patch settings, then packs
the islands again onto its atlas's blocks; there too, a packing that finds no layout keeps the
coordinates as they were.

An `approximate` layer's `uvMethod: 'uvAtlas'` cuts its shell into charts by spectral analysis of
the surface: the shell is held as a mesh, turned over, and cut into as many charts as keep their
stretch under `uvAtlasStretch`, every face's metric the identity; the charts are packed into 512
texels with a 2.5-texel gutter, then packed again onto the atlas's blocks as every method's are. The
shell is not cleaned first: a vertex shared by two fans of triangles makes the cut fail, and a shell
whose cut fails is projected from the faces of its bounding box instead — each triangle onto the
face its normal is nearest, a region of one triangle joining the neighbour that holds more —, then
packed the same way. A `merge` layer's `uvAtlas` unwraps a mesh the same way at a fixed stretch
bound (0.11); a mesh whose cut fails keeps its own first texture set.

The atlases of the `approximate` layers are baked on the GPU, and their shells are built there too:
each point the solid is sampled at learns whether it lies inside, and the gaps are closed from each
point's distance to the nearest triangle. A shell's scene holds each source mesh once, in its own
space, however many objects place it: a point is brought into the mesh's space by each object
whose box holds it, and there reads the mesh's winding number, its far triangles expanded to the
second order; the first object that finds it inside ends the sum. Each part is measured for
thinness in its mesh's own space, under each scale its objects carry: a thin part is copied once
per scale, thickened by a shell, and placed by its objects with their scale taken out — a turned
copy reads as an unturned one. The surface is followed from some of each mesh's vertices as they
lie, a thin part's too. A source mesh is welded by position unless the layer reads its render
meshes (`useRenderLODMeshes`), its vertices then as its buffers hold them. A layer capping its
base (`baseCapping`) adds one mesh last: the convex hull of each object's vertices within the
base's height above the scene's lowest point, hulled again together, flat there and facing down
or extruded up into a slab. A layer clipping at a ground plane (`groundClipping`) drops, with the
hidden triangles, those wholly on or under it (`discard`), or cuts the shell along it once its
hidden triangles are dropped, what lies under removed, its degenerate cut edges collapsed and,
with `cutAndFill`, each cut loop filled by a constrained Delaunay triangulation of its outline. The compiler opens one headless device per process the
first time a layer needs one (Metal, Vulkan, Direct3D 12 or GL), never reopens it, and fails the
job with `GPU_UNAVAILABLE` on a machine that has none; a `merge` layer merging its materials and a
`simplify` layer bake their entries on that device too, by the same program, and are refused the
same way. A shell's scene is one GPU binding, never split: past the adapter's
`max_storage_buffer_binding_size` the job fails with `GPU_BAKE_FAILED`; so does a merged or
simplified entry's, which holds its own triangles — every part of the merged mesh when the entry is
seen through (`translucency`).
A shell is simplified whole, each pass over every triangle at once. Its atlas reads the sources
through 22 views of them — the six axes, the cube's eight corners, four edges of its top and its
four side edges, each square image `captureResolution` pixels a side framing the sphere of the
objects' bounds — each object's mesh box placed by its matrix, its sphere scaled by the matrix's
largest axis, gathered as a merged actor's are —, grown by a quarter, within `captureFieldOfView`
—: each texel takes the view that faces its
normal most squarely among those that see its point past the shell, bilinearly between the four
pixels around it, each pixel what the view draws along the one ray through its centre — the
property images are drawn with no anti-aliasing —, its materials filtered over the pixel's
footprint as an anisotropic sampler filters a texture — as many samples along the footprint's
longer side as it spans the shorter, up to `captureAnisotropy` (8), each trilinear at that
share's level —: the first surface it meets, a translucent one composed over what lies behind
it ([Translucent sources](#translucent-sources)), each pixel then kept at the precision a view's
buffers hold it: the base colour in eight-bit sRGB, the normal at ten bits a channel, roughness,
metallic and specular at eight bits, the emission at half precision; with `translucency: 'surfaceOnly'`, a view
draws no translucent surface, so the surface behind it shows: a glass curtain wall takes the
colour of what lies behind its panes. Only the pixels a texel reads are traced. A texel no view
sees is a hole, filled from the texels around it on the base colour, the metal-roughness map and
the emission; the normal map is never filled. A baked specular (`maps.specular`) rides in the
packed metal-roughness map's red channel — a source's own is its `KHR_materials_specular`
factor times its specular texture's alpha, one half where it declares none —, which no material
input reads yet; a baked emission (`maps.emissive`) is the sources' `emissiveFactor`, strength
and emissive texture, held as an sRGB map of the emission over its largest channel, that channel
the material's emission factor (`KHR_materials_emissive_strength` past one). The atlas is sized
by `textureSizing`, baked at its largest side and each map averaged down to its own. The normal map is written in the shell's own tangents — per corner, averaged over the
corners about its vertex that share its normal and its coordinates —, which its pages store and
the engine bends the map with. Before that, by default (`emptyTexels: 'nearestChart'`), every texel that holds no chart's
value — outside every chart, or in a gutter copying a hole — takes the nearest chart's on every
map, the normal map's too: ring by ring outward from the charts, each the mean of its neighbours
already holding one, the dilation a `merge` layer's atlas fills its gutters and empty cells by. So
the holes filled beside a chart, the supersampling's averaging down and the mips read no black;
`black` leaves those texels black, the frame's up and zero, and far charts' borders darken. One
GPU always bakes the same bytes; two GPUs may part by a unit in a texel's byte, so a
cache cooked on one machine stays valid there.

### Simplified layers

A `simplify` layer (`builder: 'simplify'`) builds one actor per cell from the cell's original
objects — every object under the cell, whatever its level, never an actor of the level below —,
step by step, in centimetres and in a frame with `y` and `z` exchanged, as the method is written:

1. **Screen size and voxel.** The objects' bounding sphere seen where the actor is first drawn
   spans a share of a 1920-texel view, 45° half angle; that share times 1920, rounded, is the
   screen size in pixels. The voxel is `simplification.voxel`, else the bounds' largest side
   over the pixel count held from 50 to 900, times 1.95 / 3.
2. **Materials flattened.** A material whose look the mesh decides — a texture in a baked map, a
   vertex colour, a translucent material seen through (`translucency`) — is baked once per object
   wearing it, on the object's triangles at the texture set its meshes have at their lightmap
   index where `reuseLightmapUVs` (on by default) finds one on every primitive, else at
   coordinates generated for the whole object (the same unwrap a `merge` layer bakes on); every
   other material once, on a quad. With `groupIdenticalMeshes` the objects that place one mesh
   are one object, baked from the first of them: each other's primitive reads that bake and those
   coordinates at its own triangles. The bake's side is the layer's sizing over the objects' area
   and sphere, at the largest side a per-map sizing names; an image of one value shrinks to one
   texel.
3. **Volume.** The objects' signed distance field, two voxels of band each side, each voxel's
   nearest source triangle kept. With `gapWidth`, the gaps up to it are closed: the surface
   moved out by half of it in steps of at most 1.5 voxels (a coarser grid once more than
   `gapSteps` steps are needed), moved back, then eroded half a voxel more and united with
   the untouched field — doors and windows narrower than the distance come back plugged.
4. **Surface.** The surface half a voxel outside the sources, each vertex given its sources'
   normal where it leans within about 78° of its own, and drawn three quarters of the way onto its
   nearest source, so single-sided objects do not thicken.
5. **Simplification.** Quadric edge collapses priced on position and normal, the volume kept, until
   a collapse costs more than a cube of one pixel's span would — the bounds' diagonal over the
   pixel count — or a five-hundredth of the source triangles remains; in slabs across the bounds'
   largest axis first unless `serialSimplify`. `separateFoldedWalls` pushes apart faces the
   collapses folded into each other, a seventh of a voxel along their normals.
6. **Normals.** Angle-weighted normals, kept for the transfer's rays; the vertices split past
   `hardAngle` (under 179°); the normals again, weighed as `normalMethod` says.
7. **Charts and tangents.** The atlas sides are the layer's sizing over the simplified mesh's own
   area and sphere — one side, or each map's own with `biased` and `manual`, the grid the largest
   of them, at least 64 texels; the charts are packed for that grid. The mesh's bowties are broken
   (five passes at most), then it is cut by a spectral partition — any number of charts, each
   stretching 0.125 at most — and packed with `atlasGutter` texels between charts. A mesh that
   cannot be charted fails its actor. Each vertex then takes a tangent frame — the tangent along
   the atlas's `u`, the sign of its bitangent — from its normal and its triangles' texture
   coordinates, which the actor's pages store.
8. **Transfer.** Every texel of the grid, sixteen samples a texel, fires a ray each way along the
   kept normal, as far as `transferDistance` (six voxels by default, never under one voxel nor past
   the bounds' largest side); `transferRays: 'nearest'` keeps the nearer hit, `'facing'` prefers a
   source facing the ray's way. Each map is read from the hit's flattened images: the base colour
   bilinearly, its luminance kept as the samples average down, a sample no ray answers
   `unresolvedColor`; the coverage (`opacity` or `opacityMask`, the base image's alpha), the
   specular, roughness and metallic, and the emission, each averaged down from the samples a
   source answers, none for a sample no ray answers; the normal map decoded into world space, its
   samples' mean weighed by the inverse of a tenth plus the squared cosine each makes with the
   texel's normal, and written in the texel's tangent frame — the mesh's tangent and normal
   blended at the texel, the bitangent and the tangent made orthogonal to them with the
   handedness the corners' signs blend to — as the frame's inverse (its transpose where its
   determinant is a thousandth or less) takes the mean, made unit only when a component leaves
   [−1, 1]: a mean of normals that disagree stays shorter than one. Each map is then averaged
   down from the grid to its own side. The texels outside the charts take the nearest chart's
   values (`emptyTexels: 'nearestChart'`) or stay black.

The actor's material draws both faces when one of its sources' does and `allowDoubleSided` lets
it. A layer naming none of these settings builds exactly the method's defaults. An emission map
holds each source's emission over that source's own strength, and the actor's strength is the
largest of them. The method's `calculateCorrectLodModel` is not offered: every actor is built
from the cell's original objects at their level 0, whatever the distance it is drawn from, as
every HLOD level is.

```ts
await prepare(source, cache, 'slice', 150000, {
  hlod: {
    layers: [
      { name: 'buildings', builder: 'instanced', parent: 'far' },
      {
        name: 'far',
        builder: 'simplify',
        textureSize: 1024,
        textureSizing: 'biased',
        maps: { normal: true, roughness: true, emissive: true },
        groupIdenticalMeshes: true,
        simplification: { gapWidth: 2, hardAngle: 80, transferRays: 'nearest' },
      },
    ],
    default: 'buildings',
  },
})
```

The same layer from the command line:
`trillion3d-compile '--hlod={"layers":[{"name":"buildings","builder":"instanced","parent":"far"},{"name":"far","builder":"simplify","simplification":{"gapWidth":2,"hardAngle":80}}],"default":"buildings"}' …`.

### Translucent sources

A translucent source — one that transmits light (`KHR_materials_transmission`) or one drawn
alpha-blended — is baked by default as it is seen through (`translucency: 'seenThrough'`), on
every level alike, so a far glass tower keeps the tint it has up close. The engine draws such a
surface as a layer over what lies behind it: its own lit layer covers a share `c` of the pixel —
its opacity where it is blended, times, where it transmits, `max(1 − transmission, metallic)` —, and what lies behind it shows through the rest. A baked texel is opaque, so each
of its channels — base colour, roughness, metallic — holds `c` of the surface's own value and
`1 − c` of the value of the first opaque surface behind it, translucent layers composing front to
back (eight at most); where nothing opaque lies behind, the last layer met stands for it, so a
pane against the sky keeps its own colour. The normal is the outermost surface's. An
`approximate` layer's views compose the layers along each pixel's ray; a `merge` layer's atlas
bakes a translucent material on its mesh and composes each texel over what the ray from it inward
along its normal meets among the merged objects. The absorption colour and the Fresnel the engine
lays on the light passing through are not baked: they tint light, which no material channel
holds. For the curtain wall of a tower — base colour 0.35/0.45/0.55, metallic 0.3, roughness
0.06, transmission 0.4 — `c` is 0.6: the texel holds 0.6 of the pane over 0.4 of the core behind
it. `surfaceOnly` bakes the surface alone: an approximation's views skip it and show what lies
behind, a merged atlas bakes its own colour.

## How a mesh coarsens

Every primitive's coarser levels are built by one cluster DAG (`asset-compiler-rust/src/dag`).
It carries every attribute the pages carry — the normal, the stored tangent, every texture set the
primitive has, read by its material or not, the colour — and the bones of a skinned primitive.
The source is first read as a mesh build reads it (`dag/input.rs`):

1. every vertex is built (`dag/input/built.rs`): a colour's red, green and blue are brought from
   sRGB to linear; a position that is not finite is the origin, a normal or a stored tangent that
   is not finite is nothing, a texture coordinate pair (0, 0) and a colour white; a triangle two
   of whose corners are one vertex is dropped;
2. the frames are rebuilt as the mesh's settings name it (`dag/input/frames.rs`, below): by
   default every normal is rebuilt, and every stored tangent by MikkTSpace (`dag/input/mikk.rs`);
   with `recomputeNormals` and `recomputeTangents` off, only a normal that is nothing and the
   stored tangents of a vertex whose frame is not whole are. Each triangle's normal, and its
   tangent and binormal along its first texture set, are read over its corners in centimetres; the
   triangles around a vertex fall in groups joined by the edges they share from it — every edge is
   soft —, each group summing its triangles' — each weighed by its area times its angle at the
   vertex with `computeWeightedNormals` —; a MikkTSpace tangent is the angle-weighted mean of the
   texture derivatives of the triangles around its vertex that share its normal, texture
   coordinates and mapping orientation, its sign −1 where that mapping keeps its orientation. A
   vertex whose corners take different frames is cut in one vertex per frame. A skinned mesh keeps
   its source's frames, rebuilding only those that are not whole, its tangents rebuilt for its weld
   alone when its pages store none; a mesh without normals gets the rebuilt ones when
   `recomputeNormals` is on, and stays without when it is off;
3. the normal, the tangent's direction and the bitangent (the tangent across the normal, times the
   sign) are made unit, the sign 1 unless the unit frame turns the other way — a tangent along its
   normal signs 1 —; each colour channel becomes the byte of its sRGB encoding, its alpha the byte
   of its linear value;
4. without bones, a triangle two of whose corners are one point is dropped, and so is one two of
   whose corners lie within 200 nanometres of each other on every axis when `dropNearCollapsed` is
   on (below; off by default), and every corner, in triangle order, points at the first vertex
   laid before it at its very position whose normal, tangent and bitangent lie within 2·10⁻⁵ on
   every axis, whose texture coordinates lie within 1/1024, and whose colour bytes and bones are
   equal; one none matches lays its own vertex, so an unindexed mesh clusters as the indexed one it
   draws the same as;
5. with bones, every corner meets the corners whose position lies within `skinnedWeldPosition`
   (200 nanometres) of its own on every axis, and points at the first vertex one of them laid
   before it that lies as near and matches it as above, within `skinnedWeldNormal` and
   `skinnedWeldTexture` (`dag/input/skinned.rs`); a corner none matches lays its own vertex, a copy
   when an earlier corner already laid it, the two kept apart; a triangle two of whose corners then
   point at one vertex is dropped;
6. a colour white at every vertex is dropped; once level 0 is cut, every value is held within its
   range — a position coordinate within ±10¹⁰ metres, a texture coordinate within ±10¹² (a page then holds one at ±2.1·10⁹ at most, its greatest code), a colour
   within [0, 1] — and every normal made unit, every stored tangent made unit across it with its
   sign `±1` and every colour clamped, as every simplification corrects the vertices it places.

The DAG and the pages read each colour channel as its byte's share of 255, the linear value read
quantized; the arrays the DAG hands the pages are held within range again, the vertices its
simplifications placed with them. Level 0 is a partition of its triangles into clusters of 124 to 128
triangles — a mesh of at most 128 is one cluster, its triangles in the Morton order of their
centres —; every level after groups 8 to 32 neighbouring clusters, simplifies the group with the
edges it shares with other groups locked, and re-splits it into clusters (multilevel recursive
bisection, the partitioner of `page-codec-wasm/src/partition`). Vertices equal in every float the
build carries are one vertex to a group. The bones weigh nothing in the error: a vertex a
simplification places takes those of the vertex nearest its position, and deforms as it.

Which edges a group locks is carried from level to level (`dag/clusters.rs`, `dag/border.rs`):
every edge of a level-0 cluster counts its links to the triangles of other clusters; each level of
more than 32 clusters keeps, of each counted edge, the counted edges of other clusters running it
back, an edge that meets none counting no more, and joins its clusters by them into groups (a level
of 32 clusters or fewer is one group: its clusters keep the counts their own groups left them); a
group takes away the edges its own other children run, locks the ends of what is left, and every
edge its simplification leaves end to end as it was takes its count back, each re-split cluster
adding its links to the group's other new clusters. An edge a simplification lays along a
neighbour's without having been counted stays free. Every level's new clusters follow the order of
their identities, so the build is the same however its groups are scheduled; a level of one group
lays them in the order its reduction made them. Once every level is built, each cluster's triangles are laid in strips, and a cluster whose strips lay more than 256 vertices
is halved, both halves drawing in the whole cluster's box.

A group that no target size re-splits — practically never, the simplifier removes triangles when
its collapses run out — keeps its children and its error and makes no coarser cluster: past that
error, its surface is no longer drawn, and the `stall` event names it: its `rootTriangles` are the
level-0 triangles no coarser level replaces, a root's or a stalled group's child's.

A mesh's glTF `extras` set how it keeps its shape as it coarsens:

| Key                      | Values                                                                                                                                                                                                                                                                   | Default |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `shapePreservation`      | `none`; `area`, each simplification pushes the open border of the material that lost the most area outwards by what it lost, so thin pieces (leaves, blades, cards) keep their coverage with distance; `voxelize`, voxels far away ([Voxels far away](#voxels-far-away)) | `none`  |
| `edgeLengthBound`        | A number of at least 0: a collapse costs at least the square of each edge it makes over this bound, in units where the mean triangle of the group is a quarter to a half of a unit across, so no long sliver appears; 0 bounds nothing                                   | `0`     |
| `holdTextureCoordinates` | `true`: texture coordinates are taken from the vertices a collapse keeps instead of solved, and count nothing in the error — for texture sets holding values that do not blend, as indices                                                                               | `false` |

```json
{ "meshes": [{ "name": "fern", "extras": { "shapePreservation": "area", "edgeLengthBound": 4 } }] }
```

A shape preservation that is not `none`, `area` or `voxelize`, a bound that is not a number of at
least 0, or a hold that is not `true` or `false`, refuses the job (`INVALID_OPTIONS`). The extras are part of the source, so changing one changes the cache key.

### Mesh build settings

`meshBuild` (`--mesh-build=` JSON, `jobs[].meshBuild`, `resolveMeshBuild`) sets how each mesh is
built (`compiler/args/mesh_build.rs`):

| Setting                      | Values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Default              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `storedTangents`             | `true`: the pages store the build's tangents — the source's glTF `TANGENT` unless the build rebuilds them (`recomputeNormals`, `recomputeTangents`), rebuilt where the source has none, or +X with sign 1 for a primitive without them in a mesh another primitive of which has some —, carried through every simplification at a sixteenth of a normal's weight and their sign at a half, which the shading then takes in place of the frame it rebuilds from the triangle ([FORMAT.md](FORMAT.md#pages)); a primitive without normals, its build keeping them, stores none                                                                                                                                                                                   | `false`              |
| `recomputeNormals`           | `true`: every normal is rebuilt from the triangles, two triangles sharing an edge smoothed together, and every stored tangent with them; a primitive without `NORMAL` gets them. `false`: the source's are kept, only a normal that is nothing rebuilt. A skinned mesh keeps its source's frames either way                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `true`               |
| `recomputeTangents`          | `true`: every stored tangent is rebuilt. `false`: the source's are kept while the normals are, only a tangent whose frame is not whole rebuilt. Read only with `storedTangents`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `true`               |
| `useMikkTSpace`              | `true`: the rebuilt tangents are MikkTSpace's. `false`: each is the sum of its vertex's triangles' tangents in its group, made orthonormal around the normal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `true`               |
| `computeWeightedNormals`     | `true`: the rebuilt normals weigh each triangle by its area times its angle at the vertex. `false`: alike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `false`              |
| `skinnedWeldPosition`        | A number of at least 0, metres: how far on every axis two corners of a skinned mesh may lie apart and be welded into one vertex                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `2e-7`               |
| `skinnedWeldNormal`          | A number of at least 0: how far on every axis two unit normals, tangents or bitangents of a skinned mesh may differ and their corners be welded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `2e-5`               |
| `skinnedWeldTexture`         | A number of at least 0: how far two texture coordinates of a skinned mesh may differ and their corners be welded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `1/1024`             |
| `voxelRays`                  | A whole number of at least 0: how many rays are cast across each voxel of a voxelized mesh to sample its surface. At most 1024 are cast and a count past 1 is rounded up to a multiple of 16, so 17 casts 32; 0 or 1 casts one ray, the voxel then covered whole or not at all and no coverage handed over to its neighbours. Read only for a voxelized mesh                                                                                                                                                                                                                                                                                                                                                                                                   | `64`                 |
| `voxelLevel`                 | A whole number: the level of the mesh's DAG from which every group is voxels, whatever its triangles' error. 0 leaves a group voxels only where they are finer than its triangles; 1 is the first level, so from 1 every group is voxels, and a level below 0 acts as 1. Read only for a voxelized mesh                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `0`                  |
| `voxelBackUp`                | A number, in voxel sides: how far back each ray of a voxel starts before it. A ray whose nearest hit lies in that stretch counts neither as a hit nor as a miss; the rays are traced against every triangle of the mesh within their reach, not only those overlapping the voxel. Not read with `voxelSeparable`, nor by a voxel that casts one ray                                                                                                                                                                                                                                                                                                                                                                                                            | `0`                  |
| `voxelSeparable`             | `true`: the rays of a voxel run along its three axes alone, each through one face of it and a point of that face, one side before the face and three long; only a hit within the voxel's depth counts and a ray that hits outside it is left out of the count. A voxel whose rays along one axis all hit is covered whole when a ray through its centre along an axis hits too; a voxel that casts one ray is covered when the first of those three rays hits. `false`: rays in every direction                                                                                                                                                                                                                                                                | `false`              |
| `voxelNdf`                   | `true`: a voxel keeps the distribution of the normals its rays hit, fitted to a lobe about an axis — its normal is that axis and its record carries the ratio of the lobe's two widths, from which each pixel's shading normal is drawn anew every image. `false`: the record carries the direction of the normals' mean alone                                                                                                                                                                                                                                                                                                                                                                                                                                 | `true`               |
| `voxelOpacity`               | `true`: no coverage is handed over to the neighbours of a voxel dropped — every voxel a ray hit is kept, so a thin surface's partial coverage keeps its voxel and a sparse crown stays as dense as its leaves. `false`: the coverage is handed over until no more voxels are left than it sums to                                                                                                                                                                                                                                                                                                                                                                                         | `false`              |
| `allowAssemblies`            | `true`: the assembly the mesh's glTF `extras.assembly` names is built — each node of the assembly is a node of the scene that draws its part, and the levels of detail above the nodes are built over them with the mesh's own triangles (see [Assemblies](#assemblies)). `false`: the mesh is its own triangles alone and its `extras.assembly` is left unread, as the reference draws a mesh whose assembly it does not build while its project switch for assemblies is off                                                                                                                                                                                                                                                                                 | `false`              |
| `distanceField`              | `true`: the mesh's signed distance field is built, for the distance-field occlusion of the sky light and the software ray tracing ([Distance fields](#distance-fields)). `false`: none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `true`               |
| `distanceFieldScale`         | A number of at least 0: the mesh's resolution scale — the voxels a unit of its size holds are `distanceFieldDensity` times it. 0 builds no field for the mesh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `1`                  |
| `distanceFieldTwoSided`      | `true`: the field is built as if every triangle were two-sided, so that no back face makes a voxel inside the mesh. A double-sided material is two-sided either way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `false`              |
| `distanceFieldDensity`       | A finite number: the voxels a centimetre of a mesh of scale 1 holds. The field's bricks along an axis are rounded and held between 1 and what `distanceFieldMaxResolution` allows, so any value builds; a larger one only reaches the resolution cap sooner. Changing it rebuilds every field                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `0.2`                |
| `distanceFieldMaxResolution` | A whole number of at least 1: the most voxels along one axis a field holds; a mesh of scale 1 or less holds half of it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `256`                |
| `maxMeshCards`               | A whole number from 0 to 32: the most cards the compiler keeps for the mesh. A card is a box looking at the mesh along one of the six axis directions; the cards of a mesh cover its surface, and more of them cover it better and cost more to capture and to light ([Mesh cards](#mesh-cards)). 0 builds none for the mesh                                                                                                                                                                                                                                                                                                                                                                                                                                   | `12`                 |
| `meshCardMinDensity`         | A number from 0 to 1: how much of its box's face the surfaces a card covers must fill for the card to be kept ([Mesh cards](#mesh-cards)). Changing it rebuilds every mesh's cards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `0.2`                |
| `meshCardNormalThreshold`    | A number from 0 to 1: how squarely a surface must face a card's direction to be covered by it, the cosine of the angle between them ([Mesh cards](#mesh-cards)). Changing it rebuilds every mesh's cards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `0.25`               |
| `keptTriangles`              | A number from 0 to 1: under 1, once the DAG is built its finest detail is cut away — the cut is grown from the roots, the cluster of largest error replaced by the clusters its group was made of, until the cut holds more than this share of the source's triangles and the next replacement would lower its error further; every cluster under the cut is dropped, and the cut's clusters become leaves, drawn wherever their parent is too coarse                                                                                                                                                                                                                                                                                                          | `1`                  |
| `trimmedError`               | A number of at least 0, percent of the mesh's size — the square root of the smaller of twice its area and a quarter of its box's surface —: above 0, the same cut, grown until its error falls under this share                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `0`                  |
| `displacementMaps`           | A list of height maps `{ "texture": { "index": n }, "magnitude", "center" }`: with a `trimmedError` above 0, the mesh's triangles are tessellated where the maps bend them and moved along their normals ([Baked displacement](#baked-displacement)); the map of rank `n` displaces the mesh's primitive `n`. `texture` takes an `index` alone — the set of coordinates is `displacementUvChannel`'s — of an image whose first channel holds the height: 8 or 16 bits a channel, or floats, at most 8192 texels a side, wrapped or clamped by its sampler. `magnitude` is how far height 1 lies from height `center` along the normal, in the scene's units; `center` is the height that stays on the surface; both are finite 32-bit floats (0 when left out) | `[]` (nothing baked) |
| `displacementUvChannel`      | A whole number from 0 to 7: the set of texture coordinates the maps are read at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `0`                  |
| `displacementEdgeSplit`      | How a vertex the tessellation adds on an edge is shared: `seams`, one vertex for the triangles on both sides unless a material or a texture coordinate differs across the edge; `always-duplicate`, one a side                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `seams`              |
| `dropNearCollapsed`          | `true`: a triangle two of whose corners lie within 200 nanometres of each other on every axis is dropped before the build. `false`: only one two of whose corners are one point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `false`              |
| `alwaysResidentKib`          | A whole number of KiB from 0 to 4294967295: how much of the mesh stays resident whatever the view. Its first streaming pages are its root pages, 32 KiB and 64 clusters each, as many as that size fills, rounded up, one at least ([FORMAT.md](FORMAT.md#cluster-dag)); the session pins them while the mesh is in the scene. 0 keeps one root page, the least; a size past the mesh keeps it all                                                                                                                                                                                                                                                                                                                                                             | `0`                  |
| `positionPrecision`          | A whole number from −20 to 43: the cells of the pages' positions are `2^-n` centimetre, so each page rounds a position to the cell at `n` bits of a centimetre. Left out, the precision follows the mesh's density: 7 less the mean, over the finest clusters, of the base-2 logarithm of the half-diagonal of their box in centimetres, rounded, at least 4 — a denser mesh gets finer cells. The clusters are those the build made, the finest detail `keptTriangles` or `trimmedError` cuts away included. A named precision, like the automatic one, is lowered until every cluster's box spans at most 21 bits an axis, and refuses the compile (`PAGE_ATTRIBUTE_RANGE`) for a cluster too wide for −20 ([FORMAT.md](FORMAT.md#pages))                    | the mesh's density   |
| `normalPrecision`            | A whole number from 1 to 15: the bits an axis of each stored normal, on the octahedron (the pages' normals are two cells of that many bits)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `8`                  |
| `tangentPrecision`           | A whole number from 0 to 12: the bits of each stored tangent's angle around its normal, a turn in 2^n steps. Read only with `storedTangents`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `7`                  |

Its `objects` are rules `{ match, …settings }`, `match` naming objects as `voxelize` does (a node's
name, `{ regex, flags }` on it, or a match object). For each setting of a mesh, the first that
names it wins: the first rule matching one of the mesh's objects, `meshBuild`'s own setting, the
mesh's own glTF `extras` under the setting's name, the default:

```json
{
  "meshBuild": {
    "keptTriangles": 0.5,
    "objects": [{ "match": { "node": { "regex": "^Rock" } }, "storedTangents": true }]
  }
}
```

The precisions follow the same rules: normals of 10 bits an axis for every mesh, and positions on
cells of 2⁻⁹ centimetre (about 20 µm) for the objects named `Cable…`, the others on the grid their
density sets:

```json
{
  "meshBuild": {
    "normalPrecision": 10,
    "objects": [{ "match": { "node": { "regex": "^Cable" } }, "positionPrecision": 9 }]
  }
}
```

From Node, `prepare(source, cache, 'slice', budget, { resourceBaseUrl, meshBuild: { trimmedError:
0.5, objects: [{ match: /^Rock/, storedTangents: true }] } })`; on the command line,
`trillion3d-compile '--mesh-build={"storedTangents":true}' …`; on a mesh, `"extras": {
"storedTangents": true, "keptTriangles": 0.25 }`.

The world's HLOD merges each object's level 0 as built, before its detail is cut away, and without
its stored tangents: a merged HLOD actor rebuilds its frame, an approximated one stores the
tangents of its own shell. An HLOD actor's mesh, and an object standing as itself, keeps the
normals and tangents it is made with, whatever `meshBuild` names: its build rebuilds only a frame
that is not whole. A job naming no `meshBuild` keeps its cache
key; a setting out of its range refuses the job (`INVALID_OPTIONS`), a mesh's `extras` one too. A
primitive every triangle of which is dropped is refused (`INVALID_TRIANGLES`).

## Displacement

Two options move a surface by a height map. A material's `extras.displacement` has the surface drawn
displaced, by the run-time tessellation ([`ENGINE.md`](ENGINE.md)); the `meshBuild` settings
`displacementMaps`, `displacementUvChannel` and `displacementEdgeSplit` bake the displacement into a
mesh's own triangles when the scene is compiled. The two do not depend on one another.

### A material's displacement

glTF has no displacement map, so a material names its displacement in its `extras`. A material is
displaced only when it names a height map **and** switches its tessellation on: a material that does
neither — the default — is the flat surface its triangles describe, its table entry has no
`displacement` field and the compiled scene is byte for byte what it was before the option existed.

```json
{
  "materials": [
    {
      "name": "bricks",
      "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } },
      "extras": {
        "displacement": {
          "texture": { "index": 1 },
          "tessellation": true,
          "magnitude": 4,
          "center": 0.5,
          "fade": { "start": 4, "end": 1 }
        }
      }
    }
  ]
}
```

| Field          | Takes                                                                                                                                                | Default |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `texture`      | A glTF `textureInfo` (`index`, `texCoord`): the height map, its red channel, from 0 to 1                                                             | none    |
| `tessellation` | `true` to displace the material: nothing is displaced without it                                                                                     | `false` |
| `magnitude`    | A finite number of at least 0: the distance, in the object's units, between height 0 and height 1                                                    | `4`     |
| `center`       | A number from 0 to 1: the height that leaves the surface where it is                                                                                 | `0.5`   |
| `fade`         | `false` (never fades), `true` (the range 4 to 1), or `{ "start", "end" }`, each a number of at least 0.0001 pixels, a missing end taking its default | `false` |

A point is moved along its surface normal by `(height − center) × magnitude`. `fade` shrinks that
distance as the object recedes: it is whole while the largest displacement the material makes covers
`start` pixels on screen and gone at `end` pixels, where the surface is drawn flat. Unknown fields,
a value out of its range, or `tessellation: true` with no `texture` refuse the job
(`INVALID_OPTIONS`), naming the material and the field.

The height map is baked as a data texture beside the metallic-roughness and normal maps, in the one
data atlas. A per-job override of these fields is not read.

**The texture-coordinate density.** The compiler also measures, for a displaced material, how many
units of the object's space one unit of each of its eight texture-coordinate sets covers: over
every triangle that wears the material — the `sqrt(area / coordinate area)` of each triangle, weighted
by `sqrt(area)`, the tenth of the triangles that say the least and the tenth that say the most of each
primitive left out — and the weighted means of every primitive that wears the material added before
the division. The run-time tessellation reads the height map at the level that density asks, one
level for the whole material, so that the micro-triangles of two triangles of different stretch meet
without a crack. Nothing to write: a scene with no displaced material reads no triangle for it.

### Baked displacement

A material's displacement above moves the surface when it is drawn. A mesh can also have it **baked
into its triangles when the scene is compiled**: the compiler tessellates the mesh where the height
maps bend it, moves each vertex along its normal by the map's displacement, and builds the mesh's
clusters from the displaced result; the coarser levels are then simplified back to the error you
ask. Nothing is baked unless the mesh names a height map **and** a `trimmedError` above 0.

All the triangle primitives of the mesh are tessellated as one soup, so two primitives that meet
along an edge move together and no crack opens between them. The height map of rank `n` displaces the
triangles of the mesh's primitive `n` (its index among the glTF mesh's `primitives`); a primitive
with no map of its rank stays flat, and a map past the last primitive is not read. A primitive that
deforms — a skin, a morph target, a soft body — or that stands for a part of an assembly is left out
of the soup and built as it was. A scene that names no map is byte for byte what it was before.

The settings are `meshBuild` settings, with the reference's defaults: `displacementMaps`,
`displacementUvChannel`, `displacementEdgeSplit` and the `trimmedError` that holds the mesh to its error
([Mesh build settings](#mesh-build-settings)); the scene's, by object, or a glTF mesh's own `extras`,
the first that names it winning. The baked displacement is tessellated to a half finer than the
`trimmedError` the mesh is held to.

```json
{
  "meshBuild": {
    "objects": [
      {
        "match": "Cliff",
        "trimmedError": 0.5,
        "displacementUvChannel": 0,
        "displacementMaps": [{ "texture": { "index": 4 }, "magnitude": 0.8, "center": 0.5 }]
      }
    ]
  }
}
```

The same keys in a glTF mesh's `extras` bake that mesh wherever the job does not name them.

Everything that reads the mesh's triangles reads the baked ones: the mesh's clusters, the collider
cooked from them, the layers of the HLOD that merge the mesh, and the voxels it draws far away
(sampled from the baked mesh, not from the glTF). The normals the tessellation blended are kept, not
rebuilt from the displaced triangles.

**What the RAM budget decides.** The tessellation stops at a number of triangles that follows the
room the job's budget leaves: a quarter of what remains for the working set of one primitive that
bakes and a quarter for the records of all of them together, the other half kept for the textures'
stages, and at most 10 000 000 triangles. A job with a small budget bakes a coarser mesh, never a
refused one, and a mesh that begins above the cap is left as it was. The plan charges each
primitive of a mesh that bakes for the whole mesh at that cap — the soup, the baked arrays (which a
mesh that is voxelized keeps until its voxels are sampled), and the clusters and pages built from
them — so such primitives compile one at a time. Each height image is charged once however many
meshes name it, as held (a float and the chain of least and most heights a texel, about seven bytes
a texel); an image too large for the budget refuses the compile by name
(`RAM_ADMISSION_BUDGET_EXCEEDED`). A height image is read when the first primitive that bakes with
it asks, and shared by every map that names it; the first primitive of a mesh to ask bakes the whole
mesh, and the others take their triangles from it.

## Voxels far away

Far away a tree's leaves are thinner than a pixel: simplified triangles drop them at random, a
shell closes them into a blob that loses their cut-outs. A voxelized mesh's DAG goes on in voxels
where they hold the error better than its triangles: from that level up each group is bricks of
4³ voxels, a voxel one pixel wide where the cut draws it — no cross-fade, no pop, nothing authored
(`asset-compiler-rust/src/voxel`). Each voxel is crossed by `voxelRays` (64 by default) rays of
every direction against the mesh's level-0 triangles through their materials — a cut texel lets a
ray through, so a leaf card's cut-out thins the voxel as it thins the pixel —; the least covered
voxels hand their coverage to their neighbours until no more are left than the coverage sums to, so
a crown stays as dense as its leaves ([How voxels are sampled](#how-voxels-are-sampled) sets each
of these steps). A voxel keeps its prefiltered base colour, occlusion, roughness and metalness, the
distribution of its normals fitted to a lobe about an axis (`voxelNdf`), from which the engine draws
each pixel's shading normal anew every image, and, for a skinned mesh, its brick's joint, so wind
bending a tree's bones bends its voxels. The engine draws each brick as its box and traces its voxels pixel by pixel.

A mesh is voxelized, the first source naming it winning:

1. `voxelize` (`--voxelize=`, `jobs[].voxelize`) — the meshes of every object the match takes, read
   as `responsive` reads its match;
2. the HLOD — the meshes of every object whose layer's chain has a `voxel` layer (the expert
   form's layers);
3. the mesh's own glTF `extras`, `"extras": { "shapePreservation": "voxelize" }`.

Named is not forced: this per-mesh far field follows the one rule above — a group goes voxel only
when its voxels beat its triangles, and every group above it then too —, so a small mesh whose
triangles always hold the error stays triangles to its top. The `voxel` layer is apart: it
voxelizes each cell's objects together, whatever each mesh did.

A `voxel` layer (`builder: 'voxel'`; its `meshBuild` names how its voxels are sampled, [below](#how-voxels-are-sampled)) builds one actor per cell: the cell's original
objects voxelized together from the pixel where the cell is first seen, every level twice the one
below until one brick holds the cell, no shell and no atlas — at every HLOD level, every object
under the cell, never the actors of the level below.
Its actors are static: only an object's own voxels follow its joints.

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/park/',
  hlod: {
    layers: [
      { name: 'trees', builder: 'instanced', parent: 'canopy' },
      { name: 'canopy', builder: 'voxel', spatiallyLoaded: false },
    ],
    assign: [{ match: { mesh: /tree|bush/i }, layer: 'trees' }],
  },
  voxelize: { mesh: /hedge/i },
})
```

The same job from the command line:
`trillion3d-compile '--hlod={"layers":[{"name":"trees","builder":"instanced","parent":"canopy"},{"name":"canopy","builder":"voxel","spatiallyLoaded":false}],"assign":[{"match":{"mesh":{"regex":"tree|bush","flags":"i"}},"layer":"trees"}]}' '--voxelize={"mesh":{"regex":"hedge","flags":"i"}}' …`.
A `voxelize` naming nothing, or a regular expression that does not compile, refuses the job
(`INVALID_OPTIONS`), as `responsive` does. The runtime's `voxels` view paints each voxel in its
level's colour, the triangles in grey.

### How voxels are sampled

The six `voxel…` settings of `meshBuild` say how the voxels of a voxelized mesh — one a `voxelize`
match, its own glTF `extras` (`shapePreservation: "voxelize"`) or the job names — are sampled. Like
every mesh build setting each is read, for a mesh, from the first rule of `meshBuild.objects` that
matches one of its objects, then `meshBuild`'s own setting, then the mesh's `extras`, then the
default shown [above](#mesh-build-settings); a job naming none keeps its cache key and samples every
voxel as before. A `merge` or `simplify` layer's `meshBuild` names none of them (its shape
preservation stays `none` or `area`: voxels far away are a `voxel` layer's). A `voxel` layer's
`meshBuild` names these six alone, for the voxels of its cells, as the merged and proxy meshes of a
layer carry their own settings; `voxelLevel` changes nothing there, every level of a cell being
voxels. A voxel layer naming none samples every cell by the defaults.

```json
{
  "voxelize": { "node": { "regex": "^Tree" } },
  "meshBuild": {
    "voxelRays": 128,
    "objects": [
      { "match": { "node": { "regex": "^Hedge" } }, "voxelRays": 16, "voxelOpacity": true },
      { "match": { "node": { "regex": "^Tower" } }, "voxelLevel": 2, "voxelNdf": false }
    ]
  }
}
```

Here every voxelized mesh casts 128 rays per voxel; the hedges cast 16 and keep every voxel a ray
hit, with its coverage as opacity; the towers draw every group from the second level up as voxels
and keep only the direction of each voxel's mean normal.

From Node, `prepare(source, cache, 'slice', budget, { resourceBaseUrl, voxelize: /^Tree/, meshBuild:
{ voxelRays: 128, objects: [{ match: /^Hedge/, voxelRays: 16 }] } })`; on the command line,
`trillion3d-compile '--mesh-build={"voxelRays":128}' …`; on a mesh, `"extras": { "shapePreservation":
"voxelize", "voxelRays": 32, "voxelNdf": false }`.

A voxel layer's own sampling:

```json
{
  "hlod": {
    "layers": [
      { "name": "far", "builder": "voxel", "meshBuild": { "voxelRays": 32, "voxelNdf": false } }
    ]
  }
}
```

- A count of rays under 32 (after the rounding to a multiple of 16) is too few to tell that a voxel
  no ray hit holds nothing: the cells of a `voxel` layer sampled again one level up then include
  those no ray hit. From 32 rays only the cells a ray hit, or whose coverage was handed over, are
  sampled again. A mesh's voxels are byte-identical under the defaults; a `voxel` layer's upper
  levels follow that rule.
- `voxelOpacity` keeps every voxel a ray hit and hands no coverage over; the voxel record holds no opacity.
- A setting of the wrong kind refuses the job (`INVALID_OPTIONS`), a mesh's `extras` one too.

## Assemblies

An assembly is one mesh made of other meshes, its parts, placed by nodes: the reference's assembly (a mesh whose settings hold a
list of parts and a list of nodes, a part and a transform each). It is how a mesh holds many copies of a part — the windows of a facade,
the leaf cards of a tree — whose far levels of detail merge the copies into one surface. Nothing is built unless the mesh allows it
(`allowAssemblies`, `false` by default, like the reference's project switch): a scene without the setting compiles as before, its cache key
kept, and the import report counts the meshes whose assembly was left unbuilt (`assembly-not-built`) and the groups of nodes left out of the levels above (`assembly-group-not-merged`, below).

A mesh names its assembly in its glTF `extras`:

```json
{
  "meshes": [
    {
      "name": "Window",
      "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 }, "indices": 2, "material": 0 }]
    },
    {
      "name": "Facade",
      "primitives": [{ "attributes": { "POSITION": 3, "NORMAL": 4 }, "indices": 5, "material": 1 }],
      "extras": {
        "assembly": {
          "parts": [{ "mesh": 0, "materialRemap": [2] }],
          "nodes": [
            { "part": 0, "translation": [1.5, 3.0, 0.0] },
            { "part": 0, "translation": [4.5, 3.0, 0.0] },
            { "part": 0, "translation": [7.5, 3.0, 0.0], "scale": [-1, 1, 1] }
          ]
        }
      }
    }
  ],
  "nodes": [{ "name": "Facade", "mesh": 1 }]
}
```

- `parts`: the meshes the assembly draws, by their rank in `meshes`, each with an optional `materialRemap`: for each primitive of the part,
  in order, the glTF material the assembly draws it with (`null` for none; a primitive past the end of the list takes the first slot of the
  assembly mesh, its first primitive's material; a part that leaves the list out takes the assembly's slot of the same rank). A part is
  built with the ten settings the assembly mesh resolves — its shape, stored tangents, texture hold, edge bound and the six voxel settings —
  wherever they come from (a rule by object, the scene, the mesh's own `extras`) and whatever a rule or the `extras` of the part itself say. A part is a static mesh: no bones, no morph
  targets; and no assembly of its own (the reference refuses assemblies of assemblies, so does the compiler, for a part some node names).
- `nodes`: one instance of a part each — its `part` rank and a glTF node's transform, `matrix` or `translation`, `rotation` and `scale`, in
  the assembly mesh's own space. A part no node names is not built. An assembly holds at most 65 535 nodes, the reference's limit. An
  assembly naming no part or no node is none.
- The mesh keeps its own primitives: they are its own triangles, which join the assembly (the Facade's wall above). The assembly mesh is
  placed by nodes like any mesh.

Allowing it, for the whole scene, a mesh, or an object, as every mesh build setting:

```json
{
  "meshBuild": {
    "objects": [{ "match": { "node": { "regex": "^Facade" } }, "allowAssemblies": true }]
  }
}
```

or on the command line `trillion3d-compile '--mesh-build={"allowAssemblies":true}' …`, from Node
`prepare(source, cache, 'slice', budget, { resourceBaseUrl, meshBuild: { allowAssemblies: true } })`, or on the mesh itself,
`"extras": { "allowAssemblies": true, "assembly": { … } }`.

How it is built, as the reference builds it. Each part is a mesh like any, built once whatever the number of nodes that name it and of
placements of the assembly: its pages are written once. Each node of the assembly becomes a node of the scene under every node that places
the assembly's mesh, drawing the part's mesh at the node's transform (so a scene document gains one node a placement). The levels of
detail above the nodes are then built as the reference builds them: the mesh's own triangles are level-0 clusters, the root of every node's
part — the one cluster the part's own DAG ends in — enters that level through the node's transform, and the levels above are built over
them all like any DAG's (groups of up to 32 clusters, simplified, re-split, until one cluster is left). The merged clusters are pages of
the assembly's primitive. Each node keeps, in the scene's tables, the error and the ball of the group that replaces its part's root
(`rootParents`); the cut opens a node only while that error shows at the ball's distance: near the camera each node draws its part's
clusters, far away the group's merged clusters draw in its stead — one surface for the copies, the same comparison on both sides. While the assembly's own pages stream in, the merged
cluster stands in for them, and for the nodes with them, beside the nodes that are open: a short transient, as the reference's own streaming has.

Notes:

- The merged clusters hold one material and one set of attributes, so the levels are built for each material of the parts (after their
  remap) and each set of attributes (normals, stored tangents, texture sets, a colour — three or four wide, as its accessor says; a colour white at every vertex is no colour, and a part with a colour joins a primitive with none, white there): the nodes of one such group climb into the assembly
  mesh's primitive that wears the material, or, when it has none, into a primitive the compiler adds to the mesh (its one placeholder
  triangle is never read). A material of one node alone, with no triangle of the mesh's own of that material, climbs nowhere: that node
  draws its part down to its own root, as the reference's level of one cluster ends, and the import report counts such groups
  (`assembly-group-not-merged`). A node whose part primitive carries other attributes than the primitive it would join is left out of the
  climb the same way, told in the report of the DAG of the primitive that was to carry it (`clusters.json`, which a warm run replays) and
  in its progress event; a primitive the compiler added for nodes that all turn out unable to join it, or that fewer than two can join,
  has nothing to climb over and no triangle of its own: the compiler builds no job for it — it has no pages, no collider, no place in a
  merged layer, no point in its mesh's bounds —, its nodes draw down to their own roots, and only its progress event tells it.
- `simplification: none` builds no level above level 0 at all: the nodes draw down to their parts' roots.
- The assembly mesh's own primitives that carry levels are built with no trim of the finest detail, no voxels and no merged HLOD level; their
  collider is cooked over the mesh's own triangles (the nodes collide as their parts do).
- The reference has one switch that turns assemblies and voxels on together; here each is its own setting (`allowAssemblies`, the voxel settings).
- A node's bone influences (a skinned assembly) have no glTF form: a node naming `boneInfluences` is refused by name; a spline-bent
  assembly mesh is refused (the curve would bend the mesh's own triangles and not its parts).
- A node's error scale: an instance's error is carried through its transform's smallest axis scale (and its ball's radius through the
  largest), the same the cut applies to a placement, so the node and the merged cluster decide alike; the reference carries both through
  the largest. The two agree for a translation, a rotation and a uniform scale.
- Ray tracing and shadows: the rays' scene and the sun's shadow maps still hold each node beside the merged clusters far away (a second
  surface at the same place, harmless to the image).
- An assembly that does not read refuses the job, naming the field (`INVALID_ASSEMBLY`): where the reference logs a warning and builds the
  mesh without its parts.
- Cost: the part's pages once; the merged clusters of the assembly's primitive grow with the nodes (about the triangles of the parts' roots,
  twice over the levels); each node carries `[error, x, y, z, radius]` a primitive of its part in the tables; and every placement of a scene
  holds one word (4 bytes) more in the cut's frame words than a scene without assemblies, whether it is an assembly's node or not (see below).

## Spline meshes

A node whose glTF `extras.splineMesh` names a curve is drawn bent along it: the reference's spline mesh component (a start and an end,
each with a position and a tangent, scale, roll and offset across the curve, along a cubic Hermite curve). It is how a road, a rail, a
pipe or a fence is made of one mesh and a curve each. The mesh is bent once, by the compiler, before anything else reads it: each vertex
goes where the curve's slice at its distance puts it, its normal and tangent turn with the slice, and the node takes the bent copy; the
levels of detail, the pages and the collider are built of the bent mesh. The reference's renderer bends the mesh on the GPU every
frame, so a spline can move: this one is fixed when the scene is compiled.

```json
{
  "nodes": [
    {
      "name": "Rail",
      "mesh": 3,
      "extras": {
        "splineMesh": {
          "startPos": [0, 0, 0],
          "startTangent": [4, 0, 0],
          "endPos": [4, 0, 4],
          "endTangent": [0, 0, 4],
          "endRoll": 0.35,
          "endScale": [1.5, 1],
          "smoothInterpRollScale": true
        }
      }
    }
  ]
}
```

This lays mesh 3, whose length runs along x, on a curve from the origin heading along x to the point (4, 0, 4) heading along z, rolling by
0.35 radians and widening to one and a half times across by the end, the scale and the roll easing in and out.

| Field                        | Meaning                                                                                                                                                                             | Default                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `startPos`, `endPos`         | The curve's two ends, in the node's own space, in metres                                                                                                                            | `[0, 0, 0]`, `[1, 0, 0]` |
| `startTangent`, `endTangent` | The curve's tangent at each end                                                                                                                                                     | `[1, 0, 0]`, `[1, 0, 0]` |
| `startScale`, `endScale`     | The scale across the curve at each end, on the mesh's second and third axes after the forward one (y and z for x, z and x for y, x and y for z); a negative scale mirrors that axis | `[1, 1]`, `[1, 1]`       |
| `startRoll`, `endRoll`       | The roll about the curve at each end, in radians                                                                                                                                    | `0`, `0`                 |
| `startOffset`, `endOffset`   | The offset of the mesh from the curve across it, in the same two axes                                                                                                               | `[0, 0]`, `[0, 0]`       |
| `splineUpDir`                | The direction the curve's frame leans on, each component held within [-1, 1]                                                                                                        | `[0, 0, 1]`              |
| `smoothInterpRollScale`      | Whether scale, roll and offset ease in and out along the curve instead of changing at a constant pace                                                                               | `false`                  |
| `forwardAxis`                | The mesh's axis laid along the curve: `x`, `y` or `z`                                                                                                                               | `x`                      |
| `boundaryMin`, `boundaryMax` | The range on the forward axis that maps to the curve; when they are equal, the mesh's own extent is the range                                                                       | `0`, `0`                 |

The defaults are the reference's, its lengths in metres (its default curve is a hundred centimetres long). The curve's frame is the one
the reference builds: the up direction crossed with the curve's direction gives the first axis across it, the direction crossed with that
the second, then both rolled about the direction. With the default curve (a line along x) and the default up direction the mesh is left as
it is; for a mesh whose length runs along z with y up, set `"forwardAxis": "z"`, `"splineUpDir": [0, 1, 0]` and a curve along z.
A start scale of mixed signs mirrors the mesh, its triangles turned over and its tangents' sign reversed. A field outside the table, or of
the wrong kind, refuses the job naming it (`INVALID_SPLINE_MESH`). A node whose mesh is skinned or morphed, or that names an assembly the job
builds, cannot be bent; one that places no mesh bends nothing.

A mesh bent by several nodes is copied once for each (a rail of five hundred segments is five hundred meshes, their pages and their
builds, where the reference keeps one and bends it as it draws); the source mesh they share is decoded once. The pass appends the bent
arrays to the document's binary, which it copies once, within the job's memory budget (`RAM_ADMISSION_BUDGET_EXCEEDED` past it).

Not read: the reference's bounds scale and its mesh deform scale only widen the bounds of its GPU culling, which a mesh built after the
bend does not need; the reference's scene texture of 64 slices a spline (a project setting, on by default) is a speed up of the exact
curve this evaluates, and its half-float packing of the roll and the scales is not repeated. A bend that sends a vertex to a point that is
not a number is refused at the bend, naming the node (`nodes[N].extras.splineMesh`) and what is not finite: a position
(`NONFINITE_POSITION`) or another attribute, a normal or a tangent (`NONFINITE_ATTRIBUTE`).

## Distance fields

A mesh whose build sets `distanceField` (`true`, the default: the reference's gameplay templates, third
person, first person and top down, turn the generation on in a new project) gets a signed distance
field, read by the distance-field occlusion of the sky light and the software ray tracing. It is built from the mesh's level-0
triangles, in the reference's own unit, the centimetre (a metre is 100 of them), and written in
`distanceFields.bin` (`distance_field/`), which the manifest's `distanceFields` section names; a scene
whose meshes build none writes neither.

- The mesh's box, at least a unit of half-extent an axis, is held by bricks of 8 × 8 × 8 voxels, 7 of
  which are the brick's own and the eighth shared with the next brick for the trilinear filter, and a
  voxel of border all round the box for the gradient. A mesh with a quarter of its triangles
  two-sided or more, or built with `distanceFieldTwoSided`, has its box grown by a texel first.
- Mip 0 holds `size × distanceFieldDensity × distanceFieldScale / 7` bricks along an axis, rounded
  and held between 1 and `distanceFieldMaxResolution / 2` over 7 (the whole resolution over 7 for a
  scale above 1), at most 1023. Mips 1 and 2 halve them, rounding up.
- A voxel is one byte: its distance to the surface in the band of four voxels either side, 0 the
  farthest inside, 255 the farthest outside. The distance is the nearest triangle's; the voxel is
  inside when more than a quarter of the 98 rays it casts over the sphere (49 stratified over each
  hemisphere, drawn from a fixed seed) hit a back face of a one-sided material. The triangles of a
  blended material are left out.
- A brick holding only voxels at 0 or only at 255 is not stored: its cell of the mip's indirection
  table holds `0xffffffff`.
- Besides each compiled mesh's field, `distanceFields.bin` holds the field of each HLOD cell whose
  layer allows one (`layers[].allowDistanceField`, [HLOD](#hlod)): one field per cell,
  built from the level-0 triangles of all the cell's actors together (a merged layer keeping its
  materials makes one actor per material, and the field is of the merged mesh, its sections together).
  Its box and its voxels are in the world's space. A cell whose bounding sphere is larger than
  `meshDistanceFieldMaxObjectRadius` (100 000 cm by default) is left out by the scene at run time, as a
  mesh's placement is. The file is of version 2 ([FORMAT.md](FORMAT.md#distancefieldsbin)).

```json
{
  "meshBuild": {
    "objects": [
      { "match": { "node": { "regex": "^Hedge" } }, "distanceFieldScale": 0.5 },
      { "match": { "node": { "regex": "^Sign" } }, "distanceField": false },
      { "match": { "node": { "regex": "^Fence" } }, "distanceFieldTwoSided": true }
    ]
  }
}
```

Here every mesh builds a field as the default says, the hedges at half the voxels, the signs none and
the fences as if two-sided. To build none at all: `trillion3d-compile '--mesh-build={"distanceField":false}' …`;
on a mesh, `"extras": { "distanceField": false }` or `{ "distanceFieldScale": 2 }`. A setting of the wrong kind
refuses the job (`INVALID_OPTIONS`).

## Mesh cards

A mesh whose build keeps cards (`maxMeshCards` above 0, 12 by default: the reference's) gets them found
from its level-0 triangles, in the centimetre, and written in `meshCards.bin` (`card_representation/`),
which the manifest's `meshCards` section names ([FORMAT.md](FORMAT.md#meshcardsbin)); a scene whose
meshes keep none writes neither. A card is a box looking at the mesh along one of the six axis
directions: the few of them that cover a mesh are what a surface cache captures the mesh into. The mesh is
read as its distance field is, but for the triangles of a blended material, which the cards keep.

1. **The volume.** The mesh's box, or its distance field's where it has one, grown by a centimetre each
   side (and by at least one centimetre of half-extent), is cut in voxels of 10 cm, or larger so that no
   side holds more than 64.
2. **The surfels.** For each of the six directions, 32 rays run through each column of the volume,
   jittered across its face, against the direction, from two voxels before the volume, and go on past each
   surface they meet, from the start of the cell after the one it lies in. A surface that faces the
   direction squarely enough (`meshCardNormalThreshold`; the back of a two-sided surface counts as its
   front) and lies in a cell beyond the one after the last becomes a sample. The samples of a cell, in runs
   seen from the same cell along the rays, become its surfels: a cell, its coverage (the share of the
   column's rays) and the cell along the rays from which it is first visible. A surfel is dropped when it
   lies inside geometry: of 25 rays over the hemisphere about its normal, more than 0.8 hit and more than
   0.2 hit a back face of a one-sided material. The weighted coverage of a surfel is its coverage times one
   plus the share of those rays that leave the mesh. When the surfels of the six directions are more than
   10 000, the volume is cut again with half the voxels a side, until they are fewer or the side holds a
   voxel.
3. **The clusters.** Each direction's surfels seen from outside make a cluster; for a mesh that is not
   mostly two-sided, again and again the most covering cluster of the surfels from some cell along the rays
   on is added, while one is valid. A cluster is valid when its weighted coverage reaches 15 cells (the
   outer cluster's, 15 or half the mean area of a face of the volume, the less) and its coverage over the
   area of its box's face exceeds a third of `meshCardMinDensity`. The most covering clusters of the six
   directions are kept, up to `maxMeshCards`.
4. **The cards.** A card is a cluster's box, half a voxel further at each end of the rays, held within the
   mesh's box (10 cm past it along the rays at most).

The cards are the same at every run, whatever the threads. Besides each compiled mesh's cards,
`meshCards.bin` holds those of each HLOD cell, whether its layer allows a distance field
(`layers[].allowDistanceField`, [HLOD](#hlod)) or not, found from the cell's actors together in the
world's space at the settings of the job's own `meshBuild`, fitted in the cell's field box where it has one.

```json
{
  "meshBuild": {
    "maxMeshCards": 6,
    "objects": [
      { "match": { "node": { "regex": "^Tree" } }, "maxMeshCards": 20, "meshCardMinDensity": 0.1 },
      { "match": { "node": { "regex": "^Rubble" } }, "maxMeshCards": 0 }
    ]
  }
}
```

Here every mesh keeps at most 6 cards, the trees up to 20 with a card kept at a tenth of the default
density, and the rubble none. On a mesh, `"extras": { "maxMeshCards": 0 }`. A setting of the wrong kind or
out of its range refuses the job (`INVALID_OPTIONS`).

## Ray tracing

Every compiled primitive gets a tree a ray tracer walks, written with the others in `rayTracing.bin`
(`ray_tracing/`), which the manifest's `rayTracing` section names ([FORMAT.md](FORMAT.md#raytracingbin)); so
does every HLOD actor of the world, and a directory of the actors comes last. The tree is built over a coarse cut
of the primitive's cluster DAG, taken as the pages carry it:

1. **The cut.** Its error is one hundredth of the mesh's size (the square root of the smaller of twice the
   area of the finest clusters and the surface of their box), and it holds every cluster whose error it does not
   exceed and whose group's it exceeds: the surface is whole, with no triangle twice. Each triangle keeps the
   rank of its cluster and its own in it.
2. **The tree.** A binary tree over the cut's triangles, split by the surface area heuristic (16 bins on each
   axis, leaves of at most 3 triangles), is collapsed into nodes of eight children by opening the child of
   largest surface until a node has eight. The children take the slots in the order they were opened (the walk
   measures the span of every child it meets and goes to the nearest), and their boxes are quantised in the
   node's own frame, on a byte a coordinate. A tree whose walk would keep more than 64 nodes on its stack is
   split in halves instead of at the cheapest cuts; one that needs more even so stops the compile
   (`RAY_TRACING_TREE_TOO_DEEP`).
3. **The world's trees.** The HLOD actors are meshes of their own in the world's one DAG, each cut at the
   error of its own finest clusters, not at one for the world, and written as a record of its own naming the
   HLOD cell that shows it. The directory is a tree over the actors' boxes, one entry for each, so that a ray
   finds the actors of the cells the cut draws without trying every actor. A voxel actor has none.

A count or a rank that does not fit the file's 32-bit words stops the compile (`RAY_TRACING_TOO_LARGE`) rather than being written cut short.

The tree is the same at every run, whatever the threads. A primitive's flags tell the reader whether its
material is double-sided, alpha-masked or translucent; an actor's are those of the material it wears, a
flattened material's as it is published.

## Volumetric lightmap

A job that names `lightmapBake` (`true`, or an object of the settings below; `false` or none, the
default, bakes nothing and keeps the cache key) gets the indirect light of its scene baked on the
CPU, in `volumetric-lightmap.bin` ([FORMAT.md](FORMAT.md#volumetric-lightmapbin)), which the manifest's
`volumetricLightmap` section names (`volumetric_lightmap/bake/`). The bake follows the reference's GPU
lightmapper step for step, and a baked scene is the same at every run, whatever the threads: every
random number comes from a sequence seeded by the probe's place.

1. **The volume.** The boxes `volumes` names, or the scene's box grown by `automaticVolumeExpand`
   (cut to a cube of half-size `automaticVolumeLimit` around its centre when it is larger). It is cut
   in top-level cells of `4^maxRefinementLevels` cells of `detailCellSize`.
2. **The bricks.** The triangles of the objects that meet a box, those of opaque and masked materials,
   are rasterised conservatively on a grid four times finer than a finest brick; each fragment
   allocates the cells within a quarter cell of it that lie within two cells of a box. A brick of
   4 × 4 × 4 probes is made for each allocated cell, for each coarser level a cell has one below it
   (each level four times coarser than the last), and for every cell of the coarsest level, so that no
   part of the volume is left without light. Bricks are ranked coarse level first, then by Morton code.
3. **The probes.** `giSamples × qualityMultiplier` passes (and `irradianceCacheQuality` before them
   while `irradianceCaching` is on). Each pass takes, for every probe, one path in each of the two
   hemispheres around it — jittered inside the probe's cell, up to 32 bounces, a light drawn and
   shadowed at each surface and weighed against the light the bounce's own ray finds, Russian roulette
   by the light a path still carries — and adds the light to the probe's spherical harmonics. The sun's
   shadowing is the share of the first 32 passes whose ray toward it reaches the sky. Where the job
   names a sky light (`skyLight`), the sky is the last of the lights, drawn and met by the rays like
   the others, and the probe facing up also gathers the sky's bent normal at its first bounce: the sum
   of the directions toward the sky that the scene does not shadow, each over π — the mean direction
   the sky is seen from, whose length is the sky's visibility (1 under an open sky, 0 under a roof) —
   the sky drawn and the probe's own ray weighed against each other. A path that meets the back of a
   surface drawn on one side only is no sample; a probe lit by fewer than a third of the passes is
   not trusted.
4. **The stitching.** Padding rows are copied from the neighbouring brick of the same level; untrusted
   probes take the mean of the trusted ones around them; the border where a fine brick meets a coarser
   one takes the coarse brick's light, filtered, once for each level to cross.
5. **The smoothing.** Where a probe's spherical harmonics ring (highly directional light leaves black
   areas on the side opposite), each band is scaled down by the window that brings the squared
   Laplacian of the light to the reciprocal of `sphericalHarmonicSmoothing`; light that does not ring
   is left as it is.
6. **The trimming**, before the stitching. A finest brick the brick over it interpolates within
   `minBrickError` (the root mean square of the ambient light) is dropped; then, where the volume is
   one piece (`loadingCellSize` 0), as many finest bricks as the memory `maximumBrickMemory` asks to
   be dropped are, the ones whose mean distance to the geometry is greatest first. A dropped brick's
   place is read from the coarser brick over it.
7. **The cells.** With `loadingCellSize` above 0 (the default) the file's layers hold the coarser
   bricks, always loaded, and the finest bricks are written by cell of a grid of that size (rounded to
   a whole number of finest bricks, 8 m with the default cell), read by the runtime as the view comes
   within the loading range (`volumetricLightmapLoadingRange`) and bounded by its memory setting
   (`volumetricLightmapBrickMemory`, [SDK.md](SDK.md#volumetric-lightmap)). With a single level of
   bricks there is nothing coarser to always load, and the volume stays one piece.

| Setting                          | Meaning                                                                                                                                                                                                                                                                             | Default                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `detailCellSize`                 | A number from 0.01 to 200: the size, in metres, of a cell of the finest level; halving it can multiply the memory by up to eight                                                                                                                                                    | `2` (the reference's 200 cm)             |
| `qualityMultiplier`              | A whole number from 1 to 256: the multiple of `giSamples` the probes take                                                                                                                                                                                                           | `4`                                      |
| `giSamples`                      | A whole number from 32 to 65536: the paths a probe takes for a unit of quality, across all bounces                                                                                                                                                                                  | `512`                                    |
| `maxRefinementLevels`            | A whole number from 1 to 4: the levels of bricks (the file names a brick's span in a byte)                                                                                                                                                                                          | `3`                                      |
| `irradianceCaching`              | `true`: paths end in a cache of the radiance that leaves a surface after a first bounce; it brightens interiors and biases a little. `false` for an exterior scene                                                                                                                  | `true`                                   |
| `irradianceCacheQuality`         | A whole number from 4 to 65536: the passes that build the cache                                                                                                                                                                                                                     | `128`                                    |
| `irradianceCacheSpacing`         | A number from 0.04 to 10.24: the size of a cache cell, in metres                                                                                                                                                                                                                    | `0.32`                                   |
| `irradianceCacheCornerRejection` | A number from 0 to 8: how near a hit may be, in cache cells, for the cache to be read there                                                                                                                                                                                         | `1`                                      |
| `automaticVolumeExpand`          | A number of at least 0: how far, in metres, the scene's box grows when no volume is named                                                                                                                                                                                           | `5`                                      |
| `automaticVolumeLimit`           | A number above 0: the half-size, in metres, past which that box is cut to a cube                                                                                                                                                                                                    | `100`                                    |
| `maximumBrickMemory`             | A number from 1 to 65536: the megabytes the finest bricks may take where the volume is one piece (`loadingCellSize` 0)                                                                                                         | `30`                                     |
| `sphericalHarmonicSmoothing`     | A number from 0 to 1000 (0 to 1 in practice): how much the spherical harmonics are smoothed where they ring, 0 none                                                                                                             | `0.02`                                   |
| `loadingCellSize`                | A number from 0 to 100000: the size, in metres, of a cell of the grid the finest bricks stream by; 0 keeps the volume in one piece                                                                                              | `32` (the reference's 3200 cm)           |
| `minBrickError`                  | A number from 0 to 1000: the error under which a finest brick is dropped for the brick over it                                                                                                                                 | `0.01`                                   |
| `skyLight`                       | `true`, or an object of `intensity` (any number), `color` (three linear components), `lowerHemisphereColor` (three components) and `castShadows` (`true`): the stationary sky light the bake shines — a flat sky, as no captured sky reaches a compile job. `false` or none: no sky | none: no sky, no bent normal in the file |
| `volumes`                        | A list of boxes, each a lower then an upper corner in metres                                                                                                                                                                                                                        | none: the scene's own                    |

```json
{
  "lightmapBake": {
    "detailCellSize": 1,
    "giSamples": 256,
    "irradianceCaching": false,
    "skyLight": {
      "intensity": 1.5,
      "color": [0.7, 0.8, 1.0],
      "lowerHemisphereColor": [0.1, 0.1, 0.1],
      "castShadows": true
    },
    "volumes": [
      [
        [-40, -2, -40],
        [40, 30, 40]
      ]
    ]
  }
}
```

Here the lightmap covers a box of 80 × 32 × 80 m with cells of a metre, 256 paths a probe times the
default 4, and no irradiance cache (an open scene); the bake also shines a bluish sky of intensity
1.5: a cube that is one over the horizon (the scene's +y) and a tenth under it, times the colour and
the intensity. The sky lights the bounces in the spherical harmonics and, because it casts shadows,
the file gets its bent normal layer. On the command line,
`trillion3d-compile '--lightmap-bake={"giSamples":256}' …`, or `--lightmap-bake=true` for every
default; `--lightmap-bake='{"skyLight":true}'` shines the default sky: white, intensity 1, over a
black lower hemisphere. From Node:

```ts
await compile({
  source: 'city.glb',
  cache: 'cache/city',
  resourceBaseUrl: '/assets/city/',
  lightmapBake: { skyLight: { intensity: 1.5, color: [0.7, 0.8, 1] } },
})
```

The sky's radiance — the cube times the colour times the intensity — is held at 0 or more. A sky
whose radiance is zero everywhere shines nothing and adds no layer. A sky of `castShadows: false`
lights the bounces but fills no bent normal: the layer is written only where the sky is shadowed, as
the stationary sky light of the reference's lightmapper writes it. A setting of the wrong kind or out
of its range refuses the job (`INVALID_OPTIONS`).

What the bake does not do, said rather than guessed:

- **The captured sky.** The compile job holds no captured sky, so the sky is a flat one that the job
  names (`skyLight`): a cube of one over the horizon and `lowerHemisphereColor` under it. Without
  `skyLight` the sky gives no light and the file has no bent normal layer; an outdoor scene's
  lightmap then holds the light of its lights and emissive surfaces alone. The sky is a stationary
  light like the others: the engine draws its direct light itself, the lightmap holds what it gives
  after a bounce and its bent normal.
- **The reference's offline lightmapper.** Its brick refinement by lights and by the lighting's error
  (the cell expansions for geometry and lights, the light brightness that subdivides, the least brick
  error) belongs to its offline solver, which the GPU lightmapper this bake follows does not run: the
  GPU lightmapper allocates the bricks around geometry alone, as `bricks` above says, so these have no
  setting here.
- **Lights.** Every light is a stationary one: the engine draws its direct light itself, the lightmap
  holds what the light gives after a bounce. A point or spot is a sphere of its `emitterRadius` (a
  point when it names none; a tube's `emitterLength` is not read), the sun a disk of its
  `angularRadius`.
- **Surfaces.** A blended material, or a masked one whose base-colour factor is under its cutoff, lets
  everything through the bake's rays (the texture's alpha is not read), and a surface's colour and
  emission are its factors times the mean of their textures.
- **The reference's own limits** that the bake does not take: the memory cap and the spherical
  harmonics smoothing of the reference's offline importer (`volumetricLightmapMaximumBrickMemoryMb`,
  `volumetricLightmapSphericalHarmonicSmoothing`) are steps of that importer, which its GPU lightmapper
  does not run, so they have no setting here.
- **A deviation, proved.** Under the irradiance cache a path that ends in a cell takes the cell's
  radiance, which already holds the emission of its surface; the reference adds that emission once
  more, so an emissive surface lights twice as much beside a cache cell. The bake adds it once: in a
  closed room of albedo 0.5 whose walls emit 1, the ambient is 7.09 (`4π · 0.282 · 2`); the bake reads
  7.0 to 7.19 without the cache and 7.06 to 7.13 with it, where the reference's step reads 10.6 with it.

## Cancellation

Write `{"cancel": "*"}` or `{"cancel": "<job id>"}` as one line on stdin: the job stops at its next
step and emits `cancelled`; unstarted batch jobs still run unless `"*"` was sent. Killing the
process is safe too: every file is written under a temporary name and renamed, so the cache holds
the previous or the new result, and a re-run reuses the finished import.

## Events

stderr carries one JSON event per line, stdout the pointer or batch summary at the end, stdin
optional cancel lines; the manifest is never printed. Every event is `{"event", "job", ...}`, `job`
being `"job"` for a single invocation and `"*"` on batch lines. `accepted`, `progress` and
`complete` carry `ratio`, a whole-job estimate from 0 to 1 that never goes backwards
(`build/progress.rs`), and `peakRssBytes`, the process's peak memory so far.

| Event                      | When                                                               | Fields                                                                                               |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `batch`                    | First line of `--jobs`                                             | `jobs`, `workers`                                                                                    |
| `queued`                   | Each batch job, before any work                                    | `source`                                                                                             |
| `accepted`                 | A worker starts the job                                            | `source`, `cache`, `scope`, `triangleBudget`, `threads`, `ramBudgetMb`, `simplification`             |
| `progress` `import-source` | A converting driver writes its scene                               | `step` (`parse`, `meshes`, `write`, `complete`, `reused`), `completed`, `total`                      |
| `progress` `archive`       | A container is extracted, then routed                              | `step` (`extract`, `routed`), `entries`, `bytes`, `chain`                                            |
| `progress` `import`        | Scene loaded and validated                                         | `primitives`, `nodes`, `unsupported` (counts by code), `ms`                                          |
| `progress` `primitive`     | One primitive clustered and paged, in no fixed order               | `mesh`, `primitive`, `pages`, `timings`, `warnings`                                                  |
| `progress` `bootstrap`     | Root bundles assembled                                             | `completed`, `total`                                                                                 |
| `progress` `coplanar`      | Coplanar cuts                                                      | `step`, `completed`, `total`                                                                         |
| `progress` `textures`      | One source image baked                                             | `completed`, `total`                                                                                 |
| `progress` `tables`        | Prepared scene tables written                                      | `counts`, `ms`                                                                                       |
| `progress` `lights`        | `lights.json` written                                              | `lights`, `rejected`, `counts`                                                                       |
| `progress` `reuse`         | A folder under the key kept (`completed: 1`) or refused (`reason`) | `completed`, `files`, `objects`, `textureLevels`, `validateMs`, `reason`                             |
| `progress` `prune`         | Stale keys, imports, objects or texture levels removed             | `removedKeys`, `removedObjects`, `removedBytes`, `removedTextures`                                   |
| `progress` `complete`      | Pointer written                                                    | `pruned`                                                                                             |
| `stall`                    | Success with stalled DAG groups, before `complete`                 | `rank`, `mesh`, `primitive`, `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands` |
| `complete`                 | The job succeeded                                                  | `pointer` (as on stdout), `ms`                                                                       |
| `cancelled`                | The job stopped on a cancel request                                | `code: "CANCELLED"`, `message`, `ms`, catalogue fields                                               |
| `error`                    | The job failed                                                     | `code`, `message`, `ms`, catalogue fields                                                            |
| `done`                     | Last line of `--jobs`                                              | `completed`, `failed`, `cancelled`, `ms`                                                             |

A code the message catalogue knows leaves with its catalogue fields: `id`, the stable public code
(`T3D-Exxx` error, `T3D-Wxxx` warning, `T3D-Ixxx` info), `level`, `cause` and `action`; so do a
`primitive` event's `warnings`. `code` stays the symbolic name the cache writes.

## The pointer

stdout for one job (abridged):

```json
{
  "status": "ready",
  "key": "80004251…dbd7",
  "scope": "full",
  "url": "80004251…dbd7/clusters.json",
  "pointer": "/abs/cache/native/full/manifest.json",
  "formatVersion": 9,
  "selectedTriangles": 1132930,
  "primitives": 412,
  "metrics": { "importMs": 1571.7, "clusterHierarchyPagesMs": 1822.8, "wallMs": 3411.2 },
  "unsupported": ["hard RSS enforcement", "N-API binding"],
  "reused": null
}
```

`pointer` is the file the browser loads; `url` is relative to `native/<scope>/` in the layout of
[FORMAT.md](FORMAT.md#layout). `key` names the product: the same source, linked resources,
compiler build and options give the same key on any machine, any change another
(`cache/identity.rs`). `metrics` are the run's report, never part of the product, and its phase
durations overlap (`support/perf.rs`). `reused` is `null` when the job wrote the folder, the proof's counts
when it kept one. On failure stdout carries `{"status": "error", "code", "message"}` and the code's
catalogue fields.

## Reusing a compiled folder

When a folder already exists under the key, the compiler proves it whole with the compile path's
own checks — every product, object and baked texture level the manifest names — keeps it and skips
to the pointer (`compiler/cache/reuse.rs`). A failed check names its reason on the `reuse` event and the
job compiles again. A recompile of an unchanged source costs the hashing, not a build.

## Temporal anti-aliasing

The temporal anti-aliasing blends each image into a history that follows the surfaces as they
move. A job sets it two ways, both part of its cache key only when named — a job naming none of
the options compiles as before, its key unchanged (`args/materials.rs`,
`materialOptions.ts`).

**The scene's level** — `temporalAntialiasing` (`--temporal-antialiasing=`,
`jobs[].temporalAntialiasing`): `'off'`, `'low'`, `'medium'`, `'high'` or `'max'`, `true` standing
for `'max'` and `false` for `'off'`. The compiler writes it at the top of the manifest; the
runtime takes it as the scene's setting, below the quality preset, the page
(`createWorld(…, { temporalAntialiasing })`, `world.temporalAntialiasing`) and the editor — the
first loaded scene naming one decides. The levels are the anti-aliasing scalability levels 0 to 3
from `low` (`packages/sdk-browser/src/post/taa/levels.ts`): `low` a plus kernel, no spatial
anti-aliaser, no flicker rejection, no resurrection, no reprojection field; `medium` the spatial
anti-aliaser at three samples a side and the history's resurrection; `high` the kernel moving its far
neighbour, the flicker rejection and the reprojection field; `max` eight samples a side and a history
at twice the display's resolution, the default. A display pixel holds 16 samples at most, a pixel of
the 200 % history 4; a still view is held once its history is whole. The quality presets `smooth`,
`balanced`, `fine` write `low`, `medium`, `high`; `max` writes nothing and `cinematic` writes `max`.

**Each material's responsiveness** — how far the temporal anti-aliasing trusts the history on its
pixels: `'off'` (the default: the normal accumulation), `'medium'` or `'full'`. It is meant for
effects whose motion vectors do not follow their detail, small moving features such as sparks; a
surface whose motion vectors are right stays `'off'`.

- `'medium'` reads the material's pixels as a pixel animation: they count as moving for the
  flicker measure, are left out of the thin geometry detection, and the shading rejection reads
  their colour blurred over its 3×3, so their history is rejected more aggressively, small features
  above all. They keep their history.
- `'full'` is the same, and the pixel's history restarts every image, as a disoccluded pixel's
  does, and is never resurrected from an older frame: the current image alone, its edges smoothed by
  the spatial anti-aliaser. Use it for small features only — a large surface at `'full'` shimmers
  with the camera's jitter. The restart rides the resurrection: a level that runs none (`low`), and
  an image with no frame yet to resurrect from, read `'full'` as `'medium'`.

It holds for opaque and blended surfaces alike: a blended or transmissive layer carries its
material's level onto the pixels it marks, a pixel taking the largest of its opaque surface's and
its layers'. A layer marks as the reference's translucent clipped-depth pass does: only a layer of
`translucencyPass: 'beforeDepthOfField'`, blended `normal`, `additive` or `multiply`, only where its
opacity is above 0 and under its material's `opacityMaskClipValue` (0.3333 by default) plus a
255th — the faint pixels the temporal pass would smear — and only in front of the opaque scene; a
layer of the other passes marks none. A GPU particle system names none. The compiler gives each material its level once,
the first source naming it winning:

1. `materials` (`--materials=`, `jobs[].materials`) — `responsive` named for the material by its
   exact name: a level, `true` standing for `'full'` and `false` for `'off'`;
2. `responsive` (`--responsive=`, `jobs[].responsive`) — `'full'` for the materials of every object
   the match takes: a string is the node's exact name, `{ "regex", "flags" }` a regular expression
   on it, an object `{ node, mesh, material, extras }` as an HLOD rule matches (every field named
   must match); a match naming `material` keeps only the materials it names;
3. the material's own glTF `extras`, `"extras": { "responsive": true }` or `{ "responsive":
"medium" }`: a level, `true` or `false` as in 1; any other value is the document's free data: it
   is ignored, with a `RESPONSIVE_EXTRA_IGNORED` warning on the tables' event;
4. `'off'`.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/sparks/',
  temporalAntialiasing: 'high',
  responsive: { material: /^spark/ },
  materials: {
    'spark trail': { responsive: false },
    smoke: { responsive: 'medium' },
    'hud text': { responsive: 'full' },
  },
})
```

The same job from the command line:
`trillion3d-compile --temporal-antialiasing=high '--responsive={"material":{"regex":"^spark"}}' '--materials={"spark trail":{"responsive":false},"smoke":{"responsive":"medium"},"hud text":{"responsive":"full"}}' …`.
The material table (version 6) writes `"responsive": "medium"` or `"full"` on each entry above
`off`, and the runtime's `taa-material-history` view shows the code each pixel carries in grey —
black none, a third a pixel animation, white a pixel animation whose history restarts. A level
that is none of the five, a `responsive` that is none of `'off'`, `'medium'`, `'full'`, `true`,
`false` (in `materials` or in a material's extras), a field `materials` does not hold, a match
naming nothing, or a regular expression that does not compile — or that the compiler would read
otherwise than the host: a flag other than `i`, `m`, `s`, `g`, `u`, `y`, or `i` on a source
holding a letter past ASCII — refuses the job (`INVALID_OPTIONS`); in a batch, that job alone.

## Using it from Node

`trillion3d` on Node relays to the executable
([`packages/sdk-node/src/index.mts`](../packages/sdk-node/src/index.mts)) and reads the manifest
from disk:

```ts
import { prepare, prepareMany, createTerminalProgress } from 'trillion3d'

const progress = createTerminalProgress({ label: 'city' })
const result = await prepare('scenes/city/city.obj', 'cache/city', 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  threads: 8,
  ramBudgetMb: 8192,
  simplification: 'qem-endpoints',
  signal: controller.signal, // abort: a cancel line, then a kill after CANCEL_GRACE_MS
  onProgress: progress.event,
})
const summary = await prepareMany(jobs, { workers: 4, ramBudgetMb: 32768, threads: 4 })
```

`createTerminalProgress` draws one live line on a TTY, one line per phase elsewhere, then tells
each warning code once with its count, worst case, cause and action (`verbose` adds the info codes
and every occurrence); `createBatchProgress` does it per job of `prepareMany`. The
`trillion3d-compile` command wraps `prepare`:

```
trillion3d-compile [--strict] [--verbose] [--hlod=JSON] [--temporal-antialiasing=LEVEL] [--responsive=JSON] [--materials=JSON] SOURCE CACHE [slice|full] [TRIANGLES] RESOURCE_BASE_URL [THREADS] [RAM_MB] [SIMPLIFICATION]
```

It prints the raw JSON events on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them), then the warning
summary as `message` events.

The executable is `options.executable`, else the installed platform package's, else
`TRILLION3D_COMPILER_BIN`, else the checkout's build, refused with `COMPILER_STALE` while a file
its build hashed — the list `--build-inputs` prints, asked once per build — or the physics cook and
message catalogue it reads beside them is newer (`pnpm run build:native`). Elsewhere, a machine no package serves fails with
`COMPILER_PLATFORM_UNSUPPORTED`, a missing package with `COMPILER_EXECUTABLE_MISSING`
(`packages/sdk-node/src/compiler/executable.mts`).

A material keeps the blend mode its source authored — glTF's `alphaMode`, or the value the importer
reads from the source's own material (`OPAQUE`, `MASK` with its cutoff, `BLEND`) —: the compiler
measures no texture's alpha and reclassifies nothing. A foliage material whose source declares it
blended is drawn blended; to draw it masked, declare it `MASK` in the source.

## Using it from any other host

Spawn the executable, read stderr line by line and stdout once at exit, write a cancel line on stdin
when asked: the whole contract, the same on every platform. A Rust host can call
`trillion3d_compiler::compile(&Options, progress)` directly (`main.rs` is a thin layer over it); no
N-API or WebAssembly binding is provided.

## Exit codes and error codes

| Program               | Code | Meaning                                                                                           |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `trillion3d-compiler` | 0    | Every job ready                                                                                   |
| `trillion3d-compiler` | 2    | Usage error, invalid batch, or a job failed or cancelled; stdout carries the error or the summary |
| `trillion3d-compile`  | 1    | Any failure                                                                                       |
| `trillion3d-compile`  | 3    | `--strict` and a warning (`STRICT_WARNINGS`); the cache is written                                |

Every code, of the compiler, its drivers and the Node adapter, has a stable public code, one
sentence, its cause and its action, printed with the message from the catalogue
`packages/sdk-node/src/messages/messages.json`. An error publishes nothing; a warning is always
told and never stops a compile that can succeed; an info is told on request. A refusal inside a
primitive starts with `Mesh <m> primitive <p>: `.

When something fails, read the printed `cause` and `action`: they are the documentation, and no
other page lists the codes. The `unsupported` counts of the pointer name what a driver could not
carry from the source.

## Input formats

The compiler accepts what marketplaces deliver (FAB, Unity Asset Store, Quixel, Sketchfab) without
third-party tools. Fidelity first: no loss added without a measured bound, no lossy format
re-encoded, sources never modified nor written beside. No proprietary format is read without an
established legal reading (this page is not legal advice): each reader is written in this
repository, its dependencies' licenses kept, no editor code or SDK reused, no protection bypassed.
An unknown or ambiguous source is refused with the list of accepted formats.

| Format                                     | Driver                | Reader and condition                                                                       | Dropped, counted by code                                        |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| glTF / GLB                                 | `gltf`                | Khronos standard; Draco and meshopt decoded                                                | Nodes outside the rendered scene; quantized positions refused   |
| FBX                                        | `fbx`                 | MIT ufbx, pinned, never the Autodesk SDK                                                   | Cameras, area lights, procedural textures, UV transforms        |
| OBJ / MTL                                  | `obj`                 | Published specification, through ufbx ([fixture](../tests/fixtures/formats/README.md#obj)) | MTL `Tr`, `illum`, `-o`, `-s`, `-bm`                            |
| USD / USDA / USDC                          | `usd`                 | AOUSD, TOST 1.0; `openusd` crate, pure Rust                                                | Non-punctual lights, animation (one value kept)                 |
| USDZ                                       | `usdz`                | Stored, aligned ZIP container                                                              | As USD                                                          |
| Alembic                                    | `alembic`             | Open, BSD-3; Ogawa reader written here                                                     | All but static geometry                                         |
| `.blend`                                   | `blend`               | Documented SDNA, no GPL imposed; reader written here                                       | All but Blender 2.8–5.x meshes, UVs, instances, Principled BSDF |
| Maya ASCII                                 | `ma`                  | Public MEL command docs; no script executed                                                | Commands outside the read subset                                |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | `unity`               | Documented YAML subset; data only                                                          | Scripts                                                         |
| `.unitypackage`, ZIP                       | `unitypackage`, `zip` | tar.gz and ZIP; each file keeps its license                                                | Encrypted archives refused                                      |
| PNG, JPEG, TGA, TIFF, BMP, GIF             | one each              | Open specifications                                                                        | Animated GIF, BMP masks above 8 bits                            |
| OpenEXR, Radiance HDR                      | `exr`, `hdr`          | BSD-3 `exr` crate; HDR reader written here; held in half-float                             | As a metal-roughness, normal, occlusion or height map           |
| PSD / PSB                                  | `psd`                 | Adobe's published specification                                                            | Layers: the flattened composite only                            |
| DDS, KTX2                                  | `dds`, `ktx2`         | Documented containers; `basisu` Apache-2                                                   | Undeclared codecs, KTX 1.0                                      |
| WebP                                       | `webp`                | Pure Rust `image-webp`, libwebp patent license                                             | Lossy streams, animation                                        |

Not read: `.uasset` / `.umap`, `.max`, `.mb`, native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Export to one of the formats above.

### glTF buffers, primitive modes and required extensions

A `.gltf` buffer is a `data:application/octet-stream;base64,…` (or `application/gltf-buffer`) URI of
exactly its `byteLength`, or a relative path, `%XX`-escaped, in the file's folder or below it
(`buffers/scene.bin`); a path that climbs out of the folder is refused. A triangle strip or fan primitive is
read as the list of triangles it draws; a points or lines primitive draws no surface and is left out, the
rest of the file imported, counted under `primitive-mode-not-imported` in the import report. A file whose
`extensionsRequired` names an extension no reader implements is refused (`UNSUPPORTED_EXTENSION`, naming
them); one that only lists such an extension in `extensionsUsed` is read and counts them under
`extension-not-implemented`. A file whose `asset` names a version below 2.0, or a `minVersion` above 2.0,
is refused (`UNSUPPORTED_VERSION`).

```json
{ "asset": { "version": "2.0" },
  "buffers": [{ "uri": "buffers/scene%20part.bin", "byteLength": 4096 },
              { "uri": "data:application/octet-stream;base64,AAECAw==", "byteLength": 4 }],
  "extensionsRequired": ["KHR_materials_unlit"] }
```

### Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners: a
strictly convex ring becomes a fan, any other is ear-clipped in its own plane so a concave face
keeps its outline, and a ring the ears cannot finish falls back on the fan, counted under
`ngon-untriangulable` (`plugins/scene/ngon.rs`).

### Content Licenses — Independent of Format

Audit a local asset and license manifest offline with `pnpm audit:assets <manifest.json>`
(`scripts/release/asset-license-manifest.ts` holds its shape).

- FAB Standard License: other tools and engines permitted, standalone asset redistribution
  prohibited; keep the purchase EULA.
- Quixel Megascans under a single-engine plan: unusable in Trillion3D.
- Unity Asset Store: other engines permitted, not a product whose purpose is raw asset distribution.
- Sketchfab: per-download license (CC-BY requires attribution and a change notice).
- Demos and public repository tests: assets owned outright or under a redistributable license.

## Adding a format

A format is a driver module and a registry line under `packages/asset-compiler-rust/src/plugins/`;
core and command line name no format. [Input formats](#input-formats) says which formats are
admitted and on what condition; a driver outside it is not merged.

- A scene driver, `plugins/scene/<format>.rs`, is named after the format, never its library, is
  listed in `scene::PLUGINS` and produces the intermediate glTF scene under the cache, never beside
  the source; the contract is `plugins/scene.rs`, a container's `plugins/scene/archive.rs`.
- An image driver, `plugins/image/<format>.rs`, is listed in `image::DECODERS` and decodes to RGBA8,
  or float for high dynamic range, under the ceiling it receives; its contract is
  `plugins/image.rs`.
- It comes with the smallest owned or redistributable fixture under
  [`tests/fixtures/formats/`](../tests/fixtures/formats/README.md), compiled by the shared harness
  (`src/tests/golden.rs`), one test per behaviour, and its library's license in `Cargo.toml` and
  `THIRD_PARTY_NOTICES.md`.

## Internals

The code is the contract: each module's head states its rules and their reasons. Paths are under
`packages/asset-compiler-rust/src/`.

| Stage                  | What it does                                                                                                                                                                                                         | Module                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import                 | Routes each source to its driver; converting drivers write the intermediate glTF under `native/imports/`                                                                                                             | `plugins.rs`, `plugins/scene/convert.rs`                                                                                                                       |
| Scene loading          | Decodes transport compression, keeps the rendered scene's nodes, expands GPU instancing                                                                                                                              | `compiler/source.rs`, `load/compressed.rs`, `source/nodes.rs`, `source/instancing.rs`                                                                          |
| Admission              | Refuses a job above its budget, cuts primitives and images into waves that fit                                                                                                                                       | `compiler/plan.rs`, `compiler/budget.rs`                                                                                                                       |
| Simplification and DAG | Level 0 clusters, then groups simplified with borders locked and re-split, each measured and diagnosed; clusters laid in strips ([How a mesh coarsens](#how-a-mesh-coarsens))                                        | `dag.rs`, `dag/`, `src/simplify.rs`, `simplify/region.rs`, `page-codec-wasm/src/partition.rs`, `page-codec-wasm/src/clusters.rs`; corpus `src/tests/corpus.rs` |
| Pages                  | Quantized cluster pages written as delta streams in byte planes ([FORMAT.md](FORMAT.md#pages)), streaming bundles filled by the bytes their pages take in the pool, with closed dependency lists, the paged manifest | `page-codec-wasm/src/encode.rs`, `page-codec-wasm/src/disk.rs`, `pages/dependencies.rs`, `pages/manifest.rs`                                                   |
| Deformation            | Joints, weights, morph targets and soft-body ids carried into the pages with their bounds                                                                                                                            | `page-codec-wasm/src/encode/deformation.rs`, `geometry_page/deform.rs`                                                                                         |
| Coplanar cuts          | One order for surfaces sharing a plane                                                                                                                                                                               | `coplanar.rs`                                                                                                                                                  |
| Textures               | Every mip level, in the stored BC family and the gated ones, keyed by the image's SHA-256                                                                                                                            | `materials/textures.rs`, `src/texture.rs`                                                                                                                      |
| Scene tables           | The node graph, cameras and surfaces the runtime builds its scene from                                                                                                                                               | `compiler/tables.rs`                                                                                                                                           |
| Physics cook           | Colliders, rigid and soft bodies cooked by native Jolt                                                                                                                                                               | `physics_cook.rs`                                                                                                                                              |
| Lights                 | The source's lamps in the engine's contract                                                                                                                                                                          | `compiler/lights.rs`                                                                                                                                           |
| World HLOD             | HLOD 1 to 3: per HLOD cell, its original objects as a textured shell, merged or voxelized, in a DAG                                                                                                                  | `hlod/chain.rs`                                                                                                                                                |
| Identity and reuse     | The cache key; the proof of an existing folder                                                                                                                                                                       | `cache/identity.rs`, `compiler/cache/reuse.rs`                                                                                                                 |
| Publication            | Atomic writes, pointer, prune, cache lock                                                                                                                                                                            | `cache/storage.rs`, `cache/publish.rs`, `cache/prune.rs`, `compiler/cache/lock.rs`                                                                             |

Every platform cooks the same bytes; the root `.cargo/config.toml` and `build.rs` say how.

### `volumetric-lightmap.bin` — the baked indirect light (stage `volumetric-lightmap`)

Written only for a job that names `lightmapBake`, from the scene's geometry and `lights.json`; the
layout is [FORMAT.md](FORMAT.md#volumetric-lightmapbin), the algorithm [Volumetric lightmap](#volumetric-lightmap).

### `lights.json` — the lamps of the source file

The source's lamps in world space and the engine's `SceneLight` contract, fields in
[FORMAT.md](FORMAT.md#lightsjson). A point or spot lamp's `emitterRadius` is the radius the source
declares in the light's `extras.emitterRadius`, and none otherwise (`lights/emitter.rs`). A directional light's `extras.shadowDistance` (glTF `KHR_lights_punctual`) is
the sun's shadow distance in metres, a number of at least 0, `false` for none (0), `true` the default;
it is carried into the light of `lights.json` as `shadowDistance`. A value that is none of these is
counted under `light-shadow-distance-invalid` (warning T3D-W219) and left out, the light kept. A light
that is no sun carries none. A spot's `innerConeAngle` and `outerConeAngle` are carried as the file writes
them (glTF: 0 and π/4 where it names none), and a point or a spot's intensity names its unit,
`candelas`.

### `physics.json` — the cooked colliders (stage `physics-cook`)

The browser builds no tree, hull or mass: a primitive's collider is a DAG cut within the object's
own tolerance, tiled on the culling hierarchy, beside height fields, declared matter, rigid bodies
and breakable pieces (`physics_cook.rs`). Fields:
[FORMAT.md](FORMAT.md#physicsjson--cooked-colliders).

### Soft bodies a model declares

A node whose `extras.physics` holds `obj.physics`'s soft-body options is cooked as a cloth, rope or
volume rather than static ground, its simulated vertices made as the page makes them, and its drawn
vertices follow the simulation (`physics_cook/soft.rs`, `deform/soft.rs`).

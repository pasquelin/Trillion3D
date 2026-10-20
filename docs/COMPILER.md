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
workflow builds the five (`scripts/compiler-dist.ts`) and checks that they write the same cache
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
`--temporal-antialiasing=`, `--responsive=` and `--materials=` anywhere, the last of each kept
(`compiler_args.rs`); a JSON flag that is not JSON is refused (`INVALID_OPTIONS`):
the fields of one job, named as a batch job names them and in the order `JOB_FIELDS` declares
(`packages/sdk-core/src/contracts/compilerAbi.ts`, printed into the compiler's `shared_math/abi.rs`).
Both forms are read by one reader. Another count prints the usage, emits `INVALID_ARGS` and exits 2;
a value out of range is refused with `INVALID_OPTIONS`, naming the field (`compiler_validate.rs`).
`--version` prints the compiler and format versions, the drivers and the platform as JSON. `--build-inputs` prints the files its build hashed
into the implementation hash, one path per line from the crate (`build_inputs.rs`): the production
sources of the compiler and of the crates it links, their manifests, the lock file, the build
scripts and the cargo configuration.

| Argument             | Meaning                                                                                                                                                                 | Default                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `source`             | A folder with `manifest.json`, a `.gltf`/`.glb`, a scene or container of [Input formats](#input-formats), or a folder of such files merged into one scene               | required                                      |
| `cache`              | Output folder, created if missing; one pointer per scope, pruned after each compile, so one source per cache                                                            | required                                      |
| `scope`              | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything                                                                                   | required                                      |
| `triangleBudget`     | Positive triangle budget of `slice`; ignored by `full`                                                                                                                  | required                                      |
| `threads`            | Worker threads of the job, 1–64                                                                                                                                         | auto (every core; cores / workers in a batch) |
| `ramBudgetMb`        | Admission budget, at least 64: a job estimated above it is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`); a guard, not a process limit                                      | `4096`                                        |
| `resourceBaseUrl`    | URL prefix under which the host serves the source folder; relative image URIs are rewritten against it                                                                  | required                                      |
| `simplification`     | `qem-endpoints`: the coarser levels above the exact clusters; `none`: exact clusters alone, every one a root, every triangle drawn at any distance                      | `qem-endpoints`                               |
| `--textures-format=` | `all`, `bc7`, `astc` or `etc2`: the GPU block families cooked beside the stored BC levels, kept only where they pass the quality gate ([FORMAT.md](FORMAT.md#textures)) | `bc7`                                         |
| `--hlod=`            | The HLOD layers and the rules assigning objects to them, as JSON in the expert form ([HLOD](#hlod))                                                                     | none                                           |
| `--temporal-antialiasing=` | The scene's temporal anti-aliasing level, `off`, `low`, `medium`, `high` or `max`, or `true` / `false`, written in its manifest ([Temporal anti-aliasing](#temporal-anti-aliasing)) | none |
| `--responsive=`      | The objects whose materials keep a responsive temporal history (a history share of 0.75), as JSON: a node's exact name, `{ "regex", "flags" }` on it, or a match ([Temporal anti-aliasing](#temporal-anti-aliasing)) | none |
| `--materials=`       | Settings by exact material name, as JSON, `{ "name": { "temporalAntialiasing": 0.5, "responsive": true } }` ([Temporal anti-aliasing](#temporal-anti-aliasing))                                   | none |

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

Jobs go in file order to the first free worker. Two jobs writing one cache, under any spelling, or
a job asking for more than the whole budget, refuse the batch before it starts (`INVALID_BATCH`).
stdout then carries the summary, `{"status": "ready" | "partial" | "failed", "completed", "failed",
"cancelled", "jobs"}`, each job a pointer or an error, sorted by id; read it rather than the exit
code.

## HLOD

A job builds an HLOD only when it names one, and only over the objects it assigns a layer. Each
layer names the layer its cells' actors are built by (`parent`), and an object follows its layer's
chain of parents, one actor per layer and cell, each level on a grid of `256 × 2 << level` metres.
Two chains — trees and buildings — build distinct actors over the same ground.

An object is assigned once, before any work, to one layer at most: the mark its glTF node carries
— `"extras": { "hlod": "buildings" }`, a group of the simple form or a layer of the expert form,
by name, written where the code that makes the object writes it —, else the first group or rule
by name that matches it, else the expert form's `default`. An object none names has no HLOD: it is
streamed and drawn in its cell as any other, and nothing stands for it beyond its cell's range; it
costs the HLOD nothing. Where a mark and a rule name different layers, the mark wins and the
compile report tells it (`worldRoots.assignmentWarnings`). A mark naming no group nor layer, a mark
in a job naming no HLOD, and an HLOD assigning no placed object a layer refuse the job.

From Node, `prepare(..., { hlod })` takes either form; one function, `resolveHlod`
(`packages/sdk-core/src/contracts/hlodOptions.ts`), turns it into the expert form the compiler
reads (`--hlod=`, `jobs[].hlod`): a string is an exact name, a regular expression is written
`{ "regex": source, "flags": "i" }` — the form the Node command line's `--hlod=` takes in either
form's JSON, for instance
`trillion3d-compile '--hlod={"levels":4,"groups":{"foliage":{"mesh":{"regex":"tree"}}}}' …`. It
refuses, in the words written, a field either form does not hold, an unknown quality or group,
`levels` that is not a whole number from 2 to 8, and the simple form's fields beside `layers`.

The simple form, for most uses; with marks on the objects, `{ levels, quality }` alone:

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/city/',
  hlod: { levels: 3, quality: 'high', groups: { foliage: /^(Tree|Bush)/i, props: { mesh: /^(Lamp|Bench)/ } } },
})
```

| Field     | Meaning                                                                                                                                                                                                             | Default      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `levels`  | The main chain's levels, HLOD 0 included, 2 to 8                                                                                                                                                                    | `4`          |
| `quality` | `low`: deviation 2 px, 512-texel atlas; `balanced`: 1 px, 1024 texels (the automatic rule); `high`: 0.5 px, 2048 texels — every approximated layer, the pixel taken at the distance its actors are first seen from | `balanced`   |
| `groups`  | The objects of each group by name, for those no mark names: `buildings`, the main chain; `foliage`, a chain of two levels, voxel half the rule's, to keep the silhouette; `props`, their own instanced cells absorbed by the main chain's first approximated layer. Each the node's exact name (a string), a regular expression on it, or `{ node, mesh, material, extras }`; the first group in key order that matches an object takes it | none         |

The expert form, every layer setting:

```ts
hlod: {
  layers: [
    { name: 'buildings', builder: 'instanced', parent: 'city1' },
    { name: 'city1', builder: 'approximate', parent: 'city2', deviationPixels: 1 },
    { name: 'city2', builder: 'approximate', textureSize: 2048 },
    { name: 'trees', builder: 'instanced', parent: 'canopy' },
    { name: 'canopy', builder: 'approximate', accuracyPixels: 0.3 },
  ],
  assign: [{ match: { node: /^Tree/, extras: { kind: 'tree' } }, layer: 'trees' }],
  default: 'buildings',
}
```

| Field                                                | Meaning                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layers[].name`                                      | Unique name                                                                                                                                                                                       |
| `layers[].builder`                                   | `instanced` (the objects themselves; a layer objects are assigned to), `approximate` (one closed shell per cell, its materials baked), `merge` (the cell's objects merged into one mesh), `proxy` (the cell's objects remeshed) |
| `layers[].parent`                                    | The layer its cells' actors are built by; none at a chain's top, whose actors are always loaded                                                                                                  |
| `layers[].accuracy`, `accuracyPixels`                | An `approximate` or `proxy` layer's voxel, metres or pixels at the distance the layer is first seen from, one or the other; default 0.65 px, never finer than the grid the solid is sampled on   |
| `layers[].deviation`, `deviationPixels`              | An `approximate` or `merge` layer's deviation, metres or pixels, one or the other: what an approximated shell is simplified within, the LOD a merged layer takes of each source (never simplified after the merge); default 1 px |
| `layers[].textureSize`                               | The atlas side of an `approximate` or `proxy` layer, or of a `merge` layer merging its materials, a power of two from 16 to 8192; default 1024                                                    |
| `layers[].lodSelection`                              | A `merge` layer's LOD of each source: `calculate`, the coarsest its deviation holds, or `lowest`, its coarsest; default `calculate`                                                              |
| `layers[].mergeMaterials`                            | Whether a `merge` layer merges its sources' materials into one atlas; default `false`, each section wearing its source's material                                                                 |
| `assign[].match`                                     | `node`, `mesh`, `material` (one of the mesh's), each the exact name or a regular expression, and `extras`, values the node's `extras` holds; every field named must match, at least one          |
| `assign[].layer`                                     | An `instanced` layer; the first rule that matches wins                                                                                                                                            |
| `default`                                            | The `instanced` layer of an object no mark nor rule names; none by default: such an object has no HLOD                                                                                           |

The compiler refuses the job (`INVALID_OPTIONS`, never the whole batch) for a field a layer's
builder does not take, a name given twice, a parent or a rule naming no layer, a cycle, an
instanced layer as a parent or without a parent, a layer reached at two levels or from no
instanced layer, a chain past 8 levels, a rule, mark or default naming a layer that is not
instanced, a match naming nothing, a regular expression that does not compile, a setting given
both in metres and in pixels, `textureSize` on a `merge` layer that keeps its materials, and values
out of bounds. The HLOD is part of the cache key.

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
(`compiler_ratio.rs`), and `peakRssBytes`, the process's peak memory so far.

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
| `progress` `cutouts`       | Cutout answer sheet written                                        | `pending`, `sheet`                                                                                   |
| `progress` `tables`        | Prepared scene tables written                                      | `counts`, `ms`                                                                                       |
| `progress` `proxy`         | Resident lighting proxy built                                      | `triangles`, `nodes`, `errorMetres`                                                                  |
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
(`compiler_identity.rs`). `metrics` are the run's report, never part of the product, and its phase
durations overlap (`perf.rs`). `reused` is `null` when the job wrote the folder, the proof's counts
when it kept one. On failure stdout carries `{"status": "error", "code", "message"}` and the code's
catalogue fields.

## Reusing a compiled folder

When a folder already exists under the key, the compiler proves it whole with the compile path's
own checks — every product, object and baked texture level the manifest names — keeps it and skips
to the pointer (`compiler_reuse.rs`). A failed check names its reason on the `reuse` event and the
job compiles again. A recompile of an unchanged source costs the hashing, not a build.

## Temporal anti-aliasing

The temporal anti-aliasing blends each image into a history that follows the surfaces as they
move. A job sets it two ways, both part of its cache key only when named — a job naming none of
the options compiles as before, its key unchanged (`compiler_args/materials.rs`,
`materialOptions.ts`).

**The scene's level** — `temporalAntialiasing` (`--temporal-antialiasing=`,
`jobs[].temporalAntialiasing`): `'off'`, `'low'`, `'medium'`, `'high'` or `'max'`, `true` standing
for `'max'` and `false` for `'off'`. The compiler writes it at the top of the manifest; the
runtime takes it as the scene's setting, below the quality preset, the page
(`createWorld(…, { temporalAntialiasing })`, `world.temporalAntialiasing`) and the editor — the
first loaded scene naming one decides. The levels are the anti-aliasing scalability levels 0 to 3
from `low` (`packages/sdk-browser/src/taa/levels.ts`): `low` a plus kernel, no spatial
anti-aliaser, no flicker rejection; `medium` the spatial anti-aliaser at three samples a side;
`high` the kernel moving its far neighbour and the flicker rejection; `max` eight samples a side,
the engine's image before the levels existed and its default. The quality presets `smooth`,
`balanced`, `fine` write `low`, `medium`, `high`; `max` writes nothing.

**Each material's history share** — the most of its history the temporal anti-aliasing keeps on
its pixels: a number from 0 to 1, or a name — `'normal'` (1, the default blend), `'responsive'`
(0.75: the current image weighs at least a quarter, so a spark's history catches up within a few
images), `'soft'` (0.5), `'off'` (0: the current filtered image alone, no trail, the camera's jitter
left visible as a slight shimmer). It is meant for effects whose motion the history cannot follow;
a surface whose motion vectors are right keeps 1. The compiler gives each material its share once,
the first source naming it winning:

1. `materials` (`--materials=`, `jobs[].materials`) — `temporalAntialiasing` named for the material
   by its exact name;
2. `materials` — its `responsive`: `true` the share 0.75; `false` takes the material out of the
   two responsive shortcuts below;
3. `responsive` (`--responsive=`, `jobs[].responsive`) — 0.75 for the materials of every object the
   match takes: a string is the node's exact name, `{ "regex", "flags" }` a regular expression on
   it, an object `{ node, mesh, material, extras }` as an HLOD rule matches (every field named
   must match); a match naming `material` keeps only the materials it names;
4. the material's own glTF `extras`, `"extras": { "temporalAntialiasing": 0.5 }` (a number or a
   name);
5. the material's own glTF `extras`, `"extras": { "responsive": true }`: 0.75;
6. 1.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/sparks/',
  temporalAntialiasing: 'high',
  responsive: { material: /^spark/ },
  materials: {
    'spark trail': { responsive: false },
    smoke: { temporalAntialiasing: 'soft' },
    'hud text': { temporalAntialiasing: 0 },
  },
})
```

The same job from the command line:
`trillion3d-compile --temporal-antialiasing=high '--responsive={"material":{"regex":"^spark"}}' '--materials={"spark trail":{"responsive":false},"smoke":{"temporalAntialiasing":"soft"},"hud text":{"temporalAntialiasing":0}}' …`.
The material table writes `"temporalAntialiasing": <share>` on each entry below 1, and the
runtime's `taa-material-history` view shows each pixel's share in grey, white 1 and black 0. A
level that is none of the five, a share outside [0, 1] or naming none of `normal`, `responsive`,
`soft`, `off` (in `materials` or in a material's extras), a field `materials` does not hold, a
`responsive` that is not a boolean, a match naming nothing, or a regular expression that does not
compile — or that the compiler would read otherwise than the host: a flag other than `i`, `m`,
`s`, `g`, `u`, `y`, or `i` on a source holding a letter past ASCII — refuses the job
(`INVALID_OPTIONS`); in a batch, that job alone.

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

Sources often declare foliage blended when it is a cutout. The compiler never decides alone: each
compile writes the answer sheet `decoupes.json` at the cache root, one entry per candidate texture
with its measure and proposal, and applies only the entries answered `true`. `reviewCutouts` asks
a terminal user one keypress per texture and recompiles the models an answer changes; an
application can show its own panel from the `cutouts` event.

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
| OpenEXR, Radiance HDR                      | `exr`, `hdr`          | BSD-3 `exr` crate; HDR reader written here                                                 | —                                                               |
| PSD / PSB                                  | `psd`                 | Adobe's published specification                                                            | Layers: the flattened composite only                            |
| DDS, KTX2                                  | `dds`, `ktx2`         | Documented containers; `basisu` Apache-2                                                   | Undeclared codecs, KTX 1.0                                      |
| WebP                                       | `webp`                | Pure Rust `image-webp`, libwebp patent license                                             | Lossy streams, animation                                        |

Not read: `.uasset` / `.umap`, `.max`, `.mb`, native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Export to one of the formats above.

### Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners: a
strictly convex ring becomes a fan, any other is ear-clipped in its own plane so a concave face
keeps its outline, and a ring the ears cannot finish falls back on the fan, counted under
`ngon-untriangulable` (`plugins/scene/ngon.rs`).

### Content Licenses — Independent of Format

Audit a local asset and license manifest offline with `pnpm audit:assets <manifest.json>`
(`scripts/asset-license-manifest.ts` holds its shape).

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

| Stage                  | What it does                                                                                             | Module                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Import                 | Routes each source to its driver; converting drivers write the intermediate glTF under `native/imports/` | `plugins.rs`, `import.rs`                                                                        |
| Scene loading          | Decodes transport compression, keeps the rendered scene's nodes, expands GPU instancing                  | `compiler_source.rs`, `compressed/mod.rs`, `compiler_nodes.rs`, `compiler_instancing.rs`         |
| Admission              | Refuses a job above its budget, cuts primitives and images into waves that fit                           | `compiler_plan.rs`, `compiler_budget.rs`                                                         |
| Simplification and DAG | Level 0 clusters, then groups simplified with borders locked and re-split, each measured and diagnosed   | `dag.rs`, `dag/`, `qem.rs`, `qem_solve.rs`; corpus `tests/corpus/mod.rs`                         |
| Pages                  | Quantized cluster pages, streaming bundles with closed dependency lists, the paged manifest              | `page-codec-wasm/src/encode.rs`, `compiler_bundle_dependencies.rs`, `compiler_manifest_pages.rs` |
| Deformation            | Joints, weights, morph targets and soft-body ids carried into the pages with their bounds                | `page-codec-wasm/src/encode/deformation.rs`, `geometry_page_deform.rs`                           |
| Coplanar cuts          | One order for surfaces sharing a plane                                                                   | `coplanar.rs`                                                                                    |
| Textures               | Every mip level, in the stored BC family and the gated ones, keyed by the image's SHA-256                | `compiler_textures.rs`, `texture_preview.rs`                                                     |
| Cutouts                | Alpha measured during the texture decode; only answered entries applied                                  | `cutout.rs`                                                                                      |
| Scene tables           | The node graph, cameras and surfaces the runtime builds its scene from                                   | `compiler_tables.rs`                                                                             |
| Proxy                  | The resident lighting proxy                                                                              | `proxy.rs`                                                                                       |
| Physics cook           | Colliders, rigid and soft bodies cooked by native Jolt                                                   | `physics_cook.rs`                                                                                |
| Lights                 | The source's lamps in the engine's contract                                                              | `compiler_lights.rs`                                                                             |
| World HLOD             | HLOD 1 to 3: per HLOD cell, the layer below approximated as a textured shell in its own DAG              | `compiler_world_roots.rs`                                                                        |
| Identity and reuse     | The cache key; the proof of an existing folder                                                           | `compiler_identity.rs`, `compiler_reuse.rs`                                                      |
| Publication            | Atomic writes, pointer, prune, cache lock                                                                | `compiler_storage.rs`, `compiler_publish.rs`, `compiler_prune.rs`, `compiler_lock.rs`            |

Every platform cooks the same bytes; the root `.cargo/config.toml` and `build.rs` say how.

### `lights.json` — the lamps of the source file

The source's lamps in world space and the engine's `SceneLight` contract, fields in
[FORMAT.md](FORMAT.md#lightsjson). A point or spot lamp's `emitterRadius` is the radius the source
declares, else the one measured on the emissive body its parent or a sibling draws
(`compiler_lights/emitter.rs`).

### `physics.json` — the cooked colliders (stage `physics-cook`)

The browser builds no tree, hull or mass: a primitive's collider is a DAG cut within the object's
own tolerance, tiled on the culling hierarchy, beside height fields, declared matter, rigid bodies
and breakable pieces (`physics_cook.rs`). Fields:
[FORMAT.md](FORMAT.md#physicsjson--cooked-colliders).

### Soft bodies a model declares

A node whose `extras.physics` holds `obj.physics`'s soft-body options is cooked as a cloth, rope or
volume rather than static ground, its simulated vertices made as the page makes them, and its drawn
vertices follow the simulation (`physics_cook/soft.rs`, `geometry_page_deform/soft.rs`).

# The native compiler — `trillion3d-compiler`

One executable does all the preparation: it reads a source model through one driver per format —
glTF/GLB, FBX, OBJ, USD/USDZ, Alembic, `.blend`, Maya ASCII, Unity scenes and packages, ZIP, and a
dozen image formats ([Input formats](#input-formats)) — builds the cluster hierarchy and writes the
cache described in [FORMAT.md](FORMAT.md). A host — the Node adapter, an Electron app, a shell
script — only launches it, passes paths and options, and listens. Every driver is compiled in; no
external application is needed.

Source: [`packages/asset-compiler-rust`](../packages/asset-compiler-rust) (`lib.rs` compiles,
`import.rs` imports, `main.rs` is the command line). Build with `pnpm run build:native`; the binary
lands in `packages/asset-compiler-rust/target/release/trillion3d-compiler` (`.exe` on Windows).

## Contents

[Invocation](#invocation) · [Simplification and DAG](#simplification-and-dag) · [glTF scene
selection](#gltf-scene-selection) · [The three streams](#the-three-streams) · [Events](#events) ·
[The pointer](#the-pointer) · [Reusing a compiled folder](#reusing-a-compiled-folder) ·
[Measurements](#measurements) · [Batch mode](#batch-mode) · [Cancellation](#cancellation) · [FBX and
OBJ import](#fbx-and-obj-import) · [USD and USDZ import](#usd-and-usdz-import) · [Input
formats](#input-formats) · [Adding a format](#adding-a-format) · [Cache layout](#cache-layout) ·
[Cutouts declared as blend](#cutouts-declared-as-blend) · [Memory and threads](#memory-and-threads)
· [Exit codes and error codes](#exit-codes-and-error-codes) · [Using it from
Node](#using-it-from-node) · [Using it from any other host](#using-it-from-any-other-host) ·
[Deformation streams](#deformation-streams)

## Invocation

```
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES RESOURCE_BASE_URL
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES THREADS RAM_MB RESOURCE_BASE_URL
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES THREADS RAM_MB RESOURCE_BASE_URL none|qem-endpoints
trillion3d-compiler --jobs FILE|-
trillion3d-compiler --version
```

The command takes exactly 5, 7 or 8 positional arguments (`compiler_args.rs`), plus
`--textures-format=` anywhere; any other count prints the usage, emits `INVALID_ARGS` and exits 2.
Scope and triangles are always written; the short forms default only threads, `RAM_MB` and
simplification. Out-of-range values are refused with `INVALID_OPTIONS` (`compiler_validate.rs`).

- `SOURCE` (required): a file or folder a driver recognises — a directory with `manifest.json`, a
  `.gltf`/`.glb`, a scene of one of the formats above, a container (`.usdz`, `.unitypackage`,
  `.zip`), or a directory of such files, merged into one scene. Unknown or ambiguous: refused with
  the list of accepted formats.
- `CACHE` (required): output directory, created if missing; one pointer per scope, pruned after each
  compile ([The pointer](#the-pointer)), so one source at a time. A busy cache is waited for, then
  refused (`CACHE_LOCKED`).
- scope (required): `slice` keeps whole mesh instances up to the triangle budget; `full` keeps
  everything.
- `TRIANGLES` (required, positive): triangle budget for `slice`; ignored by `full`.
- `THREADS` (default `2`): worker threads for clustering and simplification, 1–64.
- `RAM_MB` (default `256`, at least 64): admission budget — a job whose estimated working set
  exceeds it is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`); a guard, not an enforced limit. Under 64
  the options are refused (`INVALID_OPTIONS`).
- `RESOURCE_BASE_URL` (required): URL prefix under which the host serves the **source** directory;
  relative image URIs are rewritten against it.
- simplification (default `none`): `none` builds exact clusters only, one DAG level, every cluster a
  root; `qem-endpoints` adds the coarser levels above them ([Simplification and
  DAG](#simplification-and-dag)).
- `--textures-format=bc7|astc|both|none` (default `bc7`): the block family cooked beside the
  lossless levels (`none`: lossless only), under the quality gate of
  [FORMAT.md](FORMAT.md#textures). Block rows encode in parallel on the job's pool; an existing
  level file is not encoded again, so a recompile pays only the missing ones.

Examples:

```sh
trillion3d-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
trillion3d-compiler scenes/london cache/london full 150000 8 8192 /assets/london/ qem-endpoints   # a folder of FBX files
trillion3d-compiler scenes/emerald cache/emerald full 150000 8 32768 /assets/emerald/ qem-endpoints # a glTF folder with manifest.json
```

The glTF reader decodes `KHR_draco_mesh_compression` and `EXT_meshopt_compression` once, before the
accessor pipeline, under the job's RAM budget (`src/compressed/`). Quantized positions
(`KHR_mesh_quantization`) are not read: `POSITION` must be float `VEC3` (`INVALID_GLTF`).

## Simplification and DAG

`simplification` says what the DAG may hold, not how fast it is built. In `none` it stops at level
0: the clusters partition the source triangles exactly, every one a root, and `"simplification":
false` in the manifest means no cluster carries a surface the source lacks. In `qem-endpoints` each
level groups 8 to 32 clusters, has the linked `meshopt` simplifier (its quadric error metric)
simplify the group with its border locked, then re-splits it; level 0 is the same in both modes.

The compiler does not implement the quadric error metric: it hands the simplifier a region, the
vertex flags and the attribute weights (`qem.rs`), and the library ranks the collapses and returns
the error it measured. The error is absolute, counting normals (weight ½) and carried texture sets
(weight 1) against positions normalised to the group's extent, clamped to it; permissive across hard
edges, texture seams protected; disconnected parts pruned once the error passes them. Copies a page
cannot tell apart (same position and carried attributes) become one vertex, the group's first copy,
before reduction, so a coarse page names only vertices its children draw; no other weld remains. A
part removed whole (a column, an arch) costs the diameter of its bounds plus its distance to the
surface kept, so it drops only at a level whose error is that wide, and a roof of shingles each
under the error keeps a cover within it. A coarse corner takes the copy of its position and texture
coordinates whose normal is its face's, among those a face turned its way draws. A reduction
shading a face from behind, or leaving a corner no such copy, is retried with that face's
surroundings locked while a retry locks something new; one losing a vertex shared with another
group is retried, three times at most, without pruning (which ignores locks).

A stalled group diagnosed `seam-locked` (below) is retried with solved vertices (the simplifier's
`simplifyWithUpdate`; `dag/solved.rs`, `qem_solve.rs`): the library accumulates each quadric and
moves the vertices, this crate chooses the groups, the locks and the weights and measures the error
of the result. Other groups keep the endpoint reduction. The retry keeps the level's locks; any seam
corner may collapse with all its copies; each surviving position moves to its quadric's minimum and
each copy gets its own texture coordinate and normal solved there (renormalised). A texture set
weighs the surface length one unit of it spans in the group — the square root of surface area over
texture area —, so a sliding coordinate costs the distance its texture moves; normals keep their
weight. On the open border, where the simplifier keeps seam corners in place, a position's copies
point at one of them, and the largest coordinate step that costs, times its set's density, joins
the group's error. A placed vertex belongs to the texture island of the source vertex it was solved
from; a coarse face whose corners lie in two islands is charged its longest edge, so it is drawn
only where it covers under a pixel. The retry runs the endpoint reduction's checks and retries
(`dag/retries.rs`) and is kept when it yields fewer clusters. Its error is measured as every
reduction's (`dag/measured.rs`): parts removed whole, sampled Hausdorff distance and texture
deviation from the group's triangles to the solve's, so a solved group never publishes less than
the surface it draws. Its vertices are appended after the primitive's (indices from the source's
vertex count on), read by pages, the cook's checks, the collider and the proxy; `source.bin` stays
the source buffer.

A stalled group is named by experiment, never by threshold: the builder reruns the stalled
reduction with one constraint lifted at a time, discards the result and keeps the first cause that
holds:

- `too-small`: fewer than two live triangles, nothing to halve.
- `border-locked`: advances when rerun with no lock; positions shared with neighbouring groups hold
  it.
- `seam-locked`: still stalls with no lock, and advances with its position copies welded across the
  seams of every carried texture set; retried with solved vertices, it stays stalled only if that
  retry does not advance either.
- `unreducible`: advances under neither rerun; the surface itself resists halving.
- `border-lost`: lost a shared position on every retry with added locks.
- `unusable-error`: received a non-finite error from the simplifier.

Before publishing, the cook refuses a DAG (`DAG_ERROR_NOT_MONOTONE`, `DAG_NORMAL_DEVIATION`) where a
cluster's error exceeds its parent's, or a coarse cluster's normal deviation passes its group's
bound. A triangle's normal deviation is the angle between its face normal and the mean of its corner
normals; triangles no wider than their level's error, and slivers thinner than a thousandth of their
longest edge, are exempt. A group's bound is 90° or, if larger, the worst deviation among the
level-0 triangles it descends from, so one inverted source triangle raises only its own groups'
bound. The reduction holds each group to that bound without the width exemption, so a long thin
coarse face never comes out inside out. The report publishes per level `errorMax`,
`normalDeviationMax` and `rootTriangles`, what the level adds to the root cover no budget goes
under.

The cook is the same bytes on every platform: the root `.cargo/config.toml` builds the simplifier's
C++ with `-ffp-contract=off` (arm64 otherwise fuses multiply-adds), the arc cosine is the `libm`
crate's, and a test pins a cooked fixture's digest.

Pages are packed into streaming bundles as [FORMAT.md](FORMAT.md#cluster-dag) describes (`streams`,
`PAGE_DEPENDENCY_BOUND`). The cook refuses (`INVALID_PAGE_DEPENDENCIES`) a cycle, a page whose
parents' bundle is missing from its bundle's list, a list not closed or not reaching the root
cover, and a pinned bundle with any dependency; the message names the mesh and primitive, then the
page or bundle.

The DAG builder is proved on a generated [corpus](../packages/asset-compiler-rust/src/tests/corpus/)
(`packages/asset-compiler-rust/src/tests/corpus/`): each case's shape, texture layout and
parameters are drawn from a seed, in five families (`uv`, `attributes`, `topology`, `materials`,
`inputs`), each case on two seeds; the invariants it asserts are in `invariants.rs`. Run it with
`cargo test --release corpus --manifest-path packages/asset-compiler-rust/Cargo.toml`.

## glTF scene selection

A glTF document renders one scene (glTF 2.0 §3.5): the one `scene` names, else the first of
`scenes`. Only nodes reachable from its roots are compiled — node selection, the resident proxy and
`lights.json` read that set, so a mesh or `KHR_lights_punctual` lamp in another scene, or none, is
left out. A document with no (or empty) `scenes` compiles every root of the node hierarchy, and
`selectedNodes` counts the nodes kept. A `scene`, `scenes[].nodes` or `children` index outside the
node table is refused (`INVALID_GLTF`), as is a `children` cycle anywhere in the node table, reached
or not, since the published document carries every node. A parentless node no scene names is
accepted, uncompiled.

A node's world placement composes its parents' transforms, one walk every stage reads; a
`KHR_lights_punctual` lamp under a moved parent lands in `lights.json` at that world position.
`EXT_mesh_gpu_instancing` is expanded at load: each instance becomes a child node carrying the mesh,
its skin and morph weights and the instance's translation, rotation and scale, then is selected,
tabled, proxied and cooked like any mesh node; the instanced node keeps its transform, children and
light, without the mesh. Instance attributes of different counts, or none, are refused
(`INVALID_GLTF`). `KHR_node_visibility` `visible: false` hides a node and its subtree
(`compiler_nodes.rs`, `scene_nodes`): its meshes are compiled so a page can show them later and the
node table marks it hidden, but no coplanar surface, proxy or oracle triangle, static collider or
body derives from it, and a `KHR_lights_punctual` lamp it hides is off, left out of `lights.json`.

## The three streams

The process talks through stdin, stdout and stderr only. The one environment variable read,
`TRILLION3D_CACHE_LOCK_WAIT_MS`, shortens the wait for a busy cache
([`CACHE_LOCKED`](COMPILER_ERRORS.md#global)): milliseconds, `0` refuses at once, anything
unreadable is ignored.

| Stream | Content | Size |
| --- | --- | --- |
| stderr | One JSON object per line, one line per event | a few KB per job |
| stdout | The pointer for one job, or the batch summary | under 1 KB per job |
| stdin | Optional cancel requests, one JSON object per line | — |

The manifest (`clusters.json` and its pages) is **never** printed; the pointer says where it is. A
host may ignore stdin.

## Events

Every stderr line is `{"event": <kind>, "job": <id>, ...}`; the job id is `"job"` for a single
invocation, the batch file's id in batch mode, `"*"` on batch-level lines. `accepted`, `progress`
and `complete` carry `ratio`, a whole-job completion estimate from 0 to 1 that never goes backwards,
so a host draws one bar without knowing the phases (`compiler_ratio.rs`): source import up to 0.30,
glTF import 0.35, clustering 0.35–0.95 over the primitives the `import` event announced, root
bundles 0.95–0.96, coplanar cuts 0.96–0.965, texture levels 0.965–0.97 one image per step, resident
proxy 0.97, impostors 0.975, lights 0.98, a proven reused folder 0.98, prune 0.99, pointer 1. An
unknown phase keeps the last ratio, and importing several files does not restart the bar.

| `event` | When | Extra fields |
| --- | --- | --- |
| `batch` | Once, first line of `--jobs` | `jobs`, `workers` |
| `queued` | Once per job in a batch, before any work | `source` |
| `accepted` | A worker starts the job | `source`, `cache`, `scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` |
| `progress` | During the job | `phase` and its fields, below |
| `stall` | The job succeeded, before `complete` | one line per row of the manifest's `worstStalls`, in order: `rank`, `index`, `mesh`, `primitive`, `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands` |
| `complete` | The job succeeded | `pointer` (same object as stdout), `ms` |
| `cancelled` | The job stopped on a cancel request | `status:"error"`, `code:"CANCELLED"`, `message`, `ms`, catalogue fields |
| `error` | The job failed | `status:"error"`, `code`, `message`, `ms`, catalogue fields |
| `done` | Once, last line of `--jobs` | `completed`, `failed`, `cancelled`, `ms` |

Every `code` the catalogue knows ([COMPILER_ERRORS.md](COMPILER_ERRORS.md), one source of truth
in `packages/sdk-node/src/messages/messages.json`) leaves with its catalogue fields beside it: `id`,
the stable public code (`T3D-Exxx` error, `T3D-Wxxx` warning, `T3D-Ixxx` info), `level` (`error`,
`warn`, `info`), `action`, what the user does, and `docs`, the code's documentation page. An error
event carries them, and so does each of a `primitive` event's `warnings`. `code` stays the symbolic
name the cache writes, so no cache byte depends on the catalogue.

Progress phases, in order:

- `import-source` — a converting driver (FBX, OBJ, USD, Alembic, `.blend`, Maya ASCII, Unity) writes
  its intermediate scene. `step` = `parse` (`file`, `index`, `files`, `completed`, `total` in bytes)
  → `meshes` (`completed`, `total` in nodes) → `write` (`bytes`) → `complete` (`key`, `triangles`,
  `meshNodes`, `ms`), or `reused` (`key`) for a reused import.
- `import` — `completed`, `total`, `ms`, `primitives`, `nodes`, `unsupported` (the source import's
  report, counts by code; `null` for a glTF source): glTF loaded and validated, source geometry
  written; `primitives` `primitive` events follow.
- `primitive` — `mesh`, `primitive`, `pages`; on a DAG primitive `timings` (`dagMs`, `cullingMs`,
  `physicsMs`, `pagesMs`, `reportMs`, each from the end of the one before, physics and pages side by
  side); `warnings` if any. One primitive clustered and paged; primitives run in parallel, in no
  fixed order.
- `bootstrap` — `completed`, `total`: root bundles assembled.
- `coplanar` — `step` = `planes` → `surfaces` → `done`, with `completed`, `total`: coplanar cuts.
- `textures` — `completed`, `total`: one source image decoded, its mip chain baked for every atlas
  reading it, its levels written.
- `cutouts` — `pending`, `sheet`: cutout sheet written; `pending` textures still unanswered, `sheet`
  its path.
- `proxy` — `triangles`, `nodes`, `errorMetres`: resident proxy built.
- `impostors` — `baked`: impostor atlases baked ([FORMAT.md](FORMAT.md#impostor-atlases)).
- `lights` — `lights`, `rejected`, `counts`: scene lights written; `rejected` lamps left out,
  `counts` what was filled in or omitted on a lamp kept.
- `reuse` — `completed` (1 reused, 0 refused), `files`, `fileBytes`, `objects`, `objectBytes`,
  `textureLevels`, `validateMs`, or `reason`: the key's folder was proven and kept — no `textures`
  or `proxy` follow, and `import`, `primitive` (only those with `warnings`) and `lights` only tell
  again the warnings the kept product carries — or refused for the named reason and rebuilt
  ([Reusing a compiled folder](#reusing-a-compiled-folder)).
- `prune` — `removedKeys`, `removedObjects`, `removedBytes`, `removedTextures`,
  `removedTextureBytes`: stale keys, imports, orphan objects and texture levels removed (emitted
  only when something was).
- `complete` — `completed`, `total`, `pruned`: pointer written; `pruned` summarises the prune.

## The pointer

stdout for one job:

```json
{
  "status": "ready",
  "key": "80004251…dbd7",
  "scope": "full",
  "url": "80004251…dbd7/clusters.json",
  "pointer": "/abs/cache/native/full/manifest.json",
  "cache": "/abs/cache",
  "formatVersion": 9,
  "compilerVersion": "0.8.0",
  "selectedTriangles": 1132930,
  "sourceTriangles": 1132930,
  "selectedNodes": 283,
  "totalNodes": 283,
  "primitives": 412,
  "simplification": true,
  "metrics": {
    "importMs": 1571.7,
    "clusterHierarchyPagesMs": 1822.8,
    "wallMs": 3411.2,
    "outputGeometryBytes": 58679400,
    "threads": 8,
    "ramBudgetMb": 8192
  },
  "unsupported": ["hard RSS enforcement", "N-API binding"],
  "textureSkipped": {},
  "textureNotes": {},
  "reused": null
}
```

`formatVersion` is 9, or 10 (`CLUSTERED_BLEND_FORMAT_VERSION`) when any primitive is
`clustered-blend` ([FORMAT.md](FORMAT.md#pointer)). `pointer` is the file the browser explorer needs
(`manifestUrl`); `url` is relative to `native/<scope>/`. `reused` is `null` when the job wrote the
folder; for a proven and kept one it carries the proof's counts (`files`, `fileBytes`, `objects`,
`objectBytes`, `textureLevels`, `validateMs`), `metrics.clusterHierarchyPagesMs` is `null` and
`metrics.importMs` runs to the decision — routing, loading, key and proof. `textureSkipped` and
`textureNotes` count the texture stage's reasons by code (`texturePreviews.skipped` and `.notes` of
the manifest). On failure stdout carries `{"status":"error","code":…,"message":…}` with the code's
catalogue fields ([exit codes](#exit-codes-and-error-codes)).

A cache never needs wiping: after every successful job the compiler removes the scope's other keys,
stale imports, and every object under `objects/` and texture level no surviving manifest (either
scope) references (`compiler_prune.rs`).

`key` is a SHA-256 over what the source declares, the resources the compile consumes and the options
shaping the output: the source manifest, the source binary, **every image the scene links by
relative URI** (its fingerprint, `null` when absent), declared sidecars, the compiler version, the
compiler's fingerprint (its source modules, `Cargo.toml` and `Cargo.lock` at build time), the
error-model identity (`dag-group-qem-v3`), scope, budget, `RESOURCE_BASE_URL` and simplification.
External image bytes are neither embedded in the manifest nor hashed into the geometry — their
SHA-256 is, and the baked levels under `native/textures/` are addressed by it. Any change gives a
new `<key>` directory, which the pointer names and the prune keeps alone.

Measured durations (`importMs`, `parseMs`, `ms`) and the converting machine's absolute path (`path`)
are outside the identity at every level of the manifest; everything else a driver writes enters the
key. So the same inputs and options give the same key on any machine and cache, and replacing a
linked texture beside an unchanged scene gives another. The cost is one streaming hash per linked
image, once per compile.

## Reusing a compiled folder

A folder under the key holds the bytes the job would write. Once the source is keyed, before the
first primitive, the compiler looks for `<scope>/<key>/clusters.json`: absent, it compiles; present,
it **proves** the folder with the compile path's own checks, keeps it and skips to the pointer and
prune:

- The manifest head: `status`, `key`, `scope` and `compilerVersion` of this job; a `formatVersion`
  this compiler writes (9 or 10). Another build's folder under the key is refused.
- The manifest's pages: their slots in the root, and each column file its page's `binary`.
- Every other product the manifest's `files` record names (`source.gltf`, `source.bin`, `proxy.bin`,
  `lights.json`, `scene-tables.json`, `scene.gltf`, `scene.bin`, …), by size and SHA-256; no record,
  no proof. A partitioned scene's cells against the records its pages hold.
- Every object the sidecar names: its content-addressed name, hashed on the job's pool.
- Every baked texture level: its presence under `textures/v<N>/<sha256>/` — the lossless file and
  the block file of every family the layout word keeps —, once per (image, atlas); a bake the
  compile could not finish (`texturePreviews.notes.texture-level-write-failed`, or fewer levels than
  the sidecar tail starts at) is refused, since a reuse would never bake it.
- The cutout answer sheet: its presence at the cache root (`decoupes.json`).

A failed check names its reason on `reuse` (`completed: 0`) and the job compiles, overwriting the
folder. A proven folder yields `reused` on the pointer and `reuse` with `completed: 1`; neither the
manifest (its `metrics` still describe the compile that produced it) nor the answer sheet is
rewritten — an answer that changes the product changes the key. A reuse costs the identity (routing,
loading, hashing the source binary and linked images) plus the proof (hashing every product and
object); the compile pays the `files` record once, each product hashed as written.

## Measurements

A job's durations are its own: its counters are created with the compilation, adopted by its own
pool's threads and read by nobody else, so two jobs of one batch never describe each other's work.

| Field | Where | Meaning |
| --- | --- | --- |
| `metrics.importMs` | result and pointer | Source routed, loaded, validated, its geometry copied |
| `metrics.clusterHierarchyPagesMs` | result and pointer | Clustering, paging, coplanar cuts, resident proxy and lights |
| `metrics.compileMs` | result and pointer | Wall time until the manifest is serialized |
| `metrics.pruneMs` | pointer | Wall time of the prune after publication |
| `metrics.phaseElapsedMs` | result and pointer | Elapsed time per phase, summed over worker threads; the texture stage publishes `textureDecodeMs`, `textureBakeMs` (chains, block encodes and their gate read-back), `textureWriteMs` and `textureAlphaMs` |
| `reusedPages` | result (per primitive), pointer and `prepare()` (total, `null` on a kept folder) | Page objects the run found already built |
| `metrics.wallMs` | pointer and `complete` event | Wall time of the whole job, after the manifest is written and the cache pruned |
| `metrics.threads`, `metrics.ramBudgetMb` | result, pointer and `prepare()` | The run's settings |
| `metrics.admissionEstimatedBytes`, `metrics.compileWaves` | result, pointer and `prepare()` (absent on a kept folder) | The working set the run admitted and the waves it cut from its budget |

What a run measures of itself and its settings are its report, never its product
([FORMAT.md](FORMAT.md#clustersjson)): the manifest keeps none of it, nor which cutout sheet the run
read, only the answers it applied. `prepare()` returns the pointer's; the pointer and `complete`
carry them all, and `wallMs` ≥ `compileMs + pruneMs`. The `phaseElapsedMs` phases **overlap** and
are elapsed time on the `wallMs` clock, not CPU: a wait, disk write or descheduled thread lands in
the open phase. Summed across threads, with `threads > 1` their total can exceed `wallMs`, and
adding phases is meaningless. Nothing measures processor time; `cpuMs` and `diskBytesRead` stay
`null`. `peakRssBytes`, the process's peak resident memory (`getrusage`), is in the result, the
pointer and every progress event — the first event where it jumps names the stage that raised it;
it is shared by a batch's concurrent jobs.

## Batch mode

`--jobs FILE` (or `--jobs -`, the batch read from stdin, which disables cancellation) runs many jobs
in one process, each with its own `cache` (a cache holds one pointer per scope and prunes itself, so
two jobs sharing one would destroy each other's output):

```json
{
  "workers": 2,
  "ramBudgetMb": 16384,
  "threads": 4,
  "jobs": [
    {
      "id": "city",
      "source": "scenes/city/city.obj",
      "cache": "cache/city",
      "resourceBaseUrl": "/assets/city/",
      "scope": "full",
      "simplification": "qem-endpoints"
    },
    {
      "id": "london",
      "source": "scenes/london",
      "cache": "cache/london",
      "resourceBaseUrl": "/assets/london/",
      "threads": 8,
      "ramBudgetMb": 12000
    }
  ]
}
```

| Field | Meaning | Default |
| --- | --- | --- |
| `workers` | Concurrent jobs (1–64), lowered until the budget holds them | `1` |
| `ramBudgetMb` | Total admission budget, split evenly between workers unless a job sets its own | `256 × workers` |
| `threads` | Default threads per job | `2` |
| `jobs[].id` | Unique job id in events and the summary | `job-<index>` |
| `jobs[].source`, `cache`, `resourceBaseUrl` | As on the command line | required |
| `jobs[].scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides | `full`, `150000`, batch default, batch share, `none` |
| `jobs[].texturesFormat` | As `--textures-format=` | `bc7` |

Jobs go in file order to the first free worker. stdout at the end:

```json
{"status": "ready" | "partial" | "failed", "completed": 2, "failed": 0, "cancelled": 0,
 "jobs": [{"job": "city", "status": "ready", "pointer": {…}}, {"job": "x", "status": "error", "code": "IMPORT_IO_ERROR", "message": "…"}]}
```

`jobs` is sorted by id; `status` is `partial` when some but not all jobs are ready, `failed` when
none is. The summary is always printed, so a host reads it rather than the exit code (2 unless every
job is ready). Only a batch file refused outright prints
`{"status":"error","code":"INVALID_BATCH",...}`, with no `jobs`.

Two jobs may not write one cache. Destinations are compared by identity — the longest existing
prefix canonicalized, symlinks included, the absent suffix normalized (`.`, `..`, doubled
separators) — so `x` and `p/../x` are one cache, and the batch is refused (`INVALID_BATCH`) before
any job starts, naming both jobs and spellings.

`ramBudgetMb` budgets the **whole batch**. No job is admitted under 64 MiB, so `workers` is lowered
until every set of jobs that could run together fits: `workers: 2` with `ramBudgetMb: 64` runs one
job at a time with 64 MiB. Per-job overrides count the same way (the largest that would run together
must fit); a job asking for more than the whole batch, or a total under 64 MiB, is refused with
`INVALID_BATCH` before anything starts. The `batch` event publishes the concurrency admitted, each
`accepted` event its job's share — an admission estimate, not an enforced RSS ceiling. Each job has
its own pool of `threads`, so `workers × threads` is the CPU ceiling.

## Cancellation

Write one line on stdin:

```json
{"cancel": "*"}          // everything
{"cancel": "london"}     // one job of a batch
```

The flag is checked between steps (parsing, each primitive, each write); the job stops and emits
`cancelled` (`{"status":"error","code":"CANCELLED"}` on stdout for a single job, counted under
`cancelled` in a batch). Unstarted batch jobs still run unless `"*"` was sent.

Killing the process is safe too: every file is written under a temporary name and renamed, so the
cache holds the previous or the new complete result, never a half-written file. A re-run resumes at
the import cache (below).

## FBX and OBJ import

A `.fbx`/`.obj` `SOURCE`, or a directory of such files with neither `manifest.json` nor a glTF, is
first imported into the cache, like every converting driver's source (USD, Alembic, `.blend`, Maya
ASCII, Unity):

```
<CACHE>/native/imports/<import-key>/
  model.gltf       plain glTF 2.0 (nodes with world matrices, meshes, materials, images, lights)
  model.bin        geometry (+ embedded images as buffer views)
  manifest.json    source manifest read by the compile step, plus an import report
```

`<import-key>` hashes every input file, the driver's name and version, **every other file the reader
opened** (the `.mtl` an OBJ cites, absence included) **and every image path the texture resolution
tried** — path, existence, bytes: the reader never opens an image, but its presence picks the
intermediate glTF's URI. An unchanged source and driver is imported once and reused
(`import-source/reused`); a touched, deleted or new material library **or texture** gives another
key. The import manifest lists only the files the reader opened; what the resolution kept is in
`images`. The compile then treats the import like a hand-made glTF folder.

What is carried:

- Positions, normals, one UV set, one colour set → `POSITION`, `NORMAL` (generated when missing),
  `TEXCOORD_0` (V flipped), `COLOR_0`.
- Polygons: triangulated by ufbx; indices `u16` under 65 536 vertices, else `u32`.
- Units and axes: metres, right-handed, Y up (FBX `UnitScaleFactor` and axis system honoured; OBJ
  assumed metres, Y up).
- Instances: one glTF mesh per (mesh, material list), one node per instance with its world matrix
  (`geometry_to_world`, geometry transforms and pivots baked).
- Materials: `pbrMetallicRoughness` from ufbx's unified PBR view (Phong, Lambert, Arnold, Stingray,
  3ds Max, OpenPBR, MTL…): base colour + alpha, metallic, roughness (glossiness inverted), emissive,
  normal, occlusion, metallic-roughness when one texture carries both; `doubleSided`; `alphaMode`
  `BLEND` when opacity < 1 or an opacity texture is bound, **never** `MASK` — no import format
  declares a cutoff. A bound texture replaces the colour factor (FBX semantics). Default roughness:
  0.6.
- MTL map options: `-clamp on` sets the sampler's edge mode on both axes; `-o`, `-s` and `-bm` are
  counted, not applied. ufbx keeps `Tr` and `illum` as raw properties: a transparency written `Tr`
  instead of `d` is lost, the illumination model ignored.
- Textures: PNG/JPEG resolved inside the source directory (declared absolute, relative or bare name;
  then `textures/`; then a `.png`/`.jpg` sibling of a DDS/TGA/…); embedded bytes become buffer
  views; wrap modes → sampler. Referenced by a URI relative to the source directory, percent-escaped
  per glTF, served under `RESOURCE_BASE_URL`.
- Lights: point, directional, spot → `KHR_lights_punctual`, along the FBX light direction.
- Hidden nodes: skipped, counted.

Not carried, counted under `unsupported`: cameras, area/volume lights, procedural textures, UV
transforms, textures outside the source directory, GPU-only image formats without a PNG/JPEG
sibling, separate opacity textures, split metallic/roughness textures, and the `material-*` and
`texture-*` rows of the [error tables](COMPILER_ERRORS.md). ufbx warnings go under `notes`; a
missing material library has its own code. The import manifest also records per file: format, FBX
version, creator, unit scale, mesh/material/texture/light counts, parse and conversion time.

## USD and USDZ import

A `.usd`, `.usda` or `.usdc` layer is composed by the `usd` driver into the same intermediate scene
under `<CACHE>/native/imports/<import-key>/`. A `.usdz` package is a container (the `usdz` driver):
extracted under the cache, its content routed like any source, its layer through `usd`. What is
dropped or approximated is counted under `unsupported` by its `usd-*` code
([COMPILER_ERRORS.md](COMPILER_ERRORS.md)).

- `Xform`, `Scope`, any untyped group: one node each; `xformOpOrder` composed into a column-major
  `matrix` (translate, scale, the six Euler orders, `orient`, `transform`, and their `!invert!`
  forms). `rotateXYZ` … `rotateZYX` apply rotations in letter order, first letter most local; the
  angles stay written `(x, y, z)` under every order.
- `Mesh`: polygons triangulated in their own plane ([Polygon faces](#polygon-faces)); `orientation`
  honoured (`leftHanded` reverses each triangle); indices `u16` under 65 536 vertices, else `u32`. A
  face with an index outside the points or negative, under three corners, or a primvar index outside
  its array is dropped, never folded onto point zero; a `holeIndices` face is dropped whatever the
  subdivision scheme.
- Normals and `primvars:st`: resolved through `interpolation` (`constant`, `uniform`,
  `vertex`/`varying`, `faceVarying`) and `:indices`; `TEXCOORD_0` V flipped; a corner's (point,
  normal, uv) is the vertex key.
- `GeomSubset`, family `materialBind`: one primitive per subset; unclaimed faces take the mesh's
  `material:binding`. Bindings resolve up the ancestors, nearest winning (a subset binding none
  takes its mesh's), and `bindMaterialAs = "strongerThanDescendants"` wins over those below.
- Instances: `instanceable` prims sharing a prototype share one glTF mesh, one node each; `class`
  prims are templates, not traversed.
- Roots and `defaultPrim`: every root is converted; `defaultPrim` is the entry point that opens the
  scene, dropping no other root.
- `visibility`: `invisible` removes the prim and its subtree (inherited; no descendant comes back),
  counted as `invisible` in the manifest counts.
- Units and axes: `metersPerUnit` (0.01 when undeclared) and `upAxis` land on the scene root node,
  never in the vertices (`Z` up becomes `Y` up).
- Materials: `UsdPreviewSurface` → `pbrMetallicRoughness`: `diffuseColor` + `opacity` →
  `baseColorFactor`, `metallic`, `roughness`, `emissiveColor`, `normal`; a connected `UsdUVTexture`
  wins over the written factor, which then stays at one. An `opacity` bound to the base-colour
  texture's alpha (`outputs:a`) rides in it, any other opacity texture or channel keeps the written
  opacity. A shared metallic/roughness map is read as glTF packs it, metal `outputs:b`, roughness
  `outputs:g`. `opacityThreshold` > 0 → `MASK` at that cutoff; else an opacity below one or from the
  base-colour texture → `BLEND`. Absent inputs take the specification's defaults — `diffuseColor`
  0.18 grey, `roughness` 0.5, `metallic` 0, `opacity` 1 —; a textured `occlusion` reaches
  `occlusionTexture` through red. `doubleSided` comes from the mesh: an unbound double-sided mesh
  gets one shared default material carrying it, and a bound material is duplicated into a
  double-sided variant, never mutated.
- Textures: `UsdUVTexture` by URI; its asset path is anchored on the authoring layer (reference,
  sublayer or payload), then taken back under the source directory; `wrapS` and `wrapT` reach the
  sampler, a mode glTF lacks repeating; a `scale` equal across colour channels with no `bias`
  becomes the material factor, anything else stays out; a `sourceColorSpace` contrary to the
  input's role is counted, never re-encoded.
- Animation: the default value, else the lowest time sample.
- `UsdLux` lights: `SphereLight`, `DiskLight` and `RectLight` (glTF has no area source) → `point`,
  `DistantLight` → `directional`; a `ShapingAPI` cone makes any a `spot`, `softness` giving the
  inner angle; `ShadowAPI` `inputs:shadow:enable` rides in `extras.castsShadow`.
  `inputs:intensity` × 2^`inputs:exposure` is a radiance; the radiant intensity is it times the
  source's projected area — `π r²` for a sphere or disk, width × height for a rect — unless
  `inputs:normalize` is set, and a distant light carries its irradiance as written; glTF's
  photometric value is the radiometric one times 683 cd/W, which `lights.json` divides back out. `inputs:radius`, or half the diagonal of
  `inputs:width` × `inputs:height`, becomes `extras.emitterRadius` in world metres. A distant
  light's `inputs:angle` is not carried.

The import manifest also records the layer read, its size and SHA-256.

### Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners, each
read in the plane of its Newell normal. A **strictly convex** ring — every corner turning the same
way by a non-zero angle, the edges swinging round exactly once — is written as the fan from its
first corner in one pass. Every other ring is ear-clipped, cutting only empty triangles, so a
concave face keeps its area and outline; a ring the ears cannot finish (self-crossing, or planeless)
falls back on the fan, counted under `<driver>-ngon-untriangulable`. On a strictly convex ring the
ears would cut that very fan; a collinear or duplicated corner keeps the ear path.

## Input formats

**Policy.** A single Rust executable accepts whatever marketplaces deliver (FAB, Unity Asset Store,
Quixel, Sketchfab) without third-party tools. Fidelity first: no loss is added without a bound, no
lossy format is re-encoded, sources are never modified nor written beside. A texture received
lossless keeps its lossless levels in the cache, and the block family cooked beside them is kept
only where the quality gate of [FORMAT.md](FORMAT.md#textures) holds its loss under a declared,
measured bound; a texture received GPU-compressed keeps its format where the machine supports it and
is decoded only as a fallback.

No proprietary format is read without an established legal reading (this page is not legal advice).
Each reader is written in this repository, its dependencies' licenses respected, never any editor
code or SDK reused, never any protection bypassed, the provenance of each reader documented, its
test suites redistributable.

### Architecture: one driver per format

The compiler knows no format. It routes each source to a driver in a static registry
([Adding a format](#adding-a-format)):

- **one driver per format, without exception**: `gltf`, `fbx`, `obj`, `unity`, `blend`, `zip`,
  `unitypackage`, `alembic`, `usd`, `usdz`, `ma` for scenes (`plugins/scene.rs`); `png`, `jpeg`,
  `tga`, `tiff`, `dds`, `exr`, `hdr`, `ktx2`, `webp`, `psd`, `bmp`, `gif` for images;
- each is a Rust module with its name, version, detection (extension, magic number, folder
  structure), named report and minimal golden test; two drivers may share a library (ufbx for `fbx`
  and `obj`, the `image` crate for images) and remain two registry entries;
- two versioned contracts: scene driver (glTF intermediate scene + bin + report) and image driver
  (RGBA8, or RGBA linear float for EXR and HDR); driver and contract versions enter the cache
  identity, and the selected driver (name, version) is recorded in the manifest and report;
- an unknown or ambiguous source is rejected with the list of accepted formats, never interpreted
  by default.

### Safe

"Here from spec" means a reader written in this repository from the specification, without a crate.

- glTF / GLB: Khronos standard.
- OBJ / MTL: published specification; MTL read and audited (golden
  [`tests/fixtures/formats/obj`](../tests/fixtures/formats/README.md#obj)); `Tr` and `illum` not
  interpreted ([FBX and OBJ import](#fbx-and-obj-import)).
- PNG, classic JPEG: standards.
- TGA: published specification.
- TIFF (declared profiles): published specification.
- OpenEXR, Radiance HDR: documented, BSD-3; `exr` crate for OpenEXR, HDR here from spec.
- USD / USDZ: public AOUSD, OpenUSD under TOST 1.0; `openusd` crate (MIT, pure Rust, no C++); `usdz`
  is a stored and aligned ZIP container ([USD and USDZ import](#usd-and-usdz-import)).
- Alembic: open, BSD-3; static geometry only; Ogawa reader here from spec.
- `.blend`: documented SDNA, reading a `.blend` does not impose GPL; SDNA reader written here;
  meshes of Blender 2.8 to 5.x, UVs, instances, Principled BSDF.
- PSD / PSB: specification published by Adobe for third-party readers; flattened composite only, to
  RGBA8; reader here from spec; RGB and 8-bit grayscale, raw or PackBits.
- BMP, GIF: open; `image` features; lossless only — BMP masks with more than 8 bits per channel and
  animated GIF rejected by name.
- ZIP: open.

### Conditionally Safe — condition written in code

- FBX: MIT ufbx, frozen version, notices kept, never the Autodesk SDK.
- Unity `.unity`, `.prefab`, `.mat`, `.meta`: YAML subset documented by Unity; data only, never
  Unity scripts or code.
- `.unitypackage`: tar.gz archive; each file retains its license.
- DDS: container documented by Microsoft; codecs declared one by one.
- KTX2, Basis Universal: Khronos, `basisu` Apache-2. KTX2 only: ETC1S/BasisLZ and UASTC LDR by
  `basisu`, Zstandard by `ruzstd`, uncompressed R8G8B8A8, BC1–BC5, BC7, ETC2, EAC, ASTC 4×4; KTX 1.0
  not read.
- WebP: pure Rust decoder `image-webp`, libwebp patent license; lossless only, lossy stream and
  animation rejected by name.
- Maya ASCII `.ma`: documented format; data only, no script executed. Reader here from the public
  MEL command docs; subset `createNode`, `setAttr`, `connectAttr`, `currentUnit`, `parent`;
  `transform`, `mesh`, `lambert`/`phong`/`blinn`/`standardSurface`,
  `file`/`place2dTexture`/`bump2d`, `shadingEngine` by face groups. Any other command — `python`,
  `eval`, `source`, unknown — counted by name, never executed.

### To Avoid — No Native Import

`.uasset` / `.umap`, `.max`, `.mb` (binary), native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Request an export in one of the listed formats.

### Content Licenses — Independent of Format

Audit local asset and license manifests with [the offline license audit](ASSET_LICENSE_AUDIT.md).

- FAB Standard License: use with other tools and engines permitted, standalone asset redistribution
  prohibited; historical licenses apply for some items, keep purchase EULA.
- Quixel Megascans under reference Engine plan: restricted to reference Engine, unusable in
  Trillion3D.
- Unity Asset Store: use in other engines permitted, but not a product whose purpose is raw asset
  distribution; model library distributor is not a finished game.
- Sketchfab: per-download license (CC-BY requires attribution and change notice).
- Demos and public repo tests: assets with full rights owned or under redistributable license.

## Adding a format

Paths are relative to `packages/asset-compiler-rust/`. A format is a driver module and a registry
line; removing it removes both; core and CLI do not change. A scene driver always produces the
**intermediate scene**, a glTF 2.0 and its binary, the only input `compile` reads; an image driver
produces RGBA8, or RGBA linear float for high dynamic range. [Input formats](#input-formats) says
which formats are admitted, under what conditions and license, and takes precedence: a driver
outside its list is not merged.

### A Scene Driver

1. A module `src/plugins/scene/<format>.rs`, named after the format, never the library reading it:
   two formats one library reads stay two drivers, names and versions, shared code in a neighbouring
   module (`ufbx_driver.rs` for FBX and OBJ).
2. `impl Plugin`: `name` (the format, lowercase), `version` (names the library and its version;
   changing it invalidates caches), `extensions` (lowercase, no leading dot).
3. `impl ScenePlugin`: `accepts_head` recognizes the header (`false` for a headerless text format);
   `prepare` returns `PreparedScene::InPlace` for direct input or `request.converted(directory)` for
   what it wrote into `request.cache`.
4. One line in `scene::PLUGINS`.

A **project** driver (`unity` first) also claims a whole folder via `project_inputs` and takes
precedence over file drivers beneath it, whose files become its inputs; two projects on one folder
stay ambiguous.

`prepare` receives every file of the claimed folder, accepts one or several, and rejects with
`SOURCE_FORMAT_AMBIGUOUS` when it wants only one. It checks `request.cancelled` at each bounded work
boundary, reports through `request.progress` (a converter under `import-source`), and writes only
under `request.cache`, never beside the source.

glTF tables (nodes, meshes, materials, accessors, images) are filled by `src/import/tables.rs`
(`SceneTables`), primitives emitted from deduplicated vertices by `src/import/primitive.rs`
(`Vertices`); a driver uses these, never its own table filling.

Images stay where the driver read them: relative image URIs resolve at
`scene::image_root(request.source)` — the source folder, or a container's extracted folder —, which
`request.converted` attaches to the converted scene so the compiler re-reads the same bytes. A
driver resolving an image calls it and writes no second copy.

### A Container Driver

An archive is a container for a source: an ordinary scene driver (`zip` first) that extracts under
`request.cache`, traverses a single root folder, **routes the extracted folder through the router**
and returns what the chosen scene driver returns; unknown or ambiguous means rejection.

The format-independent part lives in `src/plugins/scene/archive.rs` — named ceilings (entries and
uncompressed bytes), refusal of output outside the extraction folder, extraction key, router
composition; ZIP reading in `scene/archive/zip_reader.rs`, shared by `zip` and `usdz` (an
uncompressed, aligned ZIP). A second container adds only its reading module. Non-negotiable: no
absolute paths or `..`, no symlinks followed, no encrypted archive opened, a named rejection — never
half an extraction.

### An Image Driver

1. A module `src/plugins/image/<format>.rs`, same naming rule.
2. `impl Plugin`, then `impl ImageDecoder`: `mime`, `accepts_head` (the magic number) and `decode`,
   returning `DecodedImage` under the received allocation ceiling.
3. One line in `image::DECODERS`.

A failed decode returns a report reason (a stable string like `image-decode-failed`), never a
compilation error: the engine falls back to its default white. A decoder never returns an empty
image and never panics.

`DecodedImage` has two variants: `Rgba8`, and `RgbaF32` for high dynamic range. **A driver never
converts one to the other**: float to 8-bit needs tone mapping, a loss the source lacked. The
consumer decides by `match` and a named reason (`image-float-unsupported` for the RGBA8 sRGB
previews). A float driver checks the ceiling at **sixteen bytes per pixel** before allocating
(`float_budget`), the rejection naming its format.

### What to Provide With It

- **A minimal golden fixture**: the smallest owned or redistributable file under
  [`tests/fixtures/formats/`](../tests/fixtures/formats/README.md), with its `expected.json`,
  compiled by the shared harness (`src/tests/golden.rs`), never a custom one;
  `GoldenRun::prepared_dir` finds a driver's prepared directory and `scene_digest` extracts the
  triplet `expected.json` compares.
- **One test per driver behaviour**: what it recognizes, rejects and reports; router and registry
  tests exist, not to be duplicated per format. Read a decode with `rgba8()` or `rgba_f32()` from
  `src/plugins/tests.rs`, never an irrefutable `let` on a `DecodedImage` variant: a test assuming
  one output says so by a call that panics on the other.
- **Dependencies**: a driver's library and its license are declared in `Cargo.toml` and
  `THIRD_PARTY_NOTICES.md`, not cited in its comments.

### Forbidden

- Reusing editor code or SDK, even available: each reader is written in this repository, its
  dependencies' licenses kept.
- Bypassing a format's encryption, protection or license check.
- Breaking the fidelity [policy](#input-formats): re-encoding a lossy source, modifying or writing
  beside originals.
- Anything format-specific in `main.rs`, `cli_batch.rs` or `compiler_args.rs`: the CLI names no
  format.
- An empty driver "for later".

## Cache layout

Written by a job under `<CACHE>/native/` ([FORMAT.md](FORMAT.md#layout) is the reader's contract):

- `.lock`: the cache's exclusion, held while a job writes (`CACHE_LOCKED`).
- `<scope>/manifest.json`: the pointer, `{status, formatVersion, compiler, key, scope, url}`.
- `<scope>/<key>/clusters.json` and its pages: the compiled manifest (root, JSON pages and
  typed-array columns), see [FORMAT.md](FORMAT.md#clustersjson).
- `<scope>/<key>/source.gltf` + `source.bin`: the source glTF on one aligned buffer, image URIs
  rewritten under `RESOURCE_BASE_URL`.
- `<scope>/<key>/scene.gltf` + `scene.bin`: autonomous scene for the prepared-page backends
  (materials, no source geometry), written only when every primitive is exact and the source
  declares no animation, skinning or morph weights; otherwise `autonomousScene` is `null` and
  `autonomous-scene-animated` says why.
- `<scope>/<key>/scene-tables.json`: node graph, lights, surfaces and geometry layout of the
  prepared scene, read from the `source.gltf` (and `scene.gltf`) the job publishes; the runtime
  builds its scene from it alone ([FORMAT.md](FORMAT.md#prepared-scene-tables)). Placements
  outgrowing one stream unit go to `scene-cell-<n>.json` cells beside it
  ([FORMAT.md](FORMAT.md#world-partition)).
- `<scope>/<key>/world-roots.table`, `world-roots.dag`, `world-roots.bin`: the world super-roots
  above the objects (`compiler_world_roots.rs`, [FORMAT.md](FORMAT.md#world-super-roots)).
- `<scope>/<key>/proxy.bin`: the resident lighting proxy
  ([FORMAT.md](FORMAT.md#resident-lighting-proxy)).
- `<scope>/<key>/lights.json`: scene lights in the engine's `SceneLight` contract (below).
- `<scope>/<key>/physics.json`: the cooked colliders (below).
- `textures/v<N>/<sha256>/<kind>-<level>.<format>`: baked mip levels above the sidecar's tail —
  lossless PNG, plus the kept block family — addressed by the source image's SHA-256, shared across
  keys and scopes, never rewritten, pruned with the objects ([FORMAT.md](FORMAT.md#textures)).
- `objects/<sha256>.bin`: content-addressed index pages, quantized cluster pages, streaming bundles
  and collider shapes, shared across keys and scopes.
- `imports/<import-key>/`: a converting driver's intermediate scene ([FBX and OBJ
  import](#fbx-and-obj-import)).

The cutout answer sheet, `decoupes.json`, lies at the cache root beside `native/`.

### `lights.json` — the lamps of the source file

The source's lamps in world space and in the engine's `SceneLight` contract, a product of its own
beside the manifest: the manifest format number does not move, and a reader ignoring the file loads
the cache as before. It carries `version`, `sceneLightVersion`, the photometric `units`, `count`,
`lights`, `rejected` (lamps left out, by code) and `counts` (what was filled in or omitted on a kept
lamp).

`emitterRadius`, the radius of the envelope a lamp stops occluding in its own shadow map
([SDK.md](SDK.md)), is filled for `point` and `spot` lamps only, from two places in order. First the
source: a radius declared on the lamp, in the light's `extras.emitterRadius` in metres. USD and
Blender fill it from their data — a `UsdLux` light's `inputs:radius` or the diagonal of
`inputs:width` × `inputs:height`, a Blender `Lamp`'s `radius` (`shadow_soft_size` in older files)
and emitting surface — carried to world metres by the layer unit and object scale. glTF
`KHR_lights_punctual` and FBX lamps carry no size, so for those only a glTF authored with the
channel feeds it. Otherwise the compiler measures the luminaire: when the lamp's parent node or a
direct sibling carries a mesh whose material emits — a non-zero `emissiveFactor` or an
`emissiveTexture` — the radius is the greatest distance from the lamp's centre to one of that
body's vertices, counted `light-emitter-radius-derived`. The body is walked vertex by vertex, never by its box. With several
emissive bodies the tightest sphere wins. The field is written only when finite, strictly positive
and strictly below `range`; otherwise it is omitted, counted `light-emitter-radius-invalid`. A lamp
with no envelope, and a `directional` lamp, receive nothing, uncounted.

### `physics.json` — the cooked colliders (stage `physics-cook`)

The browser builds no tree, hull or mass: loading a collider is a decode and a copy. Native Jolt is
linked into the compiler from the web module's pinned submodule (`build.rs` builds
`packages/physics-jolt-wasm` with `-DCOOK=ON`; needs CMake, a C++17 compiler and `git submodule
update --init`). The stage contract is `PHYSICS_COOK_STAGE` / `PHYSICS_COOK_VERSION`; the Jolt
commit and stage version enter the cache key, so another Jolt's cook is never reused. Fields are in
[FORMAT.md](FORMAT.md#physicsjson--cooked-colliders); the algorithms, in `src/physics_cook/`:

- **Collision level** (`cut.rs`). A DAG cut at one threshold — clusters with `lod_error <= threshold
  < parent_error`, the renderer's and proxy's rule, so the surface is covered once, borders locked.
  The tolerance `t` is the object's own: the median error of its first simplified level. Each cut
  tried is measured against level 0 both ways (`hausdorff.rs`: vertices, edge midpoints and
  centroids of each side to the other's nearest triangle): the cut at `t` first, then a bisection
  over the cluster errors under `t` down to level 0. The coarsest cut within `t` is kept. No
  simplified level: collision at level 0.
- **Tiles.** The cut splits along the culling hierarchy: a node of at most 4096 collision triangles
  is one tile, a larger one hands its children down. Each tile is a Jolt `MeshShape` in the
  primitive's frame, stored under its SHA-256. Jolt drops a triangle whose doubled area is under
  1e-6, absolute, so the cook (`packages/physics-jolt-wasm/src/mesh.h`, shared with the runtime)
  scales a tile of small triangles to 2^11 by a power of two, at most 2^19, inside a `ScaledShape`
  of the inverse: both scalings exact, the collider is the drawn cut.
- **Height fields** (`height.rs`). A primitive whose used vertices sit one per point on an evenly
  spaced x-z lattice, every triangle within one cell, becomes a `HeightFieldShape`; the largest gap
  between a cell's two diagonals is its `hausdorff`.
- **Declared matter** (`declared.rs`). A `KHR_physics_rigid_bodies` collider naming a
  `physicsMaterial` gives the node's placements its friction and restitution. Every drawn node but a
  declared soft body is static ground as drawn, motion-declaring nodes included; the page drops
  their placements once it has restored the body.
- **Declared bodies** (`declared.rs`). A rendered node whose `KHR_physics_rigid_bodies` declares a
  `motion` (dynamic, or kinematic with `isKinematic`) is also cooked into `bodies`: the
  `KHR_implicit_shapes` shape its collider names, else one convex hull built by native Jolt
  (`hull.rs`) of the mesh its collider's node draws. A dynamic body's mass, centre of mass and
  inertia come from volume integrals over its closed mesh's tetrahedra (`mass.rs`) at 1000 kg/m³ and
  the body's scale; a kinematic body is not weighed. A concave body collides by its hull. A refused
  body — missing shape, shearing node, unreadable mesh, a dynamic mesh not closed or bounding no
  volume, a hull Jolt refuses — is named in `report.bodiesRefused`; the compile goes on.
- **Breakable bodies** (`pieces.rs`, `voronoi.rs`). A shapeless body declaring `breakable` (above 0)
  is cut into at most 12 Voronoi cells around seeds drawn from the node's index, each clipped by its
  bisectors and the mesh's face planes into a closed piece with Jolt's hull and exact mass, centre
  and inertia. Pieces missing the mesh's mass by over 1e-5 (a concave mesh) refuse the body, as does
  a declared shape.

Primitives without a DAG (shared blend) cook no collider, nor does one whose shape Jolt refuses
(every triangle of zero area), named with Jolt's reason in `report.refused`; the compile goes on,
its render cache unchanged.

### Soft bodies a model declares

A drawn node whose `extras.physics` holds `obj.physics`'s soft-body options — `{ "type": "cloth" |
"rope" | "volume", "pins", "mass", "stretch", "bend", "pressure", … }`, `bend` omitted for none —
is cooked as a soft body, not static ground (`src/physics_cook/soft.rs`); its mesh must hold one
primitive. Its vertices become the simulated ones exactly as the page's `softBodyOf` makes them
(`soft_record.rs`): coincident positions welded, masses from the area (a rope's length) each holds
at the node's world scale or the declared `mass` spread so, pins held, a volume's default pressure.
Each value is rounded to 32 bits where the page rounds it, bit for bit (`soft_tests.rs` against
`packages/sdk-core/src/physics/softCook.test.ts`). Native Jolt builds the `SoftBodySharedSettings`
with the physics worker's own builder (`packages/physics-jolt-wasm/src/softSettings.h`), optimised,
saved with `SaveWithMaterials` under their SHA-256 like a tile; the page hands the bytes to Jolt's
`sRestoreWithMaterials` and builds nothing (`packages/sdk-browser/src/physics/cookedSoft.ts`; fields
in [FORMAT.md](FORMAT.md#softbodies--cooked-soft-bodies)). A refused node — two primitives, a
shearing matrix, an option out of range, a pin naming no vertex — is named in `report.softRefused`;
the compile goes on. The cook also writes the render mapping (`render`, version 1), and the page
writes the simulated vertices back into the drawn mesh (`sdk-browser/src/deformation/softSource.ts`;
[Deformation streams](#deformation-streams)).

## Cutouts declared as blend

The virtualized path takes opaque and masked materials: a blended primitive costs one draw call per
item and face, a masked one joins the single compute-raster draw. Source files routinely declare
foliage blended when it is a cutout — every texel there or gone, a soft fringe only along the
contour. Importing other people's files, the compiler proposes the reclassification — **without
ever guessing silently**.

Each compile writes `decoupes.json`, the answer sheet, at the compiled model's root beside
`native/`: one entry per candidate texture, keyed by the sha256 of its image bytes, with the
measure, the compiler's `proposal`, what the texture still holds in the blend path, and `cutout` —
`true`, `false`, or `null` while undecided. It is written on **every** compile, pending or not, and
`cutouts.version` in the manifest publishes its contract number. Nothing applies until an entry
answers `true`; with no sheet, blended stays blended and the product is byte-identical.

Exact alpha measurements are cached in the sheet apart from the rounded display values, identified
by the image hash, the compiler's implementation hash (its cache key's) and the decoder versions, so
any compiler change measures again. Missing, outdated, malformed or checksum-invalid measurements
are recomputed; human answers keep their own validation and are never dropped for an invalid
measurement cache. Valid measurements survive when no scene references their image any more. The
cache skips alpha analysis, not decoding or mip baking.

**The compiler draws nothing.** It publishes what is pending — in the manifest and a `cutouts`
progress event — and the caller asks: a terminal asks, an application shows its own panel, a log or
automated chain is asked nothing. `reviewCutouts` in `trillion3d` on Node is the terminal side: it
gathers a whole batch's pending textures (a single import is a batch of one), shows each — a real
picture where the terminal has an image protocol, a half-block mosaic where not, plus a link to the
full-resolution texture —, takes one keypress per texture, writes the answer into every sheet that
knows the image, and recompiles only the models an answer changed. Answers are keyed by image bytes,
so a leaf two scenes share is asked once.

The measure reads the full-resolution alpha inside the decode the texture stage already performs to
bake each mip chain ([FORMAT.md](FORMAT.md#textures)), so nothing is decoded twice; candidates are
read once more to key answers by sha256. The question shows the progressive thumbnails the cache
already carries. Two numbers separate the shapes: the share of texels neither present nor absent,
and the share of those within eight pixels of the 0.5 contour — a glass is grey everywhere and far
from any contour, a leaf grey only along its edge. The proposal proposes; the answer applies.

An answer applies to a **texture**: every base-color binding of it, in every scene sharing it. Two
bindings are refused even when the answer says cutout, named in the report: a material with
`KHR_materials_transmission` and one whose `baseColorFactor` alpha is already below one. Applying an
answer sets `alphaMode` to `MASK` at glTF's default 0.5 cutoff, in the published `source.gltf` too,
and enters the cache key, so a changed answer recompiles. Masking hardens the silhouette blending
softened; temporal antialiasing recovers the edge.

## Memory and threads

- `threads` sizes one job's rayon pool; clustering, simplification and paging run in parallel per
  primitive.
- `RAM_MB` is an **admission** check before any work, from the source size (a GLB's BIN chunk
  counted once, as the mapped binary), the selected buffer views, the triangle count and the dense
  expansion of every accessor to decode — `count × components × 4` bytes, whether its values are
  stored, absent or `sparse` —, plus each primitive's index buffer; only these bytes, which no
  compilation order lowers, refuse a job. Primitives then compile in consecutive waves whose working
  sets (the DAG, and the collider cook and page packing running beside it) fit in what the budget
  leaves after what the job keeps to the end (each page's manifest record, its culling and structure
  entries and their published text): a scene that fits is one wave, a tighter budget smaller waves,
  down to one primitive at a time, never refused (`compiler_budget/waves.rs`); what one worker holds
  whatever the scene — a collider tile with Jolt's cook of it, a bundle being packed — is charged
  once per thread. Each cost derives from the primitive's triangle and vertex counts
  (`compiler_primitive/cost.rs`). The waves only order the work: the bytes written are the same
  whatever the waves. Estimates, not a process cap (`unsupported: "hard RSS enforcement"`).
- Texture baking reads image dimensions before pixels, through each format's header reader. Images
  run in deterministic waves cut by the same planner, whose estimated encoded source, expanded
  container payload, decode intermediates, alpha-distance buffer, mip pyramid, PNG output, block
  read-back and temporary tails fit in the RAM left after the source and geometry estimate. Every
  returned preview tail is reserved before the first wave, copies for textures sharing an image
  included. An image or the retained tails exceeding that fails with
  `RAM_ADMISSION_BUDGET_EXCEEDED` — never a white substitute or a lower resolution. Cancellation is
  checked during planning and between images.
- The source buffer is memory-mapped when it is a single external `.bin` or a GLB's single BIN
  chunk; multi-buffer sources are copied.
- The FBX/OBJ importer holds the whole ufbx scene, then streams the glTF out: roughly 3–4× the
  source size during import.
- A batch's process memory is the sum of its running workers; size `workers` accordingly.

## Exit codes and error codes

Exit code 0: every job ready. Exit code 2: usage error, invalid batch, or at least one job failed or
cancelled — stdout then carries the error or the [batch summary](#batch-mode).

A refusal raised while a primitive compiles starts `Mesh <m> primitive <p>: ` (source glTF mesh and
primitive), since page ids restart at 0 in every primitive; a cancellation keeps its message. A
ceiling exceeded is refused before allocating.

Every code, global and per driver and of the Node adapter, has a stable public code, one sentence,
its cause and the action to take, one page per code: [COMPILER_ERRORS.md](COMPILER_ERRORS.md). An
error publishes nothing; a warning is always told and never stops a compile that can succeed; an
info is told on request. The catalogue is `packages/sdk-node/src/messages/messages.json`, embedded
in the compiler, read by the Node adapter, and the source of the pages
(`pnpm run generate:messages`).

## Using it from Node

`trillion3d` resolves to a thin Node relay over the executable
([`packages/sdk-node/src/index.mts`](../packages/sdk-node/src/index.mts)):

```ts
import { prepare, prepareMany, type CompilationResult, type PrepareOptions } from 'trillion3d';

// One model: events → onProgress, pointer read from stdout, manifest read back from disk.
const options: PrepareOptions = {
  resourceBaseUrl: '/assets/city/',
  threads: 8,
  ramBudgetMb: 8192,
  simplification: 'qem-endpoints',
  signal: controller.signal, // abort → {"cancel":"*"} on stdin, kill after 5 s
  onProgress: (event) => console.log(event.event, event.phase),
};
const result: CompilationResult = await prepare(
  'scenes/city/city.obj',
  'cache/city',
  'full',
  150000,
  options,
);
result.pointer; // path of native/full/manifest.json
result.selectedTriangles; // from clusters.json

// Many models in one process.
const summary = await prepareMany(jobs, { workers: 4, ramBudgetMb: 32768, threads: 4, onEvent });
summary.jobs[0].pointer; // pointers only; nothing is read from disk
```

`createTerminalProgress({label, index, total, verbose})` returns an object whose `event` method
takes every compiler event and draws one live line (spinner, bar from `ratio`, phase, elapsed) on a
TTY, one plain line per phase change elsewhere; `createBatchProgress()` does it per job for
`prepareMany({onEvent})`; `progress.note(text)` shows a host-side step before the compiler starts.
The warnings of a job are counted while it compiles and told once when it ends, one line per code —
its public code, count, worst case, action and documentation page; info codes stay silent unless
`verbose`, which also lists every occurrence under its code. A reused folder tells the same warnings
as the compile that wrote it. The `trillion3d-compile` CLI uses it on a TTY and prints raw JSON
events on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them), followed by the same summary as
`{"event":"message", "id", "code", "level", "count", …}` events. `--verbose` adds the info codes and
every occurrence; `--strict` exits 3 when the compile succeeded with a warning (`STRICT_WARNINGS`),
the cache written; any failure exits 1.

```js
const progress = createTerminalProgress({ label: 'city', index: 0, total: 8 });
await prepare(source, cache, 'full', 150000, { resourceBaseUrl, onProgress: progress.event });
// ⠹ 1/8 city [██████████░░░░░░░░░░░░░░]  42% clustering 118/281 primitives 6.2s
// ⚠ city T3D-W003 DAG_FLAT ×2: A primitive of several clusters built no coarser level, … Worst: mesh 7/0, 98 roots of 98 pages. Look at …
// ✔ 1/8 city 1,132,930 triangles, 412 primitives, 3395 ms 4.1s
```

The executable is `options.executable`, else the one of the installed platform package, else
`TRILLION3D_COMPILER_BIN` (trusted, announced once on stderr), else
`packages/asset-compiler-rust/target/release/`, refused with `COMPILER_STALE` while a crate source
is newer than that build, so no cook publishes under the previous build's key
(`pnpm run build:native` rebuilds it). Outside a checkout, a platform none of them serves is refused with
`COMPILER_PLATFORM_UNSUPPORTED` and the supported list, and a supported one whose package is not
installed (optional dependencies omitted, a Linux on musl) with `COMPILER_EXECUTABLE_MISSING` and
the package's name; each error carries its public code and a link to its page
([COMPILER_ERRORS.md](COMPILER_ERRORS.md)). Node never buffers a manifest, whatever the model size.

### Platform packages

The compiler is built for macOS arm64 and x64, Linux arm64 and x64 (glibc) and Windows x64, each
shipped as its own package, `@trillion3d/compiler-<os>-<arch>` (`packages/compiler/`), declared in
the `optionalDependencies` of `trillion3d`: an install takes only its machine's one. The `Compiler`
workflow builds the five on their own runners (`scripts/compiler-dist.ts`): the `dist` profile, the
release one with fat LTO, abort on panic and stripped symbols (the checkout's build and the tests
keep the quicker release profile), mimalloc as the allocator of the Rayon workers, and
profile-guided optimisation trained on the two reference scenes (`scripts/compiler-hashes.ts`). The
macOS arm64 build assumes the Apple M1; an x86-64 build keeps its baseline and runs the page
quantizers in AVX2 where the processor has it (`shared_math::wide`). No fused multiply-add anywhere
— Rust never fuses, C and C++ are built with `-ffp-contract=off`, Jolt in its cross-platform mode —,
so every platform writes the same bytes: the workflow compiles the reference scenes with each binary
and compares every cache file's SHA-256 with Linux x64's and, on a pull request, `develop`'s. Only
the Jolt collider shapes may differ from a base whose Jolt cook still fuses multiply-adds.

## Using it from any other host

Spawn the executable, read stderr line by line and stdout once at exit, write a cancel line on stdin
when asked: the whole contract, the same on macOS, Linux and Windows. A library host can call
`trillion3d_compiler::compile(&Options, progress)` from Rust directly (`main.rs` is a thin layer
over it); an N-API or WebAssembly binding is not provided (`unsupported: "N-API binding"`).

## Deformation streams

The glTF reader retains joints, inverse bind matrices, morph targets and animation channels; the FBX
driver carries skin clusters, blend shapes and keyed animation through its glTF intermediate, its
driver identity in the import key. Skeletal and morphed opaque and alpha-blended geometry enters the
DAG and streaming path: the compiler carries per-vertex joint/weight and target attributes through
vertex permutations and QEM source origins, and measures joint rest balls and target displacement
radii for runtime conservative bounds. Animated scenes keep the prepared source tables; no
autonomous scene is claimed when it would discard animation. For cooked cloth, rope and soft volumes
the compiler applies the physics cook's weld and compact mapping to the render vertices
(`softSourceIds` on a whole-copy primitive, `geometry_page_deform/reach.rs`), and the page writes
the simulation back into them; simplified vertices retain their source offset, and runtime
displacement bounds add conservative transfer error until finer resident pages can be selected. A
cooked soft primitive also declaring skin/morph sources is refused with `SOFT_DEFORMATION` rather
than giving one stream two meanings. The page and sidecar format (flags 16/32/64,
`render.version: 1`): [FORMAT.md](FORMAT.md#deformation-in-geometry-page-format-7).

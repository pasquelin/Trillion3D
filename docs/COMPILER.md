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

[Invocation](#invocation) · [The three streams](#the-three-streams) · [Events](#events) · [The
pointer](#the-pointer) · [Reusing a compiled folder](#reusing-a-compiled-folder) ·
[Measurements](#measurements) · [Batch mode](#batch-mode) · [Cancellation](#cancellation) · [FBX and
OBJ import](#fbx-and-obj-import) · [USD and USDZ import](#usd-and-usdz-import) · [Input
formats](#input-formats) · [Adding a format](#adding-a-format) · [Cache layout](#cache-layout) ·
[Cutouts declared as blend](#cutouts-declared-as-blend) · [Memory and threads](#memory-and-threads)
· [Exit codes and error codes](#exit-codes-and-error-codes) · [Using it from
Node](#using-it-from-node) · [Using it from any other host](#using-it-from-any-other-host) ·
[Deformation streams](#deformation-streams)

## Invocation

```
trillion3d-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL
trillion3d-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints] [--textures-format=bc7|astc|both|none]
trillion3d-compiler --jobs FILE|-
trillion3d-compiler --version
```

| Argument            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Default                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `SOURCE`            | A file or folder a driver recognises: a directory with `manifest.json`, a `.gltf`/`.glb`, a scene of one of the formats above, a container (`.usdz`, `.unitypackage`, `.zip`), or a directory of such files, merged into one scene. Unknown or ambiguous: refused with the list of accepted formats                                                                                                                                                                 | required                         |
| `CACHE`             | Output directory, created if missing; one pointer per scope, pruned after each compile ([The pointer](#the-pointer)), so one source at a time; a busy cache is waited for, then refused (`CACHE_LOCKED`)                                                                                                                                                                                                                                                            | required                         |
| scope               | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything                                                                                                                                                                                                                                                                                                                                                                               | `slice`                          |
| triangles           | Triangle budget for `slice`; ignored by `full`                                                                                                                                                                                                                                                                                                                                                                                                                      | `150000`                         |
| threads             | Worker threads for clustering and simplification (1–64)                                                                                                                                                                                                                                                                                                                                                                                                             | `2`                              |
| `RAM_MB`            | Admission budget: a job whose estimated working set exceeds it is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`); a guard, not an enforced limit                                                                                                                                                                                                                                                                                                                         | `256`                            |
| `RESOURCE_BASE_URL` | URL prefix under which the host serves the **source** directory; relative image URIs are rewritten against it                                                                                                                                                                                                                                                                                                                                                       | required                         |
| simplification      | `none`: exact clusters only, one DAG level, every cluster a root; `qem-endpoints`: the coarser levels above them                                                                                                                                                                                                                                                                                                                                                    | `none`                           |
| `--textures-format` | `bc7\|astc\|both\|none`: the block family cooked beside the lossless levels (`none`: lossless only), under the quality gate of [FORMAT.md](FORMAT.md#textures). Cost is the encode and its read-back, block rows in parallel on the job's pool: Emerald from an empty cache, 8 threads, 17.9 / 18.8 s wall without a family (two runs), 26.1 / 25.9 s `bc7`, 31.4 / 39.0 s `astc`; an existing level file is not encoded again, so a recompile pays the tails alone | `bc7` (a cook runs on a desktop) |

Examples:

```sh
trillion3d-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
trillion3d-compiler scenes/london cache/london full 150000 8 8192 /assets/london/ qem-endpoints   # a folder of FBX files
trillion3d-compiler scenes/emerald cache/emerald full 150000 8 32768 /assets/emerald/ qem-endpoints # a glTF folder with manifest.json
```

`simplification` says what the DAG may hold, not how fast it is built. In `none` it stops at level
0: the clusters partition the source triangles exactly, every one a root, and `"simplification":
false` in the manifest means no cluster carries a surface the source lacks. In `qem-endpoints` each
level groups 8 to 32 clusters, simplifies the group with its border locked and re-splits it; level 0
is the same in both modes.

It is meshoptimizer's reference DAG (`clusterlod.h`): absolute error counting normals (weight ½) and
carried texture sets (weight 1) against positions normalised to the group's extent, clamped to it;
permissive across hard edges, texture seams protected; disconnected parts pruned once the error
passes them. Copies a page cannot tell apart (same position and carried attributes) become one
vertex, the group's first copy, before reduction, so a coarse page names only vertices its children
draw; no other weld remains. A part removed whole (a column, an arch) costs the diameter of its
bounds plus its distance to the surface kept, so it drops only at a level whose error is that wide,
and a roof of shingles each under the error keeps a cover within it. A coarse corner takes the copy
of its position and texture coordinates whose normal is its face's, among those a face turned its
way draws. A reduction shading a face from behind, or leaving a corner no such copy, is retried with
that face's surroundings locked while a retry locks something new; one losing a vertex shared with
another group is retried, three times at most, without pruning (which ignores locks).

A stalled group diagnosed `seam-locked` (below) is retried with solved vertices (Hoppe 1999;
meshoptimizer's `simplifyWithUpdate`, `dag/solved.rs`); other groups keep the endpoint reduction, so
primitives without one are unchanged. The retry keeps the level's locks; any seam corner may
collapse with all its copies; each surviving position moves to its quadric's minimum and each copy
gets its own texture coordinate and normal solved there (renormalised). A texture set weighs the
surface length one unit of it spans in the group — the square root of surface area over texture area
—, so a sliding coordinate costs the distance its texture moves; normals keep their weight. On the
open border, where meshoptimizer keeps seam corners in place, a position's copies point at one of
them, and the largest coordinate step that costs, times its set's density, joins the group's error.
A placed vertex belongs to the texture island of the source vertex it was solved from; a coarse face
whose corners lie in two islands is charged its longest edge, by this solve and any later reduction
of its vertices, so it is drawn only where it covers under a pixel. The retry runs the endpoint
reduction's checks and retries (`dag/retries.rs`: lost locks, faces lit from behind but those no
longer than the error, parts removed whole) and is kept when it yields fewer clusters. Its error is
measured as every reduction's (`dag/measured.rs`): parts removed whole, sampled Hausdorff distance
and texture deviation from the group's triangles to the solve's, so a solved group never publishes
less than the surface it draws. Its vertices are appended after the primitive's (indices from the
source's vertex count on), read by pages, the cook's checks, the collider and the proxy;
`source.bin` stays the source buffer.

Before publishing, the cook refuses a DAG (`DAG_ERROR_NOT_MONOTONE`, `DAG_NORMAL_DEVIATION`) where a
cluster's error exceeds its parent's, or a coarse cluster's normal deviation passes its group's
bound. A triangle's normal deviation is the angle between its face normal and the mean of its corner
normals, which shades its centre; triangles no wider than their level's error, and slivers thinner
than a thousandth of their longest edge, are exempt. A group's bound is 90° (past it a face is lit
from behind) or, if larger, the worst deviation among the level-0 triangles it descends from, so one
inverted source triangle raises only its own groups' bound. The reduction holds each group to that
bound without the width exemption — any face but a sliver turning past it is retried with locks —,
so a long thin coarse face never comes out inside out. The cook is the same bytes on every platform:
the root `.cargo/config.toml` builds meshoptimizer's C++ with `-ffp-contract=off` (arm64 otherwise
fuses multiply-adds and rounds apart from x86_64), the arc cosine is the `libm` crate's (the
platform's last bit differs between macOS and glibc), and a test pins a cooked fixture's digest. The
report publishes per level `errorMax`, `normalDeviationMax` and `rootTriangles`, what the level adds
to the root cover no budget goes under.

Pages are packed into streaming bundles of 128 KiB, each listing the bundles holding its clusters'
parents, closed up to the pinned root cover ([FORMAT.md](FORMAT.md#cluster-dag), `streams`). Packing
keeps the list short — one level per bundle, coarsest first, siblings together — under a bound fixed
before packing, `streams.dependencyBound`, the most parents one cluster has: a bundle closes early
rather than exceed it, and a cluster that alone would is refused (`PAGE_DEPENDENCY_BOUND`). The
bound is on direct parent bundles; `streams.maxDependencies`, the longest closed list, is a
statistic. The cook refuses (`INVALID_PAGE_DEPENDENCIES`) a cycle, a page whose parents' bundle is
missing from its bundle's list, a list not closed or not reaching the root cover, and a pinned
bundle with any dependency; the message names the mesh and primitive, then the page or bundle.

### The corpus

The DAG builder is proved on a generated corpus, `packages/asset-compiler-rust/src/tests/corpus/`:
each case's shape, texture layout and parameters are drawn from a seed, nothing hand-picked or read
from disk. Five families — `uv` (where chart seams fall, a second set with seams of its own),
`attributes`, `topology`, `materials` and `inputs` (index widths, sparse and quantized positions,
millimetre, metre and kilometre scales) —, cases listed below.

On each of two seeds every case asserts:

- level 0 is the source partition — the same triangles, each exactly once;
- every coarse index names a vertex the source uses, or one a seam-locked group's solve placed
  after them;
- every LOD error is finite and never exceeds its parent's;
- no coarse triangle a pixel shows spans two texture islands of a sampled set: a triangle across
  two islands is no longer than its cluster's error, and a solved vertex lies in its source vertex's
  island; a seam whose sides connect elsewhere (a wrap column) is one island;
- the primitive reaches a single root, with no stalled group;
- every page decodes back to its positions and attributes within its declared error;
- the compiled cache agrees with the in-memory DAG, root for root, and `source.bin` is the source
  buffer byte for byte, view by view.

A set no material samples stays out of the pages and the seam weld: `uv-second-set-unread`
(`uv-second-set-with-own-seams` with the second set unread) reaches one root, page for page the DAG
compiled without that set.

A stalled group is named by experiment, never by threshold: the builder reruns the stalled reduction
with one constraint lifted at a time, discards the result (the DAG is the one built without reruns)
and keeps the first cause that holds:

| Cause            | The group…                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `too-small`      | holds fewer than two live triangles: nothing to halve                                                                                                                                                            |
| `border-locked`  | advances when rerun with no lock: positions shared with neighbouring groups hold it                                                                                                                              |
| `seam-locked`    | still stalls with no lock, and advances with its position copies welded across the seams of every carried texture set; retried with solved vertices, it stays stalled only if that retry does not advance either |
| `unreducible`    | advances under neither rerun: the surface itself resists halving                                                                                                                                                 |
| `border-lost`    | lost a shared position on every retry with added locks                                                                                                                                                           |
| `unusable-error` | received a non-finite error from the simplifier                                                                                                                                                                  |

Every case guarantees one root on both seeds, except `inputs-quantized-positions`, refused
`INVALID_GLTF` ("POSITION must be float VEC3") because `KHR_mesh_quantization` is not read. A
refusal is checked against the code the case expects; a panic, another code, or an unexplained flat
DAG fails. The cases:

- `uv`: `uv-one-island`, `uv-island-per-face`, `uv-island-per-brick`, `uv-atlas-of-islands`,
  `uv-mirrored-halves`, `uv-tiled-beyond-unit`, `uv-second-set-with-own-seams`,
  `uv-second-set-unread`, `uv-zero-area-triangles`, `uv-all-at-one-point`, `uv-none`;
- `attributes`: `attributes-hard-normals`, `attributes-smooth-normals`, `attributes-colour-steps`,
  `attributes-tangents`, `attributes-every-one`;
- `topology`: `topology-closed-manifold`, `topology-open-borders`, `topology-non-manifold-edges`,
  `topology-t-junctions`, `topology-unwelded-duplicates`, `topology-degenerate-triangles`,
  `topology-thin-strip`, `topology-slats`, `topology-smaller-than-cluster`,
  `topology-exactly-one-cluster`, `topology-huge-flat-plane`, `topology-high-curvature`,
  `topology-slivers`;
- `materials`: `materials-several`, `materials-alpha-masked`, `materials-blended`,
  `materials-double-sided`;
- `inputs`: `inputs-indices-u8`, `inputs-indices-u16`, `inputs-indices-u32`, `inputs-unindexed`,
  `inputs-sparse-positions`, `inputs-quantized-positions`, `inputs-large-offset`,
  `inputs-millimetre-scale`, `inputs-kilometre-scale`.

`uv-island-per-face`, `uv-island-per-brick`, `uv-second-set-with-own-seams` and
`attributes-every-one` make every vertex a seam corner: lifting locks frees nothing, welding seams
frees the groups, which are `seam-locked` and climb to one root on solved vertices.
`topology-high-curvature` stalled under meshoptimizer 0.22 on seam positions at its poles and wrap
column; 0.25 slides past them.

Run it with `cargo test --release corpus --manifest-path packages/asset-compiler-rust/Cargo.toml`:
42 cases, 5 families, two seeds each, under 4 s.

A glTF document renders one scene (glTF 2.0 §3.5): the one `scene` names, else the first of
`scenes`. Only nodes reachable from its roots are compiled — node selection, the resident proxy and
`lights.json` read that set, so a mesh or `KHR_lights_punctual` lamp in another scene, or none, is
left out. A document with **no** (or empty) `scenes` compiles every root of the node hierarchy, and
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
([`CACHE_LOCKED`](COMPILER_ERRORS.md#global)):
milliseconds, `0` refuses at once, anything unreadable is ignored.

| Stream | Content                                            | Size                                    |
| ------ | -------------------------------------------------- | --------------------------------------- |
| stderr | One JSON object per line, one line per event       | a few KB per job (Emerald: 26 KB)       |
| stdout | The pointer for one job, or the batch summary      | under 1 KB per job (Emerald: 663 bytes) |
| stdin  | Optional cancel requests, one JSON object per line | —                                       |

The manifest (`clusters.json`, hundreds of KB to MB) is **never** printed; the pointer says where it
is. A host may ignore stdin.

## Events

Every stderr line is `{"event": <kind>, "job": <id>, ...}`; the job id is `"job"` for a single
invocation, the batch file's id in batch mode, `"*"` on batch-level lines. `accepted`, `progress`
and `complete` carry `ratio`, a whole-job completion estimate from 0 to 1 that never goes backwards,
so a host draws one bar without knowing the phases: source import up to 0.30, glTF import 0.35,
clustering 0.35–0.95 over the primitives the `import` event announced, root bundles 0.95–0.96,
coplanar cuts 0.96–0.965, texture levels 0.965–0.97 one image per step, resident proxy 0.97, lights
0.98, prune 0.99, pointer 1. An unknown phase keeps the last ratio, and importing several files does
not restart the bar.

| `event`     | When                                     | Extra fields                                                                                                                                                                                                          |
| ----------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`     | Once, first line of `--jobs`             | `jobs`, `workers`                                                                                                                                                                                                     |
| `queued`    | Once per job in a batch, before any work | `source`                                                                                                                                                                                                              |
| `accepted`  | A worker starts the job                  | `source`, `cache`, `scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification`                                                                                                                                   |
| `progress`  | During the job                           | `phase` and its fields, below                                                                                                                                                                                         |
| `stall`     | The job succeeded, before `complete`     | one line per row of the manifest's `worstStalls` ([FORMAT.md](FORMAT.md)), in order: `rank`, `index`, `mesh`, `primitive`, `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands`; in batch mode too |
| `complete`  | The job succeeded                        | `pointer` (same object as stdout), `ms`                                                                                                                                                                               |
| `cancelled` | The job stopped on a cancel request      | `status:"error"`, `code:"CANCELLED"`, `message`, `ms`                                                                                                                                                                 |
| `error`     | The job failed                           | `status:"error"`, `code`, `message`, `ms`                                                                                                                                                                             |
| `done`      | Once, last line of `--jobs`              | `completed`, `failed`, `cancelled`, `ms`                                                                                                                                                                              |

Progress phases, in order:

| `phase`         | Fields                                                                                                                                                                                                                                  | Meaning                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import-source` | `step` = `parse` (`file`, `index`, `files`, `completed`, `total` in bytes) → `meshes` (`completed`, `total` in nodes) → `write` (`bytes`) → `complete` (`key`, `triangles`, `meshNodes`, `ms`), or `reused` (`key`) for a reused import | FBX/OBJ only                                                                                                                                                                                                    |
| `import`        | `completed`, `total`, `ms`, `primitives`, `nodes`                                                                                                                                                                                       | glTF loaded and validated, source geometry written; `primitives` `primitive` events follow                                                                                                                      |
| `primitive`     | `mesh`, `primitive`, `pages`; on a DAG primitive `timings` (elapsed ms of its stages, each from the end of the one before: `dagMs`, `cullingMs`, then `physicsMs` and `pagesMs` side by side, `reportMs`); `warnings` if any            | One primitive clustered and paged (primitives run in parallel, in no fixed order)                                                                                                                               |
| `bootstrap`     | `completed`, `total`                                                                                                                                                                                                                    | Root bundles assembled                                                                                                                                                                                          |
| `textures`      | `completed`, `total`                                                                                                                                                                                                                    | One source image decoded, its mip chain baked for every atlas reading it, its levels written                                                                                                                    |
| `cutouts`       | `pending`, `sheet`                                                                                                                                                                                                                      | Cutout sheet written; `pending` textures still unanswered, `sheet` its path                                                                                                                                     |
| `proxy`         | `triangles`, `nodes`, `errorMetres`                                                                                                                                                                                                     | Resident proxy built                                                                                                                                                                                            |
| `lights`        | `lights`, `rejected`, `counts`                                                                                                                                                                                                          | Scene lights written; `rejected` lamps left out, `counts` what was filled in or omitted on a lamp kept                                                                                                          |
| `reuse`         | `completed` (1 reused, 0 refused), `files`, `fileBytes`, `objects`, `objectBytes`, `textureLevels`, `validateMs`, or `reason`                                                                                                           | The key's folder was proven and kept — no `import`, `primitive`, `textures`, `proxy` or `lights` follow — or refused for the named reason and rebuilt ([Reusing a compiled folder](#reusing-a-compiled-folder)) |
| `prune`         | `removedKeys`, `removedObjects`, `removedBytes`, `removedTextures`, `removedTextureBytes`                                                                                                                                               | Stale keys, imports, orphan objects and texture levels removed (emitted only when something was)                                                                                                                |
| `complete`      | `completed`, `total`, `pruned`                                                                                                                                                                                                          | Pointer written; `pruned` summarises the prune                                                                                                                                                                  |

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
  "reused": null
}
```

`pointer` is the file the browser explorer needs (`manifestUrl`); `url` is relative to
`native/<scope>/`. `reused` is `null` when the job wrote the folder; for a proven and kept one it
carries the proof's counts (`files`, `fileBytes`, `objects`, `objectBytes`, `textureLevels`,
`validateMs`), `metrics.clusterHierarchyPagesMs` is `null` (no hierarchy built) and
`metrics.importMs` runs to the decision — routing, loading, key and proof (`reused.validateMs` is
the proof alone). On failure stdout carries `{"status":"error","code":…,"message":…}` ([exit
codes](#exit-codes-and-error-codes)).

A cache never needs wiping: after every successful job the compiler removes the scope's other keys,
stale FBX/OBJ imports, and every object under `objects/` and texture level no surviving manifest
(either scope) references (`compiler_prune.rs`). Deleting a large cache by hand costs tens of
seconds (Emerald: 80 000 files); recompiling over it costs nothing extra.

`key` is a SHA-256 over what the source declares, the resources the compile consumes and the options
shaping the output: the source manifest, the source binary, **every image the scene links by
relative URI** (its fingerprint, `null` when absent), declared sidecars, the compiler version, the
compiler's fingerprint (its source modules, `Cargo.toml` and `Cargo.lock` at build time), the
error-model identity (`dag-group-qem-v3`), scope, budget, `RESOURCE_BASE_URL` and simplification.
External image bytes are neither embedded in the manifest nor hashed into the geometry — their
SHA-256 is, and the baked levels under `native/textures/` are addressed by it; hosts own their
resource identity. Any change gives a new `<key>` directory, which the pointer names and the prune
keeps alone.

Deliberately **outside** the identity, at every level of the manifest: measured durations
(`importMs`, `parseMs`, `ms`) and the converting machine's absolute path (`path`) — they describe a
run, and hashing them gave three keys for three identical compilations. Everything else a driver
writes enters the key, later fields included (forgetting to exclude a field tightens the identity;
forgetting to include one would loosen it). So the same inputs and options give the same key on any
machine and cache, and replacing a linked texture beside an unchanged scene gives another, since the
column files' previews are read from its pixels. The cost is one streaming hash per linked image,
once per compile.

## Reusing a compiled folder

A folder under the key holds the bytes the job would write. Once the source is keyed, before the
first primitive, the compiler looks for `<scope>/<key>/clusters.json`: absent, it compiles; present,
it **proves** the folder with the compile path's own checks (a fingerprint where it fingerprints,
presence for level files it trusts by name), keeps it and skips to the pointer and prune:

| Checked                        | Against                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The manifest head              | `status`, `key`, `scope` and `compilerVersion` of this job; a `formatVersion` this compiler writes. Another build's folder under the key is refused                                                                                                                                                                                                 |
| The manifest's pages           | Their slots in the root, and each column file its page's `binary`                                                                                                                                                                                                                                                                                   |
| Every other product            | The manifest's `files` record — `source.gltf`, `source.bin`, `proxy.bin`, `lights.json`, `scene-tables.json`, `scene.gltf`, `scene.bin` — by size and SHA-256; no record, no proof. A partitioned scene's cells against the records its pages hold, each page against its slot                                                                      |
| Every object the sidecar names | Its content-addressed name, hashed on the job's pool                                                                                                                                                                                                                                                                                                |
| Every baked texture level      | Its presence under `textures/v<N>/<sha256>/` — the lossless file and the block file of every family the layout word keeps —, once per (image, atlas); a bake the compile could not finish (`texturePreviews.notes.texture-level-write-failed`, or fewer levels baked than the sidecar tail starts at) is refused, since a reuse would never bake it |
| The cutout answer sheet        | Its presence at the cache root (`decoupes.json`): every compile writes it, and a host reads "nothing to answer" in its absence                                                                                                                                                                                                                      |

A failed check names its reason on `reuse` (`completed: 0`) and the job compiles, overwriting the
folder. A proven folder yields `reused` on the pointer and `reuse` with `completed: 1`; neither the
manifest (its `metrics` still describe the compile that produced it) nor the answer sheet is
rewritten — an answer that changes the product changes the key. A folder from a compiler that wrote
no `files` record is never reused; its key differs anyway, the compiler's sources being in it.

A reuse costs the identity (routing, loading, hashing the source binary and linked images) plus the
proof (hashing every product and object). Measured 2026-09-21, 8 threads, `full 150000`,
`qem-endpoints`, one shared machine (load 25–39 on 12 cores, so each pair ran back to back): warm
recompile of an unchanged source with `develop` at c21647cd against a reuse with #47's branch at
421b1cc0, three pairs, `wallMs` in s. The proof, reshaped into one pool pass over files and objects
at 6fd914dc, was re-measured twice on Emerald under load 47–84: recompile 30.6 · 21.4 s, reuse 6.7 ·
5.8 s, proof 2.2 · 2.0 s — the pairing holds, the table stands.

| Scene                                                                       | Recompile before (s) | Reuse after (s)   | of which proof (s) |
| --------------------------------------------------------------------------- | -------------------- | ----------------- | ------------------ |
| Emerald — 10 M triangles, 83 303 objects (388 MB), 200 MB of products       | 9.8 · 13.1 · 12.1    | 5.4 · 5.9 · 7.8   | 2.3 · 2.3 · 2.4    |
| Whisperwind — 172 M triangles, 229 013 objects (737 MB), 285 MB of products | 15.8 · 24.1 · 14.9   | 11.1 · 15.7 · 9.4 | 7.0 · 8.9 · 5.9    |

Every reuse beats its paired recompile; on Whisperwind the proof dominates, its 229 013 small
objects costing more to open than to hash. The compile pays the `files` record once — each product
hashed as written, never read back: 200–285 MB here, under the run-to-run spread.

## Measurements

A job's durations are its own: its counters are created with the compilation, adopted by its own
pool's threads and read by nobody else, so two jobs of one batch never describe each other's work.

| Field                             | Where                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metrics.importMs`                | manifest and pointer         | Source routed, loaded, validated, its geometry copied                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `metrics.clusterHierarchyPagesMs` | manifest and pointer         | Clustering, paging, coplanar cuts, resident proxy and lights                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `metrics.compileMs`               | manifest                     | Wall time until the manifest is serialized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `metrics.pruneMs`                 | pointer                      | Wall time of the prune after publication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `metrics.phaseElapsedMs`          | manifest                     | Elapsed time per phase, summed over worker threads; the texture stage publishes `textureDecodeMs`, `textureBakeMs` (chains, block encodes and their gate read-back), `textureWriteMs` and `textureAlphaMs` — Emerald from an empty cache, 8 threads, `--textures-format=bc7`: 7,2 s, 72,0 s, 68,3 s and 0,6 s inside 26,1 s wall; without a family (develop's compiler, same machine, same evening) 6,7 s, 6,3 s, 64,2 s and 0,6 s inside 17,9 s — the write column is the PNG levels, paid once per image whichever family |
| `metrics.wallMs`                  | pointer and `complete` event | Wall time of the whole job, after the manifest is written and the cache pruned                                                                                                                                                                                                                                                                                                                                                                                                                                              |

`clusters.json` is written before the prune, so it carries `compileMs`, never `wallMs`; the pointer
and `complete` carry `wallMs` and `pruneMs`, and `wallMs` ≥ `compileMs + pruneMs`; it bounds a
single phase only when one thread did the work. The `phaseElapsedMs` phases **overlap** and are
elapsed time on the `wallMs` clock, not CPU: a wait, disk write or descheduled thread lands in the
open phase (a host callback sleeping 250 ms adds 250 ms). Summed across threads, with `threads > 1`
their total can exceed `wallMs`, and adding phases is meaningless. Nothing measures processor time;
`cpuMs` and `diskBytesRead` stay `null`. `peakRssBytes`, the process's peak resident memory
(`getrusage`), is in the manifest and on every progress event — the first event where it jumps names
the stage that raised it; it is shared by a batch's concurrent jobs.

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

| Field                                                                   | Meaning                                                                        | Default                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `workers`                                                               | Concurrent jobs (1–64), lowered until the budget holds them                    | `1`                                                  |
| `ramBudgetMb`                                                           | Total admission budget, split evenly between workers unless a job sets its own | `256 × workers`                                      |
| `threads`                                                               | Default threads per job                                                        | `2`                                                  |
| `jobs[].id`                                                             | Unique job id in events and the summary                                        | `job-<index>`                                        |
| `jobs[].source`, `cache`, `resourceBaseUrl`                             | As on the command line                                                         | required                                             |
| `jobs[].scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides                                                              | `full`, `150000`, batch default, batch share, `none` |
| `jobs[].texturesFormat`                                                 | As `--textures-format=`                                                        | `bc7`                                                |

Jobs go in file order to the first free worker. stdout at the end:

```json
{"status": "ready" | "partial" | "failed", "completed": 2, "failed": 0, "cancelled": 0,
 "jobs": [{"job": "city", "status": "ready", "pointer": {…}}, {"job": "x", "status": "error", "code": "IMPORT_IO_ERROR", "message": "…"}]}
```

`jobs` is sorted by id; `status` is `partial` when some but not all jobs are ready, `failed` when
none is. The summary is always printed, so a host reads it rather than the exit code (2 unless every
job is ready — the normal outcome of a partial batch, not a process failure). Only a batch file
refused outright prints `{"status":"error","code":"INVALID_BATCH",...}`, with no `jobs`.

Two jobs may not write one cache: each prunes it after publishing, erasing the other's result.
Destinations are compared by identity — the longest existing prefix canonicalized, symlinks
included, the absent suffix normalized (`.`, `..`, doubled separators) — so `x` and `p/../x` are one
cache, and the batch is refused (`INVALID_BATCH`) before any job starts, naming both jobs and
spellings.

`ramBudgetMb` budgets the **whole batch**. No job is admitted under 64 MiB, so `workers` is lowered
until every set of jobs that could run together fits: `workers: 2` with `ramBudgetMb: 64` runs one
job at a time with 64 MiB. Per-job overrides count the same way (the largest that would run together
must fit); a job asking for more than the whole batch, or a total under 64 MiB, is refused with
`INVALID_BATCH` before anything starts. The `batch` event publishes the concurrency admitted, each
`accepted` event its job's share — an admission estimate, not an enforced RSS ceiling.

For thousands of models: one batch file, `workers` sized to the machine, `ramBudgetMb` what it can
give; each job has its own pool of `threads`, so `workers × threads` is the CPU ceiling.

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
first imported into the cache:

```
<CACHE>/native/imports/<import-key>/
  model.gltf       plain glTF 2.0 (nodes with world matrices, meshes, materials, images, lights)
  model.bin        geometry (+ embedded images as buffer views)
  manifest.json    source manifest read by the compile step, plus an import report
```

`<import-key>` hashes every input file, the driver's name and version, **every other file the reader
opened** (the `.mtl` an OBJ cites, absence included) **and every image path the texture resolution
tried** — path, existence, bytes: the reader never opens an image, but its presence picks the
intermediate glTF's URI, and leaving images out once served a scene compiled before its image
existed. An unchanged source and driver is imported once and reused (`import-source/reused`); a
touched, deleted or new material library **or texture** gives another key. The import manifest lists
only the files the reader opened; what the resolution kept is in `images`. The compile then treats
the import like a hand-made glTF folder.

What is carried:

| Source                                         | glTF                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Positions, normals, one UV set, one colour set | `POSITION`, `NORMAL` (generated when missing), `TEXCOORD_0` (V flipped), `COLOR_0`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Polygons                                       | Triangulated by ufbx; indices `u16` under 65 536 vertices, else `u32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Units and axes                                 | Metres, right-handed, Y up (FBX `UnitScaleFactor` and axis system honoured; OBJ assumed metres, Y up)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Instances                                      | One glTF mesh per (mesh, material list), one node per instance with its world matrix (`geometry_to_world`, geometry transforms and pivots baked)                                                                                                                                                                                                                                                                                                                                                                                                 |
| Materials                                      | `pbrMetallicRoughness` from ufbx's unified PBR view (Phong, Lambert, Arnold, Stingray, 3ds Max, OpenPBR, MTL…): base colour + alpha, metallic, roughness (glossiness inverted), emissive, normal, occlusion, metallic-roughness when one texture carries both; `doubleSided`; `alphaMode` `BLEND` when opacity < 1 or an opacity texture is bound, **never** `MASK` — no import format declares a cutoff, and clipping a transparent material loses fidelity. A bound texture replaces the colour factor (FBX semantics). Default roughness: 0.6 |
| Map options (MTL)                              | `-clamp on` sets the sampler's edge mode on both axes; `-o`, `-s` and `-bm` are counted, not applied                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Textures                                       | PNG/JPEG resolved inside the source directory (declared absolute, relative or bare name; then `textures/`; then a `.png`/`.jpg` sibling of a DDS/TGA/…); embedded bytes become buffer views; wrap modes → sampler. Referenced by a **URI** relative to the source directory, percent-escaped per glTF (a name with `%`, `#`, `?` or a space survives), served under `RESOURCE_BASE_URL`                                                                                                                                                          |
| Lights                                         | Point, directional, spot → `KHR_lights_punctual`, along the FBX light direction                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Hidden nodes                                   | Skipped, counted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Not carried, counted under `unsupported`: cameras, area/volume lights, procedural textures, UV
transforms, textures outside the source directory, GPU-only image formats without a PNG/JPEG
sibling, separate opacity textures, split metallic/roughness textures, and the `material-*` and
`texture-*` rows of the [error tables](COMPILER_ERRORS.md). ufbx warnings (clamped indices, …) go
under `notes`; a missing
material library has its own code instead. The import manifest also records per file: format, FBX
version, creator, unit scale, mesh/material/texture/light counts, parse and conversion time.

## USD and USDZ import

A `.usd`, `.usda` or `.usdc` layer is composed by the `usd` driver into the same intermediate scene
under `<CACHE>/native/imports/<import-key>/`. A `.usdz` package is a container: extracted under the
cache, its content routed like any source, its layer through `usd`.

| Source                              | glTF                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Xform`, `Scope`, any untyped group | One node each; `xformOpOrder` composed into a column-major `matrix` (translate, scale, the six Euler orders, `orient`, `transform`, and their `!invert!` forms). `rotateXYZ` … `rotateZYX` apply rotations in letter order, first letter most local; the angles stay written `(x, y, z)` under every order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Mesh`                              | Polygons triangulated in their own plane ([Polygon faces](#polygon-faces)); `orientation` honoured (`leftHanded` reverses each triangle); indices `u16` under 65 536 vertices, else `u32`; a face with an index outside the points or negative, under three corners, or a primvar index outside its array is dropped and counted (`usd-face-invalid`), never folded onto point zero; a `holeIndices` face, invisible in OpenUSD, is dropped and counted (`usd-face-hole`) whatever the subdivision scheme, a hole index outside the face table counting as `usd-face-invalid`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Normals and `primvars:st`           | Resolved through `interpolation` (`constant`, `uniform`, `vertex`/`varying`, `faceVarying`) and `:indices`; `TEXCOORD_0` V flipped; a corner's (point, normal, uv) is the vertex key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GeomSubset`, family `materialBind` | One primitive per subset; unclaimed faces take the mesh's `material:binding`. Bindings resolve up the ancestors, nearest winning (a subset binding none takes its mesh's), and `bindMaterialAs = "strongerThanDescendants"` wins over those below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Instances                           | `instanceable` prims sharing a prototype share one glTF mesh, one node each; `class` prims are templates, not traversed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Roots and `defaultPrim`             | Every root is converted; `defaultPrim` is the entry point that opens the scene, dropping no other root                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `visibility`                        | `invisible` removes the prim and its subtree (inherited; no descendant comes back); counted as `invisible` in the manifest counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Units and axes                      | `metersPerUnit` (0.01 when undeclared) and `upAxis` land on the scene root node, never in the vertices (`Z` up becomes `Y` up)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Materials                           | `UsdPreviewSurface` → `pbrMetallicRoughness`: `diffuseColor` + `opacity` → `baseColorFactor`, `metallic`, `roughness`, `emissiveColor`, `normal`; a connected `UsdUVTexture` wins over the written factor, which then stays at one. An `opacity` bound to the base-colour texture's alpha rides in it; bound to another image it has no place in glTF (`usd-opacity-texture-unsupported`). A shared metallic/roughness map is read as glTF packs it, metal `outputs:b`, roughness `outputs:g`; an opacity from the base-colour image is carried only from `outputs:a`, any other channel keeping the written opacity (`usd-texture-channel-unsupported`). `opacityThreshold` > 0 → `MASK` at that cutoff; else an opacity below one or from the base-colour texture → `BLEND`. Absent inputs take the specification's defaults — `diffuseColor` 0.18 grey (never white), `roughness` 0.5, `metallic` 0, `opacity` 1 —; a textured `occlusion` reaches `occlusionTexture` through red. `doubleSided` comes from the mesh: an unbound double-sided mesh gets one shared default material carrying it, and a bound material is duplicated into a double-sided variant, never mutated |
| Textures                            | `UsdUVTexture` by URI; its asset path is anchored on the authoring layer (reference, sublayer or payload), then taken back under the source directory; `wrapS` and `wrapT` reach the sampler, a mode glTF lacks repeating (`usd-texture-wrap-unsupported`); a `scale` equal across colour channels with no `bias` becomes the material factor, anything else stays out (`usd-texture-scale-unsupported`); a `sourceColorSpace` contrary to the input's role is counted (`usd-texture-colour-space-unsupported`), never re-encoded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Animation                           | The default value, else the lowest time sample (`usd-animation-first-sample`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `UsdLux` lights                     | `SphereLight`, `DiskLight` and `RectLight` (glTF has no area source) → `point`, `DistantLight` → `directional`; a `ShapingAPI` cone makes any a `spot`, `softness` giving the inner angle; `ShadowAPI` `inputs:shadow:enable` rides in `extras.castsShadow`. `inputs:intensity` × 2^`inputs:exposure` is a radiance; the radiant intensity is it times the source's projected area — `π r²` for a sphere or disk, width × height for a rect — unless `inputs:normalize` is set, and a distant light carries its irradiance as written; glTF's photometric value is the radiometric one times 683 cd/W, which `lights.json` divides back out. `inputs:radius`, or half the diagonal of `inputs:width` × `inputs:height`, becomes `extras.emitterRadius` in world metres (layer unit and prim scale included). A distant light's `inputs:angle` is an angular diameter and a directional lamp takes no envelope: not carried                                                                                                                                                                                                                                                        |

Not carried: the `usd-*` rows of the [error tables](COMPILER_ERRORS.md), counted under
`unsupported`. The import manifest
also records the layer read, its size and SHA-256.

### Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners, each
read in the plane of its Newell normal. A **strictly convex** ring — every corner turning the same
way by a non-zero angle, the edges swinging round exactly once — is written as the fan from its
first corner in one pass. Every other ring is ear-clipped, cutting only empty triangles, so a
concave face keeps its area and outline; a ring the ears cannot finish (self-crossing, or planeless)
falls back on the fan, counted under `<driver>-ngon-untriangulable`. On a strictly convex ring the
ears cut that very fan — in exact arithmetic, and on every ring tested and fuzzed (millions of
random rings, none differing) — so no index of the compared caches moved; a collinear or duplicated
corner, a special case for the ears, keeps the ear path. Not a theorem: a ring within rounding of
collinear could in principle be read convex here and cut otherwise by the ears. The gain: a convex
polygon of `n` corners cost `n²` corner tests and now costs `n`.

## Input formats

**Policy.** A single Rust executable accepts whatever marketplaces deliver (FAB, Unity Asset Store,
Quixel, Sketchfab) without third-party tools. Fidelity first: no loss is added without a bound, no
lossy format is re-encoded, sources are never modified nor written beside. A texture received
lossless keeps its lossless levels in the cache, and the block family cooked beside them is kept
only where the quality gate of [FORMAT.md](FORMAT.md#textures) holds its loss under a declared,
measured bound; a texture received GPU-compressed keeps its format where the machine supports it and
is decoded only as a fallback.

Legal policy: no proprietary format, unless established legal reading. This page is not legal
advice; verdicts come from documentary analysis (Directive 2009/24/EC art. 1, 5 § 3, 6; CJEU SAS
Institute C‑406/10; 17 USC § 102(b); SAS v. WPL, 4th Cir. 2017 on contract scope). Repository rules:
reader written from public specifications or permissive libraries whose license is respected, never
any editor code or SDK reused, never any protection bypass, provenance of each reader documented,
redistributable test suites.

### Architecture: one driver per format

The compiler knows no format. It routes each source to a driver (interpretation plugin) in a static
registry, on the model of a device driver ([Adding a format](#adding-a-format)):

- **one driver per format, without exception**: `gltf`, `fbx`, `obj` for scenes; `png`, `jpeg` for
  images; then `tga`, `tiff`, `dds`, `exr`, `hdr`, `ktx2`, `webp`, `psd`, `bmp`, `gif`, `zip`,
  `unitypackage`, `unity`, `usd`, `alembic`, `blend`, `ma`;
- each is a Rust module with its name, version, detection (extension, magic number, folder
  structure), named report and minimal golden test; two drivers may share a library (ufbx for `fbx`
  and `obj`, the `image` crate for images) and remain two registry entries;
- two versioned contracts: scene driver (glTF intermediate scene + bin + report) and image driver
  (RGBA8, or RGBA linear float for EXR and HDR); driver and contract versions enter the cache
  identity, and the selected driver (name, version) is recorded in the manifest and report for
  provenance;
- an unknown or ambiguous source is rejected with the list of accepted formats, never interpreted
  by default.

### Safe

Every format below is done; "here from spec" means a reader written in this repository from the
specification, without a crate.

| Format                   | Base                                                     | Path                                                                                                                                                                                                                                                           | Priority |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| glTF / GLB               | Khronos standard                                         | —                                                                                                                                                                                                                                                              | —        |
| OBJ / MTL                | published specification                                  | MTL read and audited (golden [`tests/fixtures/formats/obj`](../tests/fixtures/formats/README.md#obj)). Limit: ufbx keeps `Tr` and `illum` as uninterpreted raw properties — a transparency written `Tr` instead of `d` is lost, the illumination model ignored | P2       |
| PNG, classic JPEG        | standards                                                | —                                                                                                                                                                                                                                                              | —        |
| TGA                      | published specification                                  | —                                                                                                                                                                                                                                                              | —        |
| TIFF (declared profiles) | published specification                                  | —                                                                                                                                                                                                                                                              | —        |
| OpenEXR, Radiance HDR    | documented, BSD-3                                        | `exr` crate 1.74.2 for OpenEXR; HDR here from spec                                                                                                                                                                                                             | —        |
| USD / USDZ               | public AOUSD, OpenUSD under TOST 1.0                     | `openusd` crate 0.7.0 (MIT, pure Rust, no C++); what `usd` carries and counts: [USD and USDZ import](#usd-and-usdz-import); `usdz` is a stored and aligned ZIP container                                                                                       | —        |
| Alembic                  | open, BSD-3                                              | static geometry only; Ogawa reader here from spec                                                                                                                                                                                                              | —        |
| `.blend`                 | documented SDNA; reading a .blend does not impose GPL    | SDNA reader written here; meshes of Blender 2.8 to 5.x, UVs, instances, Principled BSDF                                                                                                                                                                        | —        |
| PSD / PSB                | specification published by Adobe for third-party readers | flattened composite only, to RGBA8; reader here from spec; RGB and 8-bit grayscale, raw or PackBits, PSD and PSB                                                                                                                                               | P3       |
| BMP, GIF                 | open                                                     | `image` features; lossless only — BMP masks with >8 bits per channel and animated GIF rejected by name                                                                                                                                                         | P3       |
| ZIP                      | open                                                     | —                                                                                                                                                                                                                                                              | —        |

### Conditionally Safe — condition written in code

| Format                                     | Condition                                                                    | Path                                                                                                                                                                                                                                                                                                                                                | Priority |
| ------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FBX                                        | MIT ufbx, frozen version, notices kept, never Autodesk SDK                   | —                                                                                                                                                                                                                                                                                                                                                   | —        |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | YAML subset documented by Unity; data only, never Unity scripts or code      | —                                                                                                                                                                                                                                                                                                                                                   | —        |
| `.unitypackage`                            | tar.gz archive; each file retains its license                                | —                                                                                                                                                                                                                                                                                                                                                   | —        |
| DDS                                        | container documented by Microsoft; codecs declared one by one                | —                                                                                                                                                                                                                                                                                                                                                   | —        |
| KTX2, Basis Universal                      | Khronos; `basisu` Apache-2; codecs listed one by one                         | KTX2 only; ETC1S/BasisLZ and UASTC LDR by `basisu`, Zstandard by `ruzstd`, uncompressed R8G8B8A8, BC1–BC5, BC7, ETC2, EAC, ASTC 4×4; KTX 1.0 no                                                                                                                                                                                                     | —        |
| WebP                                       | public specification; pure Rust decoder `image-webp`, libwebp patent license | lossless only, lossy stream and animation rejected by name                                                                                                                                                                                                                                                                                          | —        |
| Maya ASCII `.ma`                           | documented format; data only, no script executed                             | reader here from the public MEL command docs; subset `createNode`, `setAttr`, `connectAttr`, `currentUnit`, `parent`; `transform`, `mesh`, `lambert`/`phong`/`blinn`/`standardSurface`, `file`/`place2dTexture`/`bump2d`, `shadingEngine` by face groups. Any other command — `python`, `eval`, `source`, unknown — counted by name, never executed | —        |

### To Avoid — No Native Import

`.uasset` / `.umap`, `.max`, `.mb` (binary), native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Request export in one of listed formats.

### Content Licenses — Independent of Format

Audit local asset and license manifests with [the offline license audit](ASSET_LICENSE_AUDIT.md).

- FAB Standard License: use with other tools and engines permitted, standalone asset redistribution
  prohibited; historical licenses apply for some items, keep purchase EULA.
- Quixel Megascans under Epic Engine plan: restricted to Epic Engine, unusable in Trillion3D.
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
boundary, reports through `request.progress`, and writes only under `request.cache`, never beside
the source.

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

`DecodedImage` has two variants since `image-plugin-2`: `Rgba8`, and `RgbaF32` for high dynamic
range. **A driver never converts one to the other**: float to 8-bit needs tone mapping, a loss the
source lacked. The consumer decides by `match` and a named reason (`image-float-unsupported` for the
RGBA8 sRGB previews). A float driver checks the ceiling at **sixteen bytes per pixel** before
allocating (`float_budget`), the rejection naming its format.

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
- **Provenance**: spec source, library, license — in the module header and the commit message.

### Forbidden

- Reusing editor code or SDK, even available: readers come from public specifications or permissive
  libraries whose license is kept.
- Bypassing a format's encryption, protection or license check.
- Breaking the fidelity [policy](#input-formats): re-encoding a lossy source, modifying or writing
  beside originals.
- Anything format-specific in `main.rs`, `cli_batch.rs` or `compiler_args.rs`: the CLI names no
  format.
- An empty driver "for later".

## Cache layout

Written by a job under `<CACHE>/native/`:

| Path                                             | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<scope>/manifest.json`                          | Pointer: `{status, formatVersion, compiler, key, scope, url}`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `<scope>/<key>/clusters.json` + its pages        | Compiled manifest (root, JSON pages + typed-array columns), see [FORMAT.md](FORMAT.md)                                                                                                                                                                                                                                                                                                                                                                                            |
| `<scope>/<key>/source.gltf` + `source.bin`       | Source glTF on one aligned buffer, image URIs rewritten under `RESOURCE_BASE_URL`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `<scope>/<key>/scene.gltf` + `scene.bin`         | Autonomous scene for the prepared-page backends (materials, no source geometry), written only when every primitive is exact and the source declares no animation, skinning or morph weights; otherwise `autonomousScene` is `null` and `autonomous-scene-animated` says why                                                                                                                                                                                                       |
| `textures/v<N>/<sha256>/<kind>-<level>.<format>` | Baked mip levels above the sidecar's tail — lossless PNG, plus the kept block family — addressed by the source image's SHA-256, shared across keys and scopes, never rewritten, pruned with the objects; kinds, formats and `v<N>`: [FORMAT.md](FORMAT.md#textures)                                                                                                                                                                                                               |
| `objects/<sha256>.bin`                           | Content-addressed index pages, quantized cluster pages (`WGP3`, [FORMAT.md](FORMAT.md)) and streaming bundles, shared across keys and scopes                                                                                                                                                                                                                                                                                                                                      |
| `imports/<import-key>/`                          | FBX/OBJ import (above)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `<scope>/<key>/lights.json`                      | Scene lights in the engine's `SceneLight` contract (below)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `<scope>/<key>/scene-tables.json`                | Node graph, lights, surfaces and geometry layout of the prepared scene, read from the `source.gltf` (and `scene.gltf`) the job publishes; the runtime builds its scene from it alone ([FORMAT.md](FORMAT.md#prepared-scene-tables)). Placements outgrowing one stream unit go to `scene-cell-<n>.json` cells beside it, halved by bytes along their widest spread, boxed in each core parent's frame, read by distance, indexed by pages ([FORMAT.md](FORMAT.md#world-partition)) |

Sizes (Emerald, 10 M triangles, 336 images): manifest 387 KB of JSON and 29 MB of columns,
`source.bin` 195 MB, `objects/` 542 MB in 80 343 files, `textures/` 856 MB in 1 380 PNG files.
Emerald compiles in about 10 s wall on 8 threads once its levels exist, 20 s when they are first
baked (default PNG compression; 13 s with the fast one, for 1,0 GB of levels instead of 856 MB); the
133 MB OBJ above in 3.4 s, 1.2 s of it import.

### `lights.json` — the lamps of the source file

The source's lamps in world space and in the engine's `SceneLight` contract, a product of its own
beside the manifest: the manifest format number does not move, and a reader ignoring the file loads
the cache as before. It carries `version`, `sceneLightVersion`, the photometric `units`, `count`,
`lights`, `rejected` (lamps left out, by code) and `counts` (what was filled in or omitted on a kept
lamp).

`emitterRadius`, the radius of the envelope a lamp stops occluding in its own shadow map
([SDK.md](SDK.md)), is filled for `point` and `spot` lamps only, from two places in order. First the
source: a radius declared on the lamp, in the light's `extras.emitterRadius` in metres (the `extras`
channel `castsShadow` travels on). USD and Blender fill it from their data — a `UsdLux` light's
`inputs:radius` or the diagonal of `inputs:width` × `inputs:height`, a Blender `Lamp`'s `radius`
(`shadow_soft_size` in files that still name it so) and emitting surface — carried to world metres
by the layer unit and object scale. glTF `KHR_lights_punctual` has no radius field and `ufbx_light`
(every FBX lamp) carries colour, intensity, direction, decay, area shape and cone angles but no
size, so for those only a glTF authored with the channel feeds it. Otherwise the compiler measures
the luminaire: when the lamp's parent node or a direct sibling carries a mesh whose material emits —
a non-zero `emissiveFactor` or an `emissiveTexture`, the material alone deciding — the radius is the
greatest distance from the lamp's centre to one of that body's vertices, counted
`light-emitter-radius-derived`. The body is walked vertex by vertex, never by its box: a sphere's
box overruns by sqrt(3) and would exclude occluders the envelope never held. With several emissive
bodies the tightest sphere wins. The field is written only when finite, strictly positive and
strictly below `range`; otherwise it is omitted, counted `light-emitter-radius-invalid`. A lamp with
no envelope, and a `directional` lamp (no centre), receive nothing, uncounted.

### `physics.json` — the cooked colliders (stage `physics-cook`)

The browser builds no tree, hull or mass: loading a collider is a decode and a copy. Native Jolt is
linked into the compiler from the web module's pinned submodule (`build.rs` builds
`packages/physics-jolt-wasm` with `-DCOOK=ON`; needs CMake, a C++17 compiler and `git submodule
update --init`). The stage contract is `PHYSICS_COOK_STAGE` / `PHYSICS_COOK_VERSION`; the Jolt
commit and stage version enter the cache key, so another Jolt's cook is never reused. Algorithms, in
`src/physics_cook/` (fields: [FORMAT.md](FORMAT.md#physicsjson--cooked-colliders)):

- **Collision level** (`cut.rs`). A DAG cut at one threshold — clusters with `lod_error <=
threshold < parent_error`, the renderer's and proxy's rule, so the surface is covered once,
  borders locked. The tolerance `t` is the object's own: the median error of its first simplified
  level. A cluster's error is an estimate, not a bound, so each cut tried is measured against level
  0 both ways (`hausdorff.rs`: vertices, edge midpoints and centroids of each side to the other's
  nearest triangle): the cut at `t` first, then a bisection over the cluster errors under `t` down
  to level 0, which holds any tolerance. The coarsest cut within `t` is kept, its distance published
  as `hausdorff`, at or under `tolerance`. No simplified level: collision at level 0.
- **Tiles.** The cut splits along the culling hierarchy: a node of at most 4096 collision triangles
  is one tile, a larger one hands its children down. Each tile is a Jolt `MeshShape` in the
  primitive's frame with its triangles' material index, stored under its SHA-256. Jolt drops a
  triangle whose doubled area is under 1e-6, absolute: small objects in metres (the chess pieces of
  `abeautiful-game`) lost most of their surface, a tile all of it, then refused. The cook
  (`packages/physics-jolt-wasm/src/mesh.h`, shared with the runtime's triangle meshes) scales such a
  tile's box to 2^11 by a power of two (past it Jolt's relative 21-bit quantization is the stricter
  test), at most 2^19 (the largest whose inverse Jolt takes as a scale), inside a `ScaledShape` of
  the inverse: both scalings exact, the collider is the drawn cut.
- **Height fields** (`height.rs`). A primitive whose used vertices sit one per point on an evenly
  spaced x-z lattice, every triangle within one cell, becomes a `HeightFieldShape`; the largest gap
  between a cell's two diagonals is its `hausdorff`.
- **Declared matter** (`declared.rs`). A `KHR_physics_rigid_bodies` collider naming a
  `physicsMaterial` gives the node's placements its friction and restitution. Every drawn node but a
  declared soft body is static ground as drawn, motion-declaring nodes included; the page drops
  their placements once it has restored the body.
- **Declared bodies** (`declared.rs`). A rendered node whose `KHR_physics_rigid_bodies` declares a
  `motion` (dynamic, or kinematic with `isKinematic`) is also cooked into `bodies`: its motion as
  declared, matter, pose and shape — the `KHR_implicit_shapes` shape its collider names; else one
  convex hull, built by native Jolt for contact (`cook_hull`, `hull.rs`), of the mesh its collider's
  node draws (its own without a collider), in the body's frame. A dynamic body's mass is not the
  hull's: the solid its closed mesh bounds is weighed exactly by volume integrals over its triangles
  (`mass.rs`, after Tonon's tetrahedron formulas) at the runtime's density, 1000 kg/m³, and the
  body's scale — mass, centre of mass, inertia —, which the page hands Jolt, building and weighing
  nothing; a kinematic body, moved and never pushed, is not weighed. A concave body collides by its
  hull until volume decomposition (#519). A refused body — missing shape, shearing node, unreadable
  mesh, a dynamic mesh not closed (every edge meeting its reverse, positions welded) or bounding no
  volume, a hull Jolt refuses — is named in `report.bodiesRefused`; the compile goes on.
- **Breakable bodies** (`pieces.rs`, `voronoi.rs`). A shapeless body declaring `breakable` (above 0)
  is cut into at most 12 Voronoi cells around seeds drawn from the node's index, each clipped by
  its bisectors and the mesh's face planes into a closed piece with Jolt's hull (`hull.rs`) and
  exact mass, centre and inertia (`mass.rs`). Pieces missing the mesh's mass by over 1e-5 (a concave
  mesh, until decomposition) refuse the body, as does a declared shape.

Primitives without a DAG (shared blend) cook no collider, nor does one whose shape Jolt refuses
(every triangle of zero area), named with Jolt's reason in `report.refused`; the compile goes on,
its render cache unchanged.

### Soft bodies a model declares

A drawn node whose `extras.physics` holds `obj.physics`'s soft-body options — `{ "type": "cloth" |
"rope" | "volume", "pins", "mass", "stretch", "bend", "pressure", … }`, `bend` omitted for none
(JSON has no `Infinity`) — is cooked as a soft body, not static ground (`src/physics_cook/soft.rs`);
its mesh must hold one primitive. Its vertices become the simulated ones exactly as the page's
`softBodyOf` makes them (`soft_record.rs`): coincident positions welded, masses from the area (a
rope's length) each holds at the node's world scale or the declared `mass` spread so, pins held, a
volume's default pressure. Each value is rounded to 32 bits where the page rounds it, bit for bit:
the cook writes the records of a cloth, a scaled welded rope and a volume (`soft_tests.rs`,
`tests/fixtures/physics/soft-records.bin`) and the page rebuilds each with `softBodyOf`
(`packages/sdk-core/src/physics/softCook.test.ts`). Native Jolt builds the `SoftBodySharedSettings`
with the physics worker's own builder (`packages/physics-jolt-wasm/src/softSettings.h`, compiled
into both), optimised, saved with `SaveWithMaterials` under their SHA-256 like a tile. The page
hands the bytes to Jolt's `sRestoreWithMaterials` in one SOFT command and builds nothing
(`packages/sdk-browser/src/physics/cookedSoft.ts`; fields in
[FORMAT.md](FORMAT.md#softbodies--cooked-soft-bodies)). The golden cloth
(`tests/fixtures/physics/cloth-settings.bin`, rewritten with `TRILLION3D_WRITE_GOLDEN=1`) is
restored by the physics module's test and swings as the page-built cloth
(`packages/sdk-browser/src/physics/cookedSoft.test.ts`). A refused node — two primitives, a shearing
matrix, an option out of range, a pin naming no vertex — is named in `report.softRefused`; the
compile goes on. The node is drawn as compiled: its simulated vertices reach no drawn surface until
dynamic geometry is uploaded in place (#573).

## Cutouts declared as blend

The virtualized path takes opaque and masked materials: a blended primitive costs one draw call per
item and face, a masked one joins the single compute-raster draw. Source files routinely declare
foliage blended when it is a cutout — every texel there or gone, a soft fringe only along the
contour. The reference engine never reclassifies such a material itself: it refuses it, logs it, and
a human ticks _Masked_ before shipping. Importing other people's files, the compiler takes that role
— **without ever guessing silently**.

Each compile writes `decoupes.json`, the answer sheet, at the compiled model's root beside
`native/`: one entry per candidate texture, keyed by the sha256 of its image bytes, with the
measure, the compiler's `proposal`, what the texture still holds in the blend path, and `cutout` —
`true`, `false`, or `null` while undecided. It is written on **every** compile, pending or not: the
sheet says a review is due, and `cutouts.version` in the manifest publishes its contract number.
Nothing applies until an entry answers `true`; with no sheet, blended stays blended and the product
is byte-identical.

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
bake each mip chain, in parallel on the job's pool ([FORMAT.md](FORMAT.md#textures)), so nothing is
decoded twice; candidates are read once more to key answers by sha256 — 0.08 s of a 14.5 s Emerald
compile. The question shows the progressive thumbnails the cache already carries: nothing is drawn,
encoded or sent for it. Two numbers separate the shapes: the share of texels neither present nor
absent, and the share of those within eight pixels of the 0.5 contour — a glass is grey everywhere
and far from any contour, a leaf grey only along its edge. The proposal proposes; the answer
applies.

An answer applies to a **texture**: every base-color binding of it, in every scene sharing it. Two
bindings are refused even when the answer says cutout, named in the report: a material with
`KHR_materials_transmission` (its thickness is not a cutout) and one whose `baseColorFactor` alpha
is already below one (its opacity is not the texture's). Applying an answer sets `alphaMode` to
`MASK` at glTF's default 0.5 cutoff, in the published `source.gltf` too, and enters the cache key,
so a changed answer recompiles.

Masking hardens the silhouette blending softened — the declared cost of the batch; the reference
pays it too and recovers the edge through temporal antialiasing.

## Memory and threads

- `threads` sizes one job's rayon pool; clustering, simplification and paging run in parallel per
  primitive.
- `RAM_MB` is an **admission** check before any work, from the source size (a GLB's BIN chunk
  counted once, as the mapped binary), the selected buffer views, the triangle count and the dense
  expansion of every accessor to decode — `count × components × 4` bytes, whether its values are
  stored, absent or `sparse` —, plus each primitive's index buffer; only these bytes, which no
  compilation order lowers, refuse a job. Primitives then compile in consecutive waves whose working
  sets (the DAG, and the collider cook and page packing running beside it on the finished DAG) fit
  in what the budget leaves after what the job keeps to the end (each page's manifest record, its
  culling and structure entries and their published text): a scene that fits is one wave, a tighter
  budget smaller waves, down to one primitive at a time, never refused (`compiler_budget/waves.rs`);
  what one worker holds whatever the scene — a collider tile with Jolt's cook of it, a bundle being
  packed — is charged once per thread. Each cost derives from the primitive's triangle and vertex
  counts and the structures allocated for them (`compiler_primitive/cost.rs`).
  `metrics.compileWaves` reports the waves run, `metrics.peakRssBytes` (also on every `progress`
  event) the process high-water mark. Estimates, not a process cap (`unsupported: "hard RSS
enforcement"`).
- Texture baking reads image dimensions before pixels, through each format's header reader. Images
  run in deterministic waves cut by the same planner (`compiler_budget/waves.rs`), whose estimated
  encoded source, expanded container payload, decode intermediates, alpha-distance buffer, mip
  pyramid, PNG output, block read-back and temporary tails fit in the RAM left after the source and
  geometry estimate. Every returned preview tail is reserved before the first wave, copies for
  textures sharing an image included. An image or the retained tails exceeding that fails with
  `RAM_ADMISSION_BUDGET_EXCEEDED` — never a white substitute or a lower resolution. Cancellation is
  checked during planning and between images. These image-buffer estimates are no hard process-RSS
  or third-party allocator ceiling, and leave the reduction and quality gate unchanged.
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

Every code and its meaning, global and per driver (archives, lights and OBJ/MTL materials, Blender,
images, USD, Alembic, Maya ASCII, Unity): [COMPILER_ERRORS.md](COMPILER_ERRORS.md).

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

`createTerminalProgress({label, index, total})` returns an object whose `event` method takes every
compiler event and draws one live line (spinner, bar from `ratio`, phase, elapsed) on a TTY, one
plain line per phase change elsewhere; `createBatchProgress()` does it per job for
`prepareMany({onEvent})`; `progress.note(text)` shows a host-side step (a copy, a manifest check)
before the compiler starts. The `trillion3d-compile` CLI uses it on a TTY and prints raw JSON events
on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them).

```js
const progress = createTerminalProgress({ label: 'city', index: 0, total: 8 });
await prepare(source, cache, 'full', 150000, { resourceBaseUrl, onProgress: progress.event });
// ⠹ 1/8 city [██████████░░░░░░░░░░░░░░]  42% clustering 118/281 primitives 6.2s
// ✔ 1/8 city 1,132,930 triangles, 412 primitives, 3395 ms 4.1s
```

The executable is `options.executable`, else the one of the installed platform package, else
`TRILLION3D_COMPILER_BIN` (trusted, announced once on stderr), else
`packages/asset-compiler-rust/target/release/`, refused with `COMPILER_STALE` while a crate source is
newer than that build, so no cook publishes under the previous build's key (`pnpm run build:native`
rebuilds it). Outside a checkout, a platform none of them serves is refused with
`COMPILER_PLATFORM_UNSUPPORTED` and the supported list, and a supported one whose package is not
installed (optional dependencies omitted, a Linux on musl) with `COMPILER_EXECUTABLE_MISSING` and
the package's name. Node never buffers a manifest: about 90 MB
RSS whatever the model size.

### Platform packages

The compiler is built for macOS arm64 and x64, Linux arm64 and x64 (glibc) and Windows x64, each
shipped as its own package, `@trillion3d/compiler-<os>-<arch>` (`packages/compiler/`), declared in
the `optionalDependencies` of `trillion3d`: an install takes only its machine's one. The `Compiler`
workflow builds the five on their own runners (`scripts/compiler-dist.ts`): the release profile
(fat LTO, abort on panic, stripped symbols), mimalloc as the allocator of the Rayon workers, and
profile-guided optimisation trained on the two reference scenes (`scripts/compiler-hashes.ts`). The
macOS arm64 build assumes the Apple M1; an x86-64 build keeps its baseline and runs the page
quantizers in AVX2 where the processor has it (`shared_math::wide`). No fused multiply-add anywhere
— Rust never fuses, C and C++ are built with `-ffp-contract=off`, Jolt in its cross-platform mode —,
so every platform writes the same bytes: the workflow compiles the reference scenes with each binary
and compares every cache file's SHA-256 with Linux x64's and, on a pull request, `develop`'s.

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
the compiler applies the physics cook's weld and compact mapping to the render vertices; simplified
vertices retain their source offset, and runtime displacement bounds add conservative transfer error
until finer resident pages can be selected. A cooked soft primitive also declaring skin/morph
sources is refused with `SOFT_DEFORMATION` rather than giving one stream two meanings. The page and
sidecar format (flags 16/32/64, `render.version: 1`):
[FORMAT.md](FORMAT.md#deformation-in-geometry-page-format-7).

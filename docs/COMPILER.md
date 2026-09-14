# The native compiler — `web-geometry-compiler`

One executable does all of the preparation work: it reads a source model (glTF, GLB, FBX or OBJ), builds the cluster hierarchy and writes the cache described in [FORMAT.md](FORMAT.md). Everything else — the Node adapter, an Electron host, a shell script — only launches it, forwards a few paths and options, and listens to what it says. No external application is needed: the FBX/OBJ reader (ufbx) is compiled into the binary.

Source: [`packages/asset-compiler-rust`](../packages/asset-compiler-rust) (`lib.rs` compiles, `import.rs` imports, `main.rs` is the command line). Build with `npm run build:native`; the binary lands in `packages/asset-compiler-rust/target/release/web-geometry-compiler` (`.exe` on Windows).

## Contents

- [Invocation](#invocation)
- [The three streams](#the-three-streams)
- [Events](#events)
- [The pointer](#the-pointer)
- [Batch mode](#batch-mode)
- [Cancellation](#cancellation)
- [FBX and OBJ import](#fbx-and-obj-import)
- [Cache layout](#cache-layout)
- [Memory and threads](#memory-and-threads)
- [Exit codes and error codes](#exit-codes-and-error-codes)
- [Using it from Node](#using-it-from-node)
- [Using it from any other host](#using-it-from-any-other-host)

## Invocation

```
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]
web-geometry-compiler --jobs FILE|-
web-geometry-compiler --version
```

| Argument | Meaning | Default |
|---|---|---|
| `SOURCE` | A directory with `manifest.json`; a directory with exactly one `.gltf`/`.glb`; a `.gltf`/`.glb` file; a `.fbx`/`.obj` file; or a directory of `.fbx`/`.obj` files, merged into one scene | required |
| `CACHE` | Output directory, created if missing. Several sources may share one cache | required |
| scope | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything | `slice` |
| triangles | Triangle budget for `slice`; ignored by `full` | `150000` |
| threads | Worker threads for clustering and simplification (1–64) | `2` |
| `RAM_MB` | Admission budget: the job is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`) when its estimated working set exceeds it. This is a guard, not an enforced limit | `256` |
| `RESOURCE_BASE_URL` | URL prefix under which the host serves the **source** directory; relative image URIs are rewritten against it | required |
| simplification | `none` keeps exact clusters only; `qem-endpoints` builds the coarser levels of the DAG | `none` |

Examples:

```sh
web-geometry-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
web-geometry-compiler scenes/london cache/london full 150000 8 8192 /assets/london/ qem-endpoints   # a folder of FBX files
web-geometry-compiler scenes/emerald cache/emerald full 150000 8 32768 /assets/emerald/ qem-endpoints # a glTF folder with manifest.json
```

## The three streams

The process talks through stdin, stdout and stderr only. There is no socket, no temporary protocol file, no environment contract.

| Stream | Content | Size |
|---|---|---|
| stderr | One JSON object per line, one line per event | a few KB per job (Emerald: 26 KB) |
| stdout | The pointer for one job, or the batch summary | under 1 KB per job (Emerald: 663 bytes) |
| stdin | Optional cancel requests, one JSON object per line | — |

The compiled manifest (`clusters.json`, hundreds of KB to MB) is **never** printed: it is written to disk and the pointer says where. A host that ignores stdin gets end-of-file immediately and loses nothing.

## Events

Every stderr line is `{"event": <kind>, "job": <id>, ...}`. `accepted`, `progress` and `complete` also carry `ratio`, a whole-job completion estimate from 0 to 1 (source import up to 0.30, glTF import 0.35, clustering 0.35–0.95 spread over the primitives announced by the `import` event, root bundles 0.95–0.99, pointer 1), so a host can draw one bar without knowing the phases. For a single invocation the job id is `"job"`; in batch mode it is the id from the batch file; batch-level lines use `"*"`.

| `event` | When | Extra fields |
|---|---|---|
| `batch` | Once, first line of `--jobs` | `jobs`, `workers` |
| `queued` | Once per job in a batch, before any work | `source` |
| `accepted` | A worker starts the job | `source`, `cache`, `scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` |
| `progress` | During the job | `phase` and phase-specific fields, see below |
| `complete` | The job succeeded | `pointer` (same object as stdout), `ms` |
| `cancelled` | The job stopped on a cancel request | `status:"error"`, `code:"CANCELLED"`, `message`, `ms` |
| `error` | The job failed | `status:"error"`, `code`, `message`, `ms` |
| `done` | Once, last line of `--jobs` | `completed`, `failed`, `cancelled`, `ms` |

Progress phases, in order:

| `phase` | Fields | Meaning |
|---|---|---|
| `import-source` | `step` = `parse` (`file`, `index`, `files`, `completed`, `total` in bytes) → `meshes` (`completed`, `total` in nodes) → `write` (`bytes`) → `complete` (`key`, `triangles`, `meshNodes`, `ms`), or `reused` (`key`) when a previous import is reused | FBX/OBJ only |
| `import` | `completed`, `total`, `ms`, `primitives`, `nodes` | glTF loaded and validated, source geometry written; `primitives` is the number of `primitive` events to expect |
| `primitive` | `mesh`, `primitive`, `pages` | One primitive clustered and paged (order is not deterministic: primitives run in parallel) |
| `bootstrap` | `completed`, `total` | Root bundles assembled |
| `prune` | `removedKeys`, `removedObjects`, `removedBytes` | Stale keys, imports and orphan objects removed (only emitted when something was removed) |
| `complete` | `completed`, `total`, `pruned` | Pointer written; `pruned` summarises the cache pruning |

A host that only wants a bar reads `ratio`; one that wants detail reads the phase fields.

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
  "formatVersion": 1,
  "compilerVersion": "0.1.0",
  "selectedTriangles": 1132930,
  "sourceTriangles": 1132930,
  "selectedNodes": 283,
  "totalNodes": 283,
  "primitives": 412,
  "simplification": true,
  "metrics": {"importMs": 1571.7, "clusterHierarchyPagesMs": 1822.8, "wallMs": 3394.6, "outputGeometryBytes": 58679400, "threads": 8, "ramBudgetMb": 8192},
  "unsupported": ["hard RSS enforcement", "N-API binding"]
}
```

`pointer` is the file the browser explorer needs (`manifestUrl`); `url` is relative to `native/<scope>/`. On failure stdout carries `{"status":"error","code":…,"message":…}` and the exit code is 2.

A cache never needs to be wiped before recompiling: after every successful job the compiler removes the other keys of the scope, the stale FBX/OBJ imports and every object under `objects/` that no surviving manifest (either scope) references. Deleting a large cache by hand costs tens of seconds (Emerald: 80 000 files); recompiling over it costs nothing extra.

`key` is a SHA-256 over the source manifest, the source binary, the compiler version, the compiler's own source files, scope, budget, `RESOURCE_BASE_URL` and simplification. Changing any of them produces a new `<key>` directory; the pointer always names the latest one. Nothing is deleted automatically.

## Batch mode

`--jobs FILE` (or `--jobs -` to read one line from stdin) runs many jobs in one process:

```json
{
  "workers": 2,
  "ramBudgetMb": 16384,
  "threads": 4,
  "jobs": [
    {"id": "city",   "source": "scenes/city/city.obj", "cache": "cache/city",   "resourceBaseUrl": "/assets/city/",   "scope": "full", "simplification": "qem-endpoints"},
    {"id": "london", "source": "scenes/london",        "cache": "cache/london", "resourceBaseUrl": "/assets/london/", "threads": 8, "ramBudgetMb": 12000}
  ]
}
```

| Field | Meaning | Default |
|---|---|---|
| `workers` | Jobs running at the same time (1–64) | `1` |
| `ramBudgetMb` | Total admission budget, split evenly between workers unless a job sets its own | `256 × workers` |
| `threads` | Default threads per job | `2` |
| `jobs[].id` | Job id used in events and the summary; must be unique | `job-<index>` |
| `jobs[].source`, `cache`, `resourceBaseUrl` | As on the command line | required |
| `jobs[].scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides | `full`, `150000`, batch default, batch share, `none` |

Jobs are taken in file order by the first free worker. stdout at the end:

```json
{"status": "ready" | "partial" | "failed", "completed": 2, "failed": 0, "cancelled": 0,
 "jobs": [{"job": "city", "status": "ready", "pointer": {…}}, {"job": "x", "status": "error", "code": "IMPORT_IO_ERROR", "message": "…"}]}
```

`jobs` is sorted by id. Exit code 0 only when every job is ready. An invalid batch file is reported as `INVALID_BATCH` before any job starts.

Thousands of models: one batch file, one process, `workers` sized to the machine, `ramBudgetMb` set to what the machine can give. Each job builds its own thread pool of `threads` workers, so `workers × threads` is the CPU ceiling.

## Cancellation

Write one line on stdin:

```json
{"cancel": "*"}          // everything
{"cancel": "london"}     // one job of a batch
```

The compiler checks the flag between steps (parsing, each primitive, each write), stops, emits `cancelled` for the job and exits with code 2 (`{"status":"error","code":"CANCELLED"}` on stdout for a single job; the batch summary counts it under `cancelled`). Jobs not yet started in a batch are still run unless `"*"` was requested.

Killing the process is also safe: every file is written under a temporary name and renamed, so the cache holds either the previous complete result or the new one, never a half-written file. Re-running after a kill resumes at the import cache (see below) and recompiles the rest.

## FBX and OBJ import

When `SOURCE` is a `.fbx`/`.obj` file, or a directory holding such files and neither `manifest.json` nor a glTF, the compiler first imports it into the cache:

```
<CACHE>/native/imports/<import-key>/
  model.gltf       plain glTF 2.0 (nodes with world matrices, meshes, materials, images, lights)
  model.bin        geometry (+ embedded images as buffer views)
  manifest.json    source manifest read by the compile step, plus an import report
```

`<import-key>` hashes every input file and the importer version (`IMPORTER_VERSION` in `import.rs`, also printed by `--version`), so an unchanged source is imported once and reused (`import-source/reused`). The compile step then behaves exactly as for a hand-made glTF folder.

What is carried:

| Source | glTF |
|---|---|
| Positions, normals, one UV set, one colour set | `POSITION`, `NORMAL` (generated when missing), `TEXCOORD_0` (V flipped), `COLOR_0` |
| Polygons | Triangulated by ufbx; indices `u16` under 65 536 vertices, else `u32` |
| Units and axes | Converted to metres, right-handed, Y up (FBX `UnitScaleFactor` and axis system honoured; OBJ assumed metres, Y up) |
| Instances | One glTF mesh per (mesh, material list), one node per instance with its world matrix (`geometry_to_world`, geometry transforms and pivots baked) |
| Materials | `pbrMetallicRoughness` from ufbx's unified PBR view (Phong, Lambert, Arnold, Stingray, 3ds Max, OpenPBR, MTL…): base colour + alpha, metallic, roughness (glossiness inverted), emissive, normal, occlusion, metallic-roughness when one texture carries both; `doubleSided`; `alphaMode` `BLEND` when opacity < 1, `MASK` (cutoff 0.5) when an opacity texture is bound. A bound texture replaces the colour factor (FBX semantics). Default roughness when the source says nothing: 0.6 |
| Textures | PNG/JPEG resolved inside the source directory (declared absolute, relative or bare name; then `textures/`; then a sibling `.png`/`.jpg` next to a DDS/TGA/…); embedded bytes become buffer views. Wrap modes → sampler. Referenced by URI relative to the source directory, so they are served under `RESOURCE_BASE_URL` like any glTF image |
| Lights | Point, directional, spot → `KHR_lights_punctual`, oriented along the FBX light direction |
| Hidden nodes | Skipped, counted |

Not carried, counted in the import manifest under `unsupported`: skinning, blend shapes, animation, cameras, area/volume lights, procedural textures, UV transforms, textures outside the source directory, GPU-only image formats without a PNG/JPEG sibling, separate opacity textures, split metallic/roughness textures. ufbx warnings (clamped indices, …) are listed under `notes`.

The import manifest also records, per file: format, FBX version, creator, unit scale, mesh/material/texture/light counts, parse and conversion time.

## Cache layout

Written by a job, all under `<CACHE>/native/`:

| Path | Role |
|---|---|
| `<scope>/manifest.json` | Pointer: `{status, formatVersion, compiler, key, scope, url}` |
| `<scope>/<key>/clusters.json` + `clusters.bin` | Compiled manifest (JSON head + typed-array columns), see [FORMAT.md](FORMAT.md) |
| `<scope>/<key>/source.gltf` + `source.bin` | Source glTF rewritten to a single aligned buffer, image URIs rewritten under `RESOURCE_BASE_URL` |
| `<scope>/<key>/scene.gltf` + `scene.bin` | Autonomous scene for the prepared-page backends (materials, no source geometry) |
| `objects/<sha256>.bin` | Content-addressed geometry pages and streaming bundles, shared across keys and scopes |
| `imports/<import-key>/` | FBX/OBJ import (above) |

Sizes for reference (Emerald, 10 M triangles): `clusters.json` 387 KB, `clusters.bin` 17 MB, `source.bin` 195 MB, `objects/` 542 MB in 80 343 files. Emerald compiles in about 8 s wall on 8 threads; the 133 MB OBJ above in 3.4 s including a 1.2 s import.

## Memory and threads

- `threads` sizes the rayon pool of one job; clustering, simplification and paging run in parallel per primitive.
- `RAM_MB` is an **admission** check made from the source size, the selected buffer views and the triangle count before any work starts. It refuses jobs that would obviously not fit; it does not cap the process. Peak RSS is not measured (`unsupported: "hard RSS enforcement"`).
- The source buffer is memory-mapped when it is a single external `.bin`; embedded or multi-buffer sources are copied.
- The FBX/OBJ importer loads the whole ufbx scene in memory, then streams the glTF out; expect roughly 3–4× the source size during import.
- In batch mode the process memory is the sum of the running workers; size `workers` accordingly.

## Exit codes and error codes

Exit code 0: every job ready. Exit code 2: usage error, invalid batch, or at least one job failed or cancelled.

| `code` | Meaning |
|---|---|
| `INVALID_ARGS`, `INVALID_BATCH` | Command line or batch file rejected before any work |
| `INVALID_OPTIONS` | Scope, budgets, threads, base URL or simplification out of range |
| `INVALID_GLTF`, `INVALID_JSON`, `UNSUPPORTED_ACCESSOR`, `BUFFER_OUT_OF_BOUNDS` | Source glTF rejected (also covers a directory with nothing importable) |
| `SOURCE_NOT_READY`, `UNSUPPORTED_FORMAT`, `SOURCE_HASH_MISMATCH` | Source `manifest.json` not ready, wrong format version, or files changed since it was written |
| `IMPORT_ERROR`, `IMPORT_UNSUPPORTED_VERSION`, `IMPORT_OUT_OF_MEMORY`, `IMPORT_IO_ERROR`, `IMPORT_EMPTY` | FBX/OBJ import failed, or produced no visible mesh |
| `EMPTY_SLICE` | No mesh instance fits the `slice` budget |
| `RAM_ADMISSION_BUDGET_EXCEEDED` | Estimated working set above `RAM_MB` |
| `INCOMPLETE_CLUSTER_PARTITION`, `INVALID_CLUSTER_PARTITION` | Internal consistency check failed on level-0 clusters |
| `CANCELLED` | Stopped on a cancel request |
| `IO_ERROR`, `THREAD_POOL_ERROR` | Filesystem or thread pool failure |

## Using it from Node

`@web-geometry/sdk/node` is a thin relay over the executable ([`packages/sdk-node/index.mjs`](../packages/sdk-node/index.mjs)):

```js
import {prepare, prepareMany} from '@web-geometry/sdk/node';

// One model: events → onProgress, pointer read from stdout, manifest read back from disk.
const result = await prepare('scenes/city/city.obj', 'cache/city', 'full', 150000, {
  resourceBaseUrl: '/assets/city/', threads: 8, ramBudgetMb: 8192, simplification: 'qem-endpoints',
  signal: controller.signal,                       // abort → {"cancel":"*"} on stdin, kill after 5 s
  onProgress: event => console.log(event.event, event.phase),
});
result.pointer;            // path of native/full/manifest.json
result.selectedTriangles;  // from clusters.json

// Many models in one process.
const summary = await prepareMany(jobs, {workers: 4, ramBudgetMb: 32768, threads: 4, onEvent});
summary.jobs[0].pointer;   // pointers only; nothing is read from disk
```

Terminal display comes with the adapter: `createTerminalProgress({label, index, total})` returns an object whose `event` method accepts every compiler event and draws one live line (spinner, bar from `ratio`, phase, elapsed) on a TTY, or one plain line per phase change elsewhere; `createBatchProgress()` does the same per job for `prepareMany({onEvent})`. The `web-geometry-compile` CLI uses it on a TTY and prints raw JSON events on a pipe (`WEB_GEOMETRY_RAW_EVENTS=1` forces raw events).

```js
const progress = createTerminalProgress({label: 'city', index: 0, total: 8});
await prepare(source, cache, 'full', 150000, {resourceBaseUrl, onProgress: progress.event});
// ⠹ 1/8 city [██████████░░░░░░░░░░░░░░]  42% clustering 118/281 primitives 6.2s
// ✔ 1/8 city 1,132,930 triangles, 412 primitives, 3395 ms 4.1s
```

The executable is found at `packages/asset-compiler-rust/target/release/`, or through `options.executable`, or `WEB_GEOMETRY_COMPILER_BIN`. Node never buffers a manifest: its memory stays flat (about 90 MB RSS) whatever the model size.

## Using it from any other host

Spawn the executable, read stderr line by line, read stdout once at exit, write a cancel line on stdin when the user asks. That is the whole contract; it is the same on macOS, Linux and Windows. A host that prefers a library can call `web_geometry_compiler::compile(&Options, progress)` from Rust directly (`main.rs` is 100 lines over it); an N-API or WebAssembly binding is not provided (`unsupported: "N-API binding"`).

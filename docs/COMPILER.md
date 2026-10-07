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
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES RESOURCE_BASE_URL
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES THREADS RAM_MB RESOURCE_BASE_URL
trillion3d-compiler SOURCE CACHE slice|full TRIANGLES THREADS RAM_MB RESOURCE_BASE_URL SIMPLIFICATION
trillion3d-compiler --jobs FILE|-
trillion3d-compiler --version
```

Exactly 5, 7 or 8 positional arguments, plus `--textures-format=` anywhere (`compiler_args.rs`).
Another count prints the usage, emits `INVALID_ARGS` and exits 2; a value out of range is refused
with `INVALID_OPTIONS` (`compiler_validate.rs`). `--version` prints the compiler and format
versions, the drivers and the platform as JSON.

| Argument | Meaning | Default |
|---|---|---|
| `SOURCE` | A folder with `manifest.json`, a `.gltf`/`.glb`, a scene or container of [Input formats](#input-formats), or a folder of such files merged into one scene | required |
| `CACHE` | Output folder, created if missing; one pointer per scope, pruned after each compile, so one source per cache | required |
| scope | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything | required |
| `TRIANGLES` | Positive triangle budget of `slice`; ignored by `full` | required |
| `THREADS` | Worker threads of the job, 1–64 | `2` |
| `RAM_MB` | Admission budget, at least 64: a job estimated above it is refused (`RAM_ADMISSION_BUDGET_EXCEEDED`); a guard, not a process limit | `256` |
| `RESOURCE_BASE_URL` | URL prefix under which the host serves the source folder; relative image URIs are rewritten against it | required |
| `SIMPLIFICATION` | `none`: exact clusters, every one a root; `qem-endpoints`: the coarser levels above them | `none` |
| `--textures-format=` | `all`, `bc7`, `astc`, `etc2` or `none`: the GPU block families cooked beside the lossless levels, kept only where they pass the quality gate ([FORMAT.md](FORMAT.md#textures)) | `all` |

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
    {"id": "city", "source": "scenes/city/city.obj", "cache": "cache/city", "resourceBaseUrl": "/assets/city/"},
    {"id": "london", "source": "scenes/london", "cache": "cache/london", "resourceBaseUrl": "/assets/london/", "threads": 8}
  ]
}
```

| Field | Meaning | Default |
|---|---|---|
| `workers` | Concurrent jobs, at most 64, lowered until the budget holds them | `1` |
| `ramBudgetMb` | Budget of the whole batch, split between workers unless a job sets its own | `256 × workers` |
| `threads` | Default threads per job | `2` |
| `jobs[].id` | Unique job id in events and the summary | `job-<index>` |
| `jobs[].source`, `cache`, `resourceBaseUrl` | As on the command line | required |
| `jobs[].scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides | `full`, `150000`, batch default, batch share, `none` |
| `jobs[].texturesFormat` | As `--textures-format=` | `all` |

Jobs go in file order to the first free worker. Two jobs writing one cache, under any spelling, or
a job asking for more than the whole budget, refuse the batch before it starts (`INVALID_BATCH`).
stdout then carries the summary, `{"status": "ready" | "partial" | "failed", "completed", "failed",
"cancelled", "jobs"}`, each job a pointer or an error, sorted by id; read it rather than the exit
code.

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

| Event | When | Fields |
|---|---|---|
| `batch` | First line of `--jobs` | `jobs`, `workers` |
| `queued` | Each batch job, before any work | `source` |
| `accepted` | A worker starts the job | `source`, `cache`, `scope`, `triangles`, `threads`, `ramBudgetMb`, `simplification` |
| `progress` `import-source` | A converting driver writes its scene | `step` (`parse`, `meshes`, `write`, `complete`, `reused`), `completed`, `total` |
| `progress` `archive` | A container is extracted, then routed | `step` (`extract`, `routed`), `entries`, `bytes`, `chain` |
| `progress` `import` | Scene loaded and validated | `primitives`, `nodes`, `unsupported` (counts by code), `ms` |
| `progress` `primitive` | One primitive clustered and paged, in no fixed order | `mesh`, `primitive`, `pages`, `timings`, `warnings` |
| `progress` `bootstrap` | Root bundles assembled | `completed`, `total` |
| `progress` `coplanar` | Coplanar cuts | `step`, `completed`, `total` |
| `progress` `textures` | One source image baked | `completed`, `total` |
| `progress` `cutouts` | Cutout answer sheet written | `pending`, `sheet` |
| `progress` `tables` | Prepared scene tables written | `counts`, `ms` |
| `progress` `proxy` | Resident lighting proxy built | `triangles`, `nodes`, `errorMetres` |
| `progress` `impostors` | Impostor atlases baked | `baked` |
| `progress` `lights` | `lights.json` written | `lights`, `rejected`, `counts` |
| `progress` `reuse` | A folder under the key kept (`completed: 1`) or refused (`reason`) | `completed`, `files`, `objects`, `textureLevels`, `validateMs`, `reason` |
| `progress` `prune` | Stale keys, imports, objects or texture levels removed | `removedKeys`, `removedObjects`, `removedBytes`, `removedTextures` |
| `progress` `complete` | Pointer written | `pruned` |
| `stall` | Success with stalled DAG groups, before `complete` | `rank`, `mesh`, `primitive`, `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands` |
| `complete` | The job succeeded | `pointer` (as on stdout), `ms` |
| `cancelled` | The job stopped on a cancel request | `code: "CANCELLED"`, `message`, `ms`, catalogue fields |
| `error` | The job failed | `code`, `message`, `ms`, catalogue fields |
| `done` | Last line of `--jobs` | `completed`, `failed`, `cancelled`, `ms` |

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
  "metrics": {"importMs": 1571.7, "clusterHierarchyPagesMs": 1822.8, "wallMs": 3411.2},
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
trillion3d-compile [--strict] [--verbose] SOURCE CACHE [slice|full] [TRIANGLES] RESOURCE_BASE_URL [THREADS] [RAM_MB] [SIMPLIFICATION]
```

It prints the raw JSON events on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them), then the warning
summary as `message` events.

The executable is `options.executable`, else the installed platform package's, else
`TRILLION3D_COMPILER_BIN`, else the checkout's build, refused with `COMPILER_STALE` while a crate
source is newer (`pnpm run build:native`). Elsewhere, a machine no package serves fails with
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

| Program | Code | Meaning |
|---|---|---|
| `trillion3d-compiler` | 0 | Every job ready |
| `trillion3d-compiler` | 2 | Usage error, invalid batch, or a job failed or cancelled; stdout carries the error or the summary |
| `trillion3d-compile` | 1 | Any failure |
| `trillion3d-compile` | 3 | `--strict` and a warning (`STRICT_WARNINGS`); the cache is written |

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

| Format | Driver | Reader and condition | Dropped, counted by code |
|---|---|---|---|
| glTF / GLB | `gltf` | Khronos standard; Draco and meshopt decoded | Nodes outside the rendered scene; quantized positions refused |
| FBX | `fbx` | MIT ufbx, pinned, never the Autodesk SDK | Cameras, area lights, procedural textures, UV transforms |
| OBJ / MTL | `obj` | Published specification, through ufbx ([fixture](../tests/fixtures/formats/README.md#obj)) | MTL `Tr`, `illum`, `-o`, `-s`, `-bm` |
| USD / USDA / USDC | `usd` | AOUSD, TOST 1.0; `openusd` crate, pure Rust | Non-punctual lights, animation (one value kept) |
| USDZ | `usdz` | Stored, aligned ZIP container | As USD |
| Alembic | `alembic` | Open, BSD-3; Ogawa reader written here | All but static geometry |
| `.blend` | `blend` | Documented SDNA, no GPL imposed; reader written here | All but Blender 2.8–5.x meshes, UVs, instances, Principled BSDF |
| Maya ASCII | `ma` | Public MEL command docs; no script executed | Commands outside the read subset |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | `unity` | Documented YAML subset; data only | Scripts |
| `.unitypackage`, ZIP | `unitypackage`, `zip` | tar.gz and ZIP; each file keeps its license | Encrypted archives refused |
| PNG, JPEG, TGA, TIFF, BMP, GIF | one each | Open specifications | Animated GIF, BMP masks above 8 bits |
| OpenEXR, Radiance HDR | `exr`, `hdr` | BSD-3 `exr` crate; HDR reader written here | — |
| PSD / PSB | `psd` | Adobe's published specification | Layers: the flattened composite only |
| DDS, KTX2 | `dds`, `ktx2` | Documented containers; `basisu` Apache-2 | Undeclared codecs, KTX 1.0 |
| WebP | `webp` | Pure Rust `image-webp`, libwebp patent license | Lossy streams, animation |

Not read: `.uasset` / `.umap`, `.max`, `.mb`, native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Export to one of the formats above.

### Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners: a
strictly convex ring becomes a fan, any other is ear-clipped in its own plane so a concave face
keeps its outline, and a ring the ears cannot finish falls back on the fan, counted under
`<driver>-ngon-untriangulable` (`plugins/scene/ngon.rs`).

### Content Licenses — Independent of Format

Audit local asset and license manifests with [the offline license audit](ASSET_LICENSE_AUDIT.md).

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

| Stage | What it does | Module |
|---|---|---|
| Import | Routes each source to its driver; converting drivers write the intermediate glTF under `native/imports/` | `plugins.rs`, `import.rs` |
| Scene loading | Decodes transport compression, keeps the rendered scene's nodes, expands GPU instancing | `compiler_source.rs`, `compressed/mod.rs`, `compiler_nodes.rs`, `compiler_instancing.rs` |
| Admission | Refuses a job above its budget, cuts primitives and images into waves that fit | `compiler_plan.rs`, `compiler_budget.rs` |
| Simplification and DAG | Level 0 clusters, then groups simplified with borders locked and re-split, each measured and diagnosed | `dag.rs`, `dag/`, `qem.rs`, `qem_solve.rs`; corpus `tests/corpus/mod.rs` |
| Pages | Quantized cluster pages, streaming bundles with closed dependency lists, the paged manifest | `geometry_page.rs`, `compiler_bundle_dependencies.rs`, `compiler_manifest_pages.rs` |
| Deformation | Joints, weights, morph targets and soft-body ids carried into the pages with their bounds | `geometry_page_deform.rs` |
| Coplanar cuts | One order for surfaces sharing a plane | `coplanar.rs` |
| Textures | Every mip level, lossless and the gated block family, keyed by the image's SHA-256 | `compiler_textures.rs`, `texture_preview.rs` |
| Cutouts | Alpha measured during the texture decode; only answered entries applied | `cutout.rs` |
| Scene tables | The node graph, lights and surfaces the runtime builds its scene from | `compiler_tables.rs` |
| Proxy and impostors | The resident lighting proxy; octahedral impostor atlases | `proxy.rs`, `impostor.rs` |
| Physics cook | Colliders, rigid and soft bodies cooked by native Jolt | `physics_cook.rs` |
| Lights | The source's lamps in the engine's contract | `compiler_lights.rs` |
| World roots | Objects' roots grouped per partition cell into world super-roots | `compiler_world_roots.rs` |
| Identity and reuse | The cache key; the proof of an existing folder | `compiler_identity.rs`, `compiler_reuse.rs` |
| Publication | Atomic writes, pointer, prune, cache lock | `compiler_storage.rs`, `compiler_publish.rs`, `compiler_prune.rs`, `compiler_lock.rs` |

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

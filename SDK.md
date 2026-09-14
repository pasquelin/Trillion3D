# Web Geometry SDK

Standalone compiler/runtime. Public imports are `@web-geometry/sdk` (core), `/node` and `/browser`. Do not import `packages/` internals.

Build: `npm install`, `npm run build`, `npm test`. Native: `npm run build:native` and `npm run test:native`. `SDK_VERSION` and `FORMAT_VERSION` are independent.

The generic SDK has no asset URL defaults. Hosts must pass `resourceBaseUrl` to `prepare` and `manifestUrl` to `createExplorer`. The shared default scope is `slice`. Pointers and compiled manifests with another scope are rejected with `SCOPE_MISMATCH`.

A host that probes a cache before opening it — to enable a button, to tell a user to recompile — calls `assertCachePointer(pointer, scope)` and `assertCacheReady(metadata, scope)` on the two JSON documents it fetched: the first returns the cache URL the pointer names, the second returns the selected triangle count, and both raise an `EngineError` (`INVALID_POINTER`, `CACHE_NOT_READY`, `SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `INVALID_CACHE`, `STALE_CACHE`) otherwise. These are the same checks `createExplorer` runs, so a host never has to read a format field itself. They deliberately require no cluster, and therefore no binary sidecar download; the identity of the clusters themselves is `assertCacheIdentity`, which the reader runs on the decoded manifest.

The compiler publishes under `native/<scope>/manifest.json`. See [the cache format](docs/FORMAT.md).

The compiler rejects selected accessors that cross their `bufferView`, invalid strides, malformed sparse ranges/indices and invalid POSITION/index component contracts before publishing a ready pointer. Simplification error is meshoptimizer's reported relative error scaled to object space; it is not a certified global Hausdorff bound. Cache keys include the executed compiler implementation and its dependency lock. Recompile prepared assets to use these corrections; source files are never overwritten.

## Entry points

| Import | Symbols |
|---|---|
| `@web-geometry/sdk` or `/core` | `SDK_VERSION`, `FORMAT_VERSION`, `DEFAULT_SCOPE`, `assertFormat`, `assertCachePointer`, `assertCacheReady`, `assertCacheIdentity`, `EngineError`, `createJob`, `createSafetyPolicy`, `userNotice`, `compareImages`, `summarize`, `frameStatistics`, `makeCameraPath`, `CAMERA_SCENARIOS`, `DIAGNOSTICS`, `LOD_QUALITY`, `lodQuality`, `adaptivePixelError` |
| `@web-geometry/sdk/node` | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `getSdkProvenance`, CLI |
| `@web-geometry/sdk/browser` | `createExplorer`, `createExplorerJob`, `runCameraPath`, `createGpuPageCache`, `httpPageSource`, `detectCapabilities`, `replicateInstances` (1/4/9 replica helper), `webgpuPagesBackend`, backend factories |

`replicateInstances` is a helper that instances the source 1, 4 or 9 times while sharing geometry and materials.

## CLI

```
web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL [threads] [RAM_MB] [none|qem-endpoints]
```

`SOURCE` is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, a `.gltf`/`.glb` file, a `.fbx`/`.obj` file, or a directory of `.fbx`/`.obj` files (merged into one scene). `WEB_GEOMETRY_COMPILER_BIN` (or `PrepareOptions.executable`) selects the native executable.

### Native executable

`web-geometry-compiler` is the only place work happens; Node, Electron or any other host just launches it and relays what it says. It has no runtime dependency: FBX and OBJ are read by ufbx compiled into the binary, so no Blender or converter is required.

```
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]
web-geometry-compiler --jobs FILE|-
web-geometry-compiler --version
```

Three streams, nothing else:

- **stderr**: one JSON object per line, `{"event": ..., "job": ...}` with `event` in `queued`, `accepted`, `progress` (with `phase`, `completed`, `total`), `complete` (with `pointer`), `cancelled`, `error` (with `code`, `message`), plus `batch` and `done` for `--jobs`.
- **stdout**: for one job, the pointer only (`status`, `key`, `scope`, `url`, `pointer` path, `cache`, headline counts and `metrics`); for `--jobs`, a summary `{status, completed, failed, cancelled, jobs:[...]}`. The compiled manifest is never printed: it is on disk at `<cache>/native/<scope>/<key>/clusters.json` (+ `clusters.bin`), and `<cache>/native/<scope>/manifest.json` points at it.
- **stdin**: a JSON line `{"cancel":"*"}` or `{"cancel":"<job>"}` cancels cooperatively; the process exits with the job marked `CANCELLED`. Killing the process is also safe because every file is written atomically.

Exit code 0 when every job is ready, 2 otherwise. `--jobs` reads `{"workers":N,"ramBudgetMb":total,"threads":default,"jobs":[{"id","source","cache","resourceBaseUrl","scope","triangles","threads","ramBudgetMb","simplification"}]}` and runs `workers` jobs at a time, each with `ramBudgetMb/workers` unless the job says otherwise.

FBX/OBJ sources are first imported into `<cache>/native/imports/<key>/` as `model.gltf` + `model.bin` + `manifest.json` (keyed by the input hashes and the importer version, reused when unchanged); the import manifest lists what the importer could not carry (`unsupported`) and ufbx warnings (`notes`). Units are converted to metres and axes to glTF (right-handed, Y up); geometry is copied as-is; materials map to `pbrMetallicRoughness` (a bound texture replaces the colour); textures resolve to PNG/JPEG files inside the source directory (served under `RESOURCE_BASE_URL`) or to embedded bytes; punctual lights become `KHR_lights_punctual`. Animation, skinning, blend shapes, cameras and GPU-only texture formats are not carried.

`prepare()` always sends the eight-argument form (defaults: 2 threads, 256 MB admission, `none` simplification), reads the pointer from stdout and returns the manifest read from disk. `prepareMany(jobs, {workers, ramBudgetMb, threads, onEvent})` runs one `--jobs` process and returns its summary (pointers only).

## Browser explorer

`createExplorer(canvas, { manifestUrl, scope, width, height, fov, pixelRatio, maxResidentPages, pageFetchWorkers, replicaCount, backends, pixelError, preload, comparisonLayout, comparisonPair, gpu, pointsOfInterest, ... })` owns neither the animation loop nor the canvas. Call `dispose()` when finished; hosted Orbit/Fly controls created through the explorer are disposed with it. The default camera is framed from the loaded bounding box (`near = radius / 10000`, no absolute floor). `pointsOfInterest()` returns that home pose; extra named poses come from the host `pointsOfInterest` option, not from the SDK. `pixelError` (default `0`) keeps the exact leaves; a positive threshold selects coarse QEM pages when the cache includes them. `preload: 'visible'` (default) streams detail for the current camera; WebGPU first loads a complete, camera-independent root cover before explorer creation resolves; `preload: 'all'` restores the previous eager load. `awaitPages()` must be called before the first official image when using the visible preload. Comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) render backends A and B to detached targets with the same camera; they are not an official performance verdict.

`autonomousGeometry: true` selects the prepared-page WebGL2 backend for wholly static opaque/masked assets. It reads `scene.gltf` and verified geometry pages without downloading the full source geometry buffer; a complete root cover is resident before rendering and useful detail streams afterward. The mode rejects caches without `autonomousScene`, BLEND/skinned/morph scenes and custom backend lists. Existing WebGPU and Three comparison paths still use `source.gltf` and its complete geometry buffer. Material images remain eager in this mode, and GPU-driven selection, indirect drawing and hybrid rasterization are not provided by this WebGL2 path.

`runCameraPath` is a campaign helper: exact A/A image gate, then timed blocks. It is not a general performance verdict. Hosts that already switch backends in the UI should replay the same pose list per backend; do not mix engines inside one timed block.

The `wireframe` diagnostic is a filled unique color per submitted triangle, not `MeshBasicMaterial.wireframe` / GL_LINES. Cluster, page and LOD diagnostics stay on the selected backend's actual cut.

`createGpuPageCache` is a bounded WebGPU buffer/queue adapter. `webgpuPagesBackend` (`webgpu-page-raster`) consumes the same pages and LOD settings. For opaque pages, selection computes the current camera's drawable resident cut on the GPU, retaining complete coarse coverage until every required child is resident. Draw compaction consumes that mask, counts and scatters in parallel groups, and the visibility shader consumes the resulting instance indices and slot offsets against the original page table. No CPU compaction or CPU opaque selection repeats that work. Asynchronous selection readback serves streaming requests and diagnostics; busy readbacks do not block current-camera selection. Selection/submission counters stay `null` until the matching GPU result is available. Transparency keeps its existing forward path; secondary-camera surface captures and unsupported GPU paths retain the CPU selection fallback. `capabilities.gpuDriven` denotes this opaque selection-to-draw path, not a completely GPU-autonomous engine. The visibility path issues at most six geometry `drawIndirect` commands (cull mode × Hi-Z pass); material, lighting, transparency and presentation add their own draw commands.

### Separated surfaces and lighting (pipeline version 1)

The opaque/masked path writes visibility, then reconstructs material properties into three `rgba16float` textures and one `r32uint` texture (28 logical bytes per pixel): base color/metalness, world normal/roughness, emission/AO, and surface flags. Depth uses `depth32float`. Lighting consumes these surfaces and reconstructs world position from depth and the inverse view-projection matrix. Transparency is shaded separately into the HDR target. ACES and sRGB conversion occur at final composition. This changes transparent compositing relative to the previous display-encoded blend; its visual validation remains required.

When a WebGPU canvas is present, final composition writes the same display value to the persistent `rgba8unorm` capture target and the canvas `bgra8unorm` attachment in one pass (`WG HDR composition + present`). This removes the separate fullscreen presentation draw and its logical RGBA8 read (4 bytes per pixel); it does not reduce frame-target allocation or change HDR blending, material precision, or surface captures. Texture-only and secondary-camera renders keep single-target composition. Explicit synchronous capture and main-view restoration may still copy the persistent target to the canvas outside normal rendering.

`sceneLighting?: THREE.Object3D` supplies the host light graph; otherwise the loaded glTF light graph is retained, including when geometry is replicated. Directional, point, spot, hemisphere and ambient lights are adapted to a bounded GPU buffer (maximum 256 visible lights; excess and unsupported light types fail explicitly). The existing hemisphere/sun rig is used only when the graph has no authored lights. Hiding or extinguishing authored lights does not restore that rig. Existing light transforms, colors, visibility and intensity are updated each render; call `explorer.refreshSceneLighting()` after adding or removing lights. The Three reference and LOD adapters use the same light source. Shadows, environment-map lighting, area lights, probes and global illumination are not implemented in the WebGPU path.

For `backends: [webgpuPagesBackend]`, `createExplorer` presents directly to the host WebGPU canvas without creating its normal Three WebGL renderer. A mixed-backend explorer retains WebGL composition through an intermediate GPU canvas/`CanvasTexture`; this cross-API composition has a separate cost and must not be conflated with direct presentation. Neither normal path calls `copyTextureToBuffer` for the image. No physical zero-copy or performance gain is claimed without browser measurements. Geometry-selection feedback is separate from image readback and still exists.

`maxFrameAllocationBytes` defaults to 256 MiB. It bounds logical WebGPU frame targets, a conservative reservation for Hi-Z image/pyramid resources, one live surface capture and explicit asynchronous image staging. It excludes geometry, material texture atlases, fixed per-page work buffers, CPU memory and the optional WebGL diagnostic capture context. It is not a total-device memory limit. Allocation logs describe that scope; physical `vramBytes` remains `null`. Geometry allocation metrics count allocated geometry buffers, including concatenated attributes, rather than just currently selected CPU arrays.

WebGPU pins the root cover for the lifetime of the backend, including its CPU index bytes. A region keeps a complete resident representation until all replacement pages have been uploaded; queue writes precede subsequent draws on the same GPU queue. If old and new detail cannot coexist, the renderer returns to the root cover before reclaiming old slots. Shared URLs occupy one slot across instances. `maxResidentPages` includes the pinned cover: preparation rejects `INITIAL_COVERAGE_BUDGET` if it cannot fit. If requested detail plus the cover cannot fit, rendering retains a complete available cut and reports `coverageBudgetLimited: true`; it may therefore be coarser than the requested pixel error. This does not bound total scene memory or certify the compiler's simplification quality. Standalone backends must supply validated `readPage(url)` or preload the root bytes; otherwise they submit no image until the complete initial cover is available.

`FrameMetrics.coverageReady` reports initial GPU coverage, `coverageBudgetLimited` reports blocked detail admission, and `streamingError` preserves the latest page-loading failure (`null` when absent). Other backends report coverage as `null`.

Two counters say different things about pages, and a host that confuses them reads thrashing where there is none:

| Field | Meaning | Reported by |
|---|---|---|
| `pagesDetached` | Clusters that left the drawn cut since the backend was created. A moving camera detaches clusters on every frame; this is a measure of cut churn, not of memory pressure. | `exact-cluster-pages` (WebGL). `null` elsewhere. |
| `cacheEvictions` | Pages actually evicted from the cache that feeds the drawn geometry — the backend's own GPU page cache when it owns one (`webgpu-page-raster`, `autonomous-pages`), the host page streamer otherwise. This is the memory-pressure signal. | every backend |

A bounded cache evicting nothing while `pagesDetached` climbs is the normal state of an exploration. Background loads attempt a failed URL at most three times per explorer, then stop retrying it; reload the explorer to retry after repairing the source. `awaitPages()` rejects a failed requested URL. Initial cover read failures reject preparation. Diagnostics include `coverage-bootstrap-start`, `coverage-bootstrap-ready`/`coverage-bootstrap-failed`, `coverage-budget` (delivered during `flush()`), `coverage-upload-failed`, and `coverage-streaming-failed`. The `render-progress.coverage` object uses version 1. CPU cache eviction cannot remove an active GPU fallback; deferred evictions apply when its detail pages are released.

`await explorer.captureSurfaceView(pose, {width, height, signal})` returns an owned `SurfaceCapture` version 1 with the four material textures, depth, inverse view-projection, camera position and selected triangle count. The host must serialize this operation with ordinary rendering and call `capture.dispose()` before requesting another capture. It reuses the engine's geometry and page cache, selects for the requested camera, rejects missing pages/insufficient budgets, and restores the main viewport and camera afterward. Translucency is excluded from these surface textures. The current implementation executes views sequentially and reallocates frame targets when dimensions change; it is not a batched multi-view renderer. It provides a concrete surface interface for future GI work, not Lumen cards, distance fields, ray tracing, velocity or a populated Surface Cache.

If visibility/material initialization fails in a direct WebGPU session, the engine fails visibly. It also rejects transmission rather than silently leaving it out. Mixed sessions retain the earlier reported fallback path; inspect `unsupported` and diagnostics and reject fallbacks for quality/performance comparisons. Per-texture transforms/UV channels/sampler modes, skinning, morph targets and the full material contract remain unsupported. No compiler/cache-format migration or new LOD algorithm is part of this integration.

### WebGPU visual checks and diagnostics


`diagnosticDetail: "trace" | "summary"` controls event detail. An `onDiagnostic` observer defaults to trace; omit the observer to disable collection. The Lab's model bench enables **Mode debug** by default and saves this choice in the report. Debug frames are marked `measurementKind: "diagnostic"`, including beauty renders. Turn debug off before collecting performance evidence.

Trace covers host frames and camera poses, selection decisions and fallback reasons, complete coverage/admission, residency queues and protections, CPU cache reads and hash verification, retries/errors, GPU slot generations/uploads, actual cache eviction, draw-list detachments, target allocations, rendering steps, and capture/disposal boundaries. Page catalogues and numeric page references avoid repeating long URLs in every snapshot. Missing physical measurements remain `null`; a successful image or coverage flag does not certify compiler correctness or visual parity.

Explorer events carry a session ID, a monotonic sequence and their creation timestamp. The host queues observer delivery outside the measured call, with a 65,536-event pending limit and an explicit `diagnostic-loss` record on overflow. `createDiagnosticChannel` exposes `flush()`, `flushSync()`, `pending()` and `dropped()` for standalone hosts. Do not discard a loss record. The Lab streams the full report to a compressed archive and extracts its complete JSONL journal plus capture gallery. The pending archive does not mark success until writing finishes. The Lab archives sequence/session metadata alongside the event context; file export and observer work can still affect scheduling and the next frame.

Every SDK build records SHA-256 hashes of distributed JavaScript modules in its configuration event. A direct source import has `hash: null`; it must not claim a compiled build identity. These hashes identify code, while the cache's compiler/format metadata identifies prepared assets.

CPU scheduling, asynchronous elapsed time, command encoding and GPU pass execution have distinct scopes. GPU trace status records unavailable instrumentation, busy/skipped frames, invalid timestamps and discarded output. A pass-duration sum excludes separate selection dispatches, transfers and display latency. No total VRAM measurement is inferred from allocated buffers.

`onDiagnostic(event)` receives structured phases with `pipelineVersion: 1`: `gpu-presentation` (direct, mixed composition or texture-only), `frame-allocation` (dimensions/reserved bytes/budget), `material-textures`, `material-textures-ready`, `material-surfaces-ready`, `scene-lighting`, `render-capabilities`, and the first readback/presentation samples. `render-progress` reports selected/resident pages, triangles and pending pages during explicit `flush()` calls. In `diagnosticDetail: "summary"`, progress and CPU samples retain the two-second cadence. In `"trace"`, each render also produces detailed records; observers are deferred outside the synchronous measured render call. Surface capture emits start, ready/failure, restoration and release phases. Failures include their phase and error and are deduplicated. Device loss and uncaptured GPU errors are reported. Observer exceptions cannot interrupt this backend. These diagnostic durations are not frame-performance measurements.

The browser requests `timestamp-query` when the adapter advertises it. `gpu-timing-status` reports availability. In summary mode, at most one submission per 60 render calls is instrumented; trace mode requests instrumentation on every render call, with one outstanding readback, at most 64 pass pairs, two fixed 1 KiB buffers and 128 queries allocated lazily. Busy samples are skipped; retained results are bounded to eight. Readback maps asynchronously, and `flush()` publishes `gpu-timing` events outside the beauty loop. Each result carries its render frame, submission number, camera, viewport and per-pass milliseconds, including Hi-Z, draw compaction, visibility, materials, lighting, transparents, HDR composition and direct presentation when those passes execute. `sumPassMs` sums timed pass intervals; it is not end-to-end GPU frame latency and excludes separate GPU selection dispatches, transfers and presentation latency. The host's per-frame `gpuMs` remains null rather than assigning a delayed sample to a different frame. Missing/reversed timestamps are null with their raw pair and reason; any invalid or truncated pass makes the sum null. Actual map/allocation failures disable profiling, emit `gpu-timing-unavailable` and leave rendering available. Timestamp resolution depends on the browser/device.

`cpu-timing` reports backend render duration, light updates, selection, residency scheduling/target management, and command encoding/submission. `transparentEncodeMs` is a subset of `encodeSubmitMs`, not an extra duration to add. CPU logs carry their own frame/submission identifiers. Summary mode publishes at most once every two seconds during `flush()`; trace mode preserves each frame. Async residency waiting and GPU execution are not counted as CPU work. Profiling introduces overhead, so its samples are diagnostic evidence rather than a controlled performance verdict.

WebGPU filters transparent meshes against the current camera frustum before uploading their per-frame uniforms or issuing their draws. Bounds cover the complete transformed geometry, preserving objects that intersect the frustum. Source transforms are baked during preparation, as with the existing geometry path. `frustumCulled: false` and unavailable/nonfinite bounds conservatively retain a mesh. This does not add transparent LOD, occlusion culling or transparency sorting. `FrameMetrics` exposes `transparentMeshes` (retained meshes), `transparentFrustumRejected`, `transparentDrawCalls` and `transparentSubmittedTriangles`; the latter two include both passes of double-sided materials when required. Unsupported backends leave these metrics null. The bounded `render-progress` event includes the same counters in `transparent`, with `version: 1`, total candidates and `gpuMs: null`: command counts do not measure GPU duration.

For image checks, call `setPose()`, `awaitPages()`, `render()`, then `await flush()` and `capture()`. The WebGPU `flush()` performs an explicit asynchronous image readback outside the beauty loop; `capture()` returns bottom-left RGBA bytes for that submitted frame. If a browser host renders again and immediately calls the existing synchronous `capture()` API, an isolated WebGL canvas copies the current GPU canvas and reads its pixels on demand; `capture-synchronous` identifies this expensive compatibility path. It is never used by normal `render()`. A texture-only backend rejects unavailable/stale captures. Serialize `flush()` with explicit host rendering; a frame changed by a host render during readback is rejected rather than returned as current. Streaming completion during readback retains the accepted page bytes and defers its automatic redraw to the next render, preserving the captured frame. The first such deferral emits `capture-streaming-deferred`. The WebGL backends continue reading their rendered default framebuffer so pinned Three r174 tone mapping matches the displayed image.

With Render Tech Lab running locally and this SDK built (`npm run build`), run:

```sh
node test/webgpuBeauty.browser.mjs
node test/webgpuEmerald.browser.mjs
node test/webgpuCapture.browser.mjs
```

The runners use the Lab's installed Playwright and Chrome's actual WebGPU device. `LAB_ROOT` and `LAB_URL` select the Lab checkout and server (defaults: adjacent `render-tech-lab`, `http://localhost:5174`). The material check compares nine pixels on 18 fixtures with a two-level RGB tolerance and rejects missing diagnostics or GPU failures. The Emerald check replays ten banc 15 poses on the same source, camera, 1012×1000 viewport and pixel error 1. It saves PNGs, per-view differences, source fingerprints and logs under `benchmark-runs/webgpu-visual/`. A successful runner execution is **not** a full-scene visual-parity verdict: inspect the measured differences and screenshots. Neither runner measures performance or proves memory stability.

The current WebGPU path still lacks per-texture transforms/UV channels/filter modes, environment maps, shadows and the full material contract. Padded texture-array boundaries, transparent compositing and full-scene pixel differences still need dedicated parity checks. The CPU shading oracle encodes linear lighting to sRGB without ACES; it is not a substitute for the displayed-image comparisons.


The separated pipeline has completed real Lab paths and A/A checks; full material parity and a controlled performance verdict remain unvalidated. Start the Lab recipe with material fixtures, then Emerald with fixed camera, resolution, lights, pixel error and warmup. Verify actual direct-presentation logs, independent A/A captures, foreground coverage, transparent compositing and second-view restoration before timing. Preserve raw source hashes and results; old reports do not validate this code. Node tests validate orchestration/CPU contracts with GPU doubles and do not execute WGSL.

The existing model report can be verified without starting a renderer:

```sh
LAB_ROOT=../render-tech-lab node --experimental-strip-types test/debugLogging.archive.mjs ../render-tech-lab/reports/15-virtualized-integration/campaign-ID
```

This check compares every journal event and capture against the original compressed report, verifies hashes, diagnostic sequences and measured sample counts. It does not rerun the campaign.

For prepared WebGPU scenes, `maxTextureTransferBytesPerFrame` bounds source texture uploads; missing layers use white or neutral-normal fallbacks. Frame metrics expose `textureUploaded`, `texturePending`, `textureSkipped` and `totalSubmittedTriangles`. `createExplorer` exposes `renderViews(poses)` for successive captures. Its `addInstance`, `updateInstance`, `removeInstance`, `updateMaterial` and `replaceGeometryPage` methods currently require the autonomous WebGL2 backend; other backends return `UNSUPPORTED_SCENE_UPDATE`.

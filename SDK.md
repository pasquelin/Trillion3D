# Web Geometry SDK

Standalone compiler/runtime. Public imports are `@web-geometry/sdk` (core), `/node`, `/browser` and `/compiler-reference`. Do not import `packages/` internals.

Build: `npm install`, `npm run build`, `npm test`. Native: `npm run build:native` and `npm run test:native`. `SDK_VERSION` and `FORMAT_VERSION` are independent.

The generic SDK has no asset URL defaults. Hosts must pass `resourceBaseUrl` to `prepare`/`prepareReference` and `manifestUrl` to `createExplorer`. The shared default scope is `slice`. Pointers and compiled manifests with another scope are rejected with `SCOPE_MISMATCH`.

JavaScript reference and native Rust caches use separate roots: `reference/<scope>/manifest.json` and `native/<scope>/manifest.json`. See [Format 1](docs/FORMAT.md).

## Entry points

| Import | Symbols |
|---|---|
| `@web-geometry/sdk` or `/core` | `SDK_VERSION`, `FORMAT_VERSION`, `DEFAULT_SCOPE`, `assertFormat`, `EngineError`, `createJob`, `createSafetyPolicy`, `userNotice`, `compareImages`, `summarize`, `frameStatistics`, `makeCameraPath`, `CAMERA_SCENARIOS`, `DIAGNOSTICS`, `LOD_QUALITY`, `lodQuality`, `adaptivePixelError` |
| `@web-geometry/sdk/node` | `prepare`, `prepareReference`, `createCompilationJob`, `filesystemStore`, `getSdkProvenance`, CLI |
| `@web-geometry/sdk/browser` | `createExplorer`, `createExplorerJob`, `runCameraPath`, `createGpuPageCache`, `httpPageSource`, `detectCapabilities`, `replicateInstances` (1/4/9 replica helper), `webgpuPagesBackend`, backend factories |
| `@web-geometry/sdk/compiler-reference` | `compileAsset`, `hierarchy`, `CLUSTER_INDEX_COUNT` |

`replicateInstances` is a helper that instances the source 1, 4 or 9 times while sharing geometry and materials.

## CLI

```
web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL
```

`SOURCE` is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, or a `.gltf`/`.glb` file.

Writes the final JSON result to stdout and progress JSON lines to stderr. `WEB_GEOMETRY_COMPILER_BIN` selects a native executable; `RTL_ASSET_COMPILER_BIN` remains a compatibility alias.

The native binary is `web-geometry-compiler` (alias `rtl-asset-compiler`). Direct invocation accepts five, seven or eight arguments:

```
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]
```

`prepare()` always sends the eight-argument form (defaults: 2 threads, 256 MB admission, `none` simplification).

## Browser explorer

`createExplorer(canvas, { manifestUrl, scope, width, height, fov, pixelRatio, maxResidentPages, pageFetchWorkers, replicaCount, backends, pixelError, preload, comparisonLayout, comparisonPair, gpu, pointsOfInterest, ... })` owns neither the animation loop nor the canvas. Call `dispose()` when finished; hosted Orbit/Fly controls created through the explorer are disposed with it. The default camera is framed from the loaded bounding box (`near = radius / 10000`, no absolute floor). `pointsOfInterest()` returns that home pose; extra named poses come from the host `pointsOfInterest` option, not from the SDK. `pixelError` (default `0`) keeps the exact leaves; a positive threshold selects coarse QEM pages when the cache includes them. `preload: 'visible'` (default) fetches only the pages required by the current camera; `preload: 'all'` restores the previous eager load. `awaitPages()` must be called before the first official image when using the visible preload. Comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) render backends A and B to detached targets with the same camera; they are not an official performance verdict.

`runCameraPath` is a campaign helper: exact A/A image gate, then timed blocks. It is not a general performance verdict. Hosts that already switch backends in the UI should replay the same pose list per backend; do not mix engines inside one timed block.

The `wireframe` diagnostic is a filled unique color per submitted triangle, not `MeshBasicMaterial.wireframe` / GL_LINES. Cluster, page and LOD diagnostics stay on the selected backend's actual cut.

`createGpuPageCache` is a bounded WebGPU buffer/queue adapter. When a WebGPU device is available, `createExplorer` adds `webgpuPagesBackend` (`webgpu-page-raster`): same Format 1 pages. GPU frustum + `lodScore` selection plus conservative backface cones (prepare-time page cones, `coneRejects` with perspective spread). Visbuffer encode instances resident pages from the page table and issues at most six non-indexed `drawIndirect` commands (cull mode × Hi-Z pass). `selectVisiblePages` and `applyTemporalHiz` remain the A/A oracles and the silent fallbacks. Compaction is a stable exclusive scan; overflow or a missing compact pipeline restores the per-page `draw()` loop and keeps `'indirect draw'` in `unsupported`. GPU compute selection sets `capabilities.gpuDriven` when compute pipelines exist; otherwise the CPU oracle is used silently. Vertex pulling from resident slots writes a visibility buffer (packed page+triangle IDs) then a second pass reconstructs attributes and applies glTF 2.0 Cook-Torrance GGX PBR specular, hemispherical diffuse IBL, and split-sum Karis specular environment reflection. `KHR_materials_transmission` (and volume), skinned meshes, and morph targets stay on the unsplit Three.js mesh (`shared-blend` pass). `runCameraPath` still allows `maxChannelError <= 2` when the renderer string contains WebGPU. GPU color is presented through a pooled blit (CPU `rasterVisibilityIds` / `shadeVisibility` are the test oracles). Occlusion culling uses a 2-phase Temporal Hi-Z pipeline: Pass 1 renders previously visible occluders, a GPU Hi-Z pyramid is built from that pass's depth (r32float, background 1, max reduction), and Pass 2 retests previously occluded or newly disoccluded pages with `loadOp: 'load'`. The final pyramid is retained for next-frame reprojection. Remaining ⊆ `selectVisiblePages`. The JS kernel (`hizRejects` / `applyTemporalHiz` / `rasterVisibility` depth) is the A/A oracle; a GPU non-rejection is not an error. Node tests do not execute WGSL. If compute Hi-Z is missing, CPU `applyTemporalHiz` remains the silent fallback. If `r32uint` vis targets or the shade pipeline cannot be created, the previous untextured page raster stays and Hi-Z stays off. Visible pages stream with `preload: 'visible'`. Silent Three.js fallback if the device is missing or lost; `dispose` destroys the device. The default displayed backend remains the WebGL2 reference.

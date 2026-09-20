# Web Geometry SDK

Standalone compiler/runtime. Every public import uses `web-geometry`; conditional exports select
the common, browser or Node API. Do not import `packages/` internals.

Build: `pnpm install`, `pnpm run build`, `pnpm test`. Native: `pnpm run build:native` and `pnpm run test:native`. `SDK_VERSION` and `FORMAT_VERSION` are independent.

The generic SDK has no asset URL defaults. Hosts must pass `resourceBaseUrl` to `prepare` and `manifestUrl` to `createExplorer`. The shared default scope is `slice`. Pointers and compiled manifests with another scope are rejected with `SCOPE_MISMATCH`.

A host that probes a cache before opening it — to enable a button, to tell a user to recompile — calls `assertCachePointer(pointer, scope)` and `assertCacheReady(metadata, scope)` on the two JSON documents it fetched: the first returns the cache URL the pointer names, the second returns the selected triangle count, and both raise an `EngineError` (`INVALID_POINTER`, `CACHE_NOT_READY`, `SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `INVALID_CACHE`, `STALE_CACHE`) otherwise. These are the same checks `createExplorer` runs, so a host never has to read a format field itself. They deliberately require no cluster, and therefore no binary sidecar download; the identity of the clusters themselves is `assertCacheIdentity`, which the reader runs on the decoded manifest.

The compiler publishes under `native/<scope>/manifest.json`. See [the cache format](FORMAT.md).

The compiler rejects selected accessors that cross their `bufferView`, invalid strides, malformed sparse ranges/indices and invalid POSITION/index component contracts before publishing a ready pointer. Simplification error is meshoptimizer's reported relative error scaled to object space; it is not a certified global Hausdorff bound. Cache keys include the executed compiler implementation and its dependency lock. Recompile prepared assets to use these corrections; source files are never overwritten.

## Installation and environment API

The package remains private and is installed from this repository or a local tarball; it is not
published to npm. Browser bundlers must honor the standard `browser` export condition. Node ESM and
NodeNext select the Node branch. A resolver with no platform condition receives the safe common
branch, which contains no DOM, WebGPU, filesystem or process API.

| Task                | Examples                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common API          | `SDK_VERSION`, `FORMAT_VERSION`, `assertFormat`, `EngineError`, batch maths, hierarchy, camera calculations, diagnostics, lighting contracts, jobs and safety policy                                       |
| Native preparation  | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `reviewCutouts`, `getSdkProvenance`, CLI                                                                |
| Browser exploration | `createExplorer`, `createExplorerJob`, `runCameraPath`, `createGpuPageCache`, `httpPageSource`, `detectCapabilities`, `replicateInstances` (1/4/9 replica helper), `webgpuPagesBackend`, backend factories |

Version 0.2.0 is the breaking import boundary. Replace `@web-geometry/sdk`,
`@web-geometry/sdk/core`, `@web-geometry/sdk/browser` and `@web-geometry/sdk/node` with
`web-geometry`. The former package name and subpaths are no longer exported. `SDK_VERSION` advances
to `0.2.0`; `FORMAT_VERSION` and compiler/cache identity do not change.

For a strict browser TypeScript project, enable the `browser` condition explicitly. Without it,
Bundler resolution deliberately selects the platform-neutral common declarations, which do not
contain `createExplorer` or browser-only types.

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "customConditions": ["browser"],
    "lib": ["ES2023", "DOM"],
    "types": ["@webgpu/types"],
  },
}
```

Install the SDK's browser type dependencies in the host project: `three` is a peer dependency, and
`@types/three` plus `@webgpu/types` are development dependencies. A Node TypeScript host instead
uses `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` and `"types": ["node"]`; NodeNext
then selects the Node declarations from the same `web-geometry` specifier.

The browser runtime is not a zero-configuration single-file bundle. Configure the bundler with the
public `web-geometry` import as the application entry, the installed decode and integration worker
files as separate module-worker entries, and code splitting enabled. Copy the installed
`pageCodec.wasm` beside every emitted chunk that retains its relative URL. Serve only that output
directory together with the compiled scene cache. `pnpm run proof:package -- --browser` is the
repository's executable esbuild configuration and verifies both worker tasks and WASM selection.

`replicateInstances` is a helper that instances the source 1, 4 or 9 times while sharing geometry and materials.

## CLI

```
web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL [threads] [RAM_MB] [none|qem-endpoints]
```

`SOURCE` is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, a `.gltf`/`.glb` file, a `.fbx`/`.obj` file, or a directory of `.fbx`/`.obj` files (merged into one scene). `WEB_GEOMETRY_COMPILER_BIN` (or `PrepareOptions.executable`) selects the native executable.

Compiler selection uses `PrepareOptions.executable` first, then `WEB_GEOMETRY_COMPILER_BIN`, then
the package-relative development build. The packed artifact contains neither that native executable
nor the Rust sources needed to build it, so an installed tarball requires one of the first two
explicit selections. The installed-package proof supplies a repository-built executable and does
not claim that the tarball ships it.

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

Exit code 0 when every job is ready, 2 otherwise. `--jobs` reads `{"workers":N,"ramBudgetMb":total,"threads":default,"jobs":[{"id","source","cache","resourceBaseUrl","scope","triangles","threads","ramBudgetMb","simplification"}]}` and runs `workers` jobs at a time, each with `ramBudgetMb/workers` unless the job says otherwise. `ramBudgetMb` is the budget of the whole batch: the admitted concurrency is lowered until the jobs running together fit in it, and a job asking for more than the total is refused as `INVALID_BATCH`.

FBX/OBJ sources are first imported into `<cache>/native/imports/<key>/` as `model.gltf` + `model.bin` + `manifest.json` (keyed by the input hashes and the importer version, reused when unchanged); the import manifest lists what the importer could not carry (`unsupported`) and ufbx warnings (`notes`). Units are converted to metres and axes to glTF (right-handed, Y up); geometry is copied as-is; materials map to `pbrMetallicRoughness` (a bound texture replaces the colour); textures resolve to PNG/JPEG files inside the source directory (served under `RESOURCE_BASE_URL`) or to embedded bytes; punctual lights become `KHR_lights_punctual`. Animation, skinning, blend shapes, cameras and GPU-only texture formats are not carried.

`prepare()` always sends the eight-argument form (defaults: 2 threads, 256 MB admission, `none` simplification), reads the pointer from stdout and returns the manifest read from disk, its `metrics` completed by the measurements only the pointer holds — `wallMs` and `pruneMs`, taken after the manifest was written. The manifest stays authoritative for every measurement it carries; the pointer only fills in what is missing. `prepareMany(jobs, {workers, ramBudgetMb, threads, onEvent})` runs one `--jobs` process and returns its summary (pointers only).

`prepareMany` resolves with the `BatchSummary` whenever the compiler printed one, and the compiler prints one whether or not every job succeeded: `{status: 'ready' | 'partial' | 'failed', completed, failed, cancelled, jobs}`. A partly successful batch exits 2 and is a resolved `partial` summary, not a rejection — read `jobs` to see which entries carry a `pointer` and which carry a `code`. It rejects only when no summary came back: a batch the compiler refused outright (`INVALID_BATCH`), a missing pointer, a cancelled run, or a spawn failure.

## Scene hierarchy foundation

`web-geometry` publishes scene-model version `SCENE_MODEL_VERSION` 1. A
`SceneRoot` owns one transform hierarchy; nodes created by `root.createNode({ id, visible })`
have stable, root-unique identifiers and can be attached with `add` or `reparent`. `remove` and
`clear` detach live nodes, while `destroy` permanently invalidates a whole subtree. `clone` gives
the new node a fresh identifier unless one is supplied; `copy` retains the destination identifier.
Both reproduce the local pose and optionally the descendants.
Recursive copying from an ancestor into its descendant is rejected with
`SCENE_COPY_OVERLAP` before either node changes; non-recursive copying remains allowed.

```javascript
import { createSceneRoot } from 'web-geometry';

const scene = createSceneRoot({ id: 'warehouse' });
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4);
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5);
scene.add(shelf);
shelf.add(crate).updateWorldMatrix();
```

Nodes from different roots cannot be combined, duplicate ids are rejected, and a cycle leaves the
hierarchy unchanged. Pose setters mark the data-oriented transform dirty; call
`updateWorldMatrix()` before reading `worldMatrix`. The matrix views are read-only by contract;
write through the setters so dirty tracking remains correct.

This first #78 lot is the hierarchy foundation only. `createExplorer` does not accept a
`SceneRoot` yet. Engine materials, texture references, frame hooks, and browser-contract migration
remain later #78 lots; lights continue to use the existing `SceneLight` version 2 contract.

## Browser explorer

### Simple browser startup

```html
<canvas id="viewer" style="width:100%;height:70vh;display:block"></canvas>
```

```typescript
import { createExplorer, type CameraPose, type Explorer, type ExplorerOptions } from 'web-geometry';

const options: ExplorerOptions = {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  interactive: true,
};
const explorer: Explorer = await createExplorer('viewer', options);
const home: CameraPose = explorer.pointsOfInterest()[0].pose;
```

`ExplorerTarget` is a canvas element or a **literal ID**, without `#`. Existing-element
usage is equivalent: `createExplorer(canvas, options)`. Use the element form for framework
refs, shadow roots or another document. Invalid targets are rejected before cache requests.
ID lookup without a document fails with `CANVAS_DOCUMENT_UNAVAILABLE`; missing IDs use
`CANVAS_NOT_FOUND`, and empty IDs/non-canvas targets use `INVALID_CANVAS`.

`interactive: true` opts into browser-owned OrbitControls, CSS sizing, browser DPR and
coalesced rendering. Creation resolves after submitting a first image with the prepared
root cover; visible detail and temporal antialiasing refine progressively. No `controls()`,
`awaitPages()` or animation loop is needed to explore. Calling `controls()` again returns
those same controls. After programmatic edits to the camera, scene or lights, call
`explorer.invalidate()`. In manual mode, that method renders immediately.

Set a CSS width **and** height independently of the canvas drawing-buffer attributes, as
above. Omitted `width`/`height` follow that CSS box; omitted `pixelRatio` follows the browser,
including later DPR changes. Explicit values override each automatic dimension independently.
An initially hidden/zero-size canvas needs explicit dimensions or must be shown before creation;
a canvas hidden later retains its last dimensions until visible. Invalid initial sizes/DPR fail.
The host retains ownership of CSS layout and the canvas element.

The simple path prepares only the direct WebGPU backend. Unavailable WebGPU rejects startup
with `WEBGPU_UNAVAILABLE`; there is no silent change of lighting or rendering capability.
An explicit `backends` list or `autonomousGeometry` retains its own capability contract.
`scope` still defaults to `slice`: keep `scope: 'full'` for a full cache. Memory pools retain
their bounded 512 MiB geometry / 512 MiB texture defaults; the earlier 16/128 MiB example
was an explicit budget choice and remains available through overrides.

Automatic rendering waits for asynchronous feedback without reading image pixels and retains
per-frame streaming/shadow budgets. Once settled, it schedules no frames. A burst that cannot
settle within 120 frames pauses and publishes `interactive-settle-limit`; `invalidate()` or a
new interaction resumes it. An asynchronous render failure stops automatic work and emits
`INTERACTIVE_RENDER_FAILED` through `onEvent`, with a diagnostic. Explicit capture/measurement
work should use a manual session to avoid competing rendering.

Dispose in the actual component/page teardown, **not immediately after startup**:

```javascript
function unmountViewer() {
  explorer.dispose();
}
```

Disposal removes owned controls, observers, queued frames and abort listeners without removing
the canvas. An aborted interactive session also disposes itself. `createExplorerJob(jobId,
canvasOrId, options)` accepts the same target and options; await its creation, then `job.promise`.
Its first argument is the job identifier, separate from the canvas ID.

### Manual rendering and explicit configuration

Without `interactive: true`, `createExplorer(canvas, { manifestUrl, scope, width, height, fov, pixelRatio, maxResidentPages, pageFetchWorkers, replicaCount, backends, pixelError, preload, comparisonLayout, comparisonPair, gpu, pointsOfInterest, ... })` owns neither the animation loop nor the canvas. Call `dispose()` when finished; hosted Orbit/Fly controls created through the explorer are disposed with it. The default camera is framed from the loaded bounding box (`near = radius / 10000`, no absolute floor). `pointsOfInterest()` returns that home pose; extra named poses come from the host `pointsOfInterest` option, not from the SDK. `pixelError` (default `0`) keeps the exact leaves; a positive threshold selects coarse QEM pages when the cache includes them. `preload: 'visible'` (default) streams detail for the current camera; WebGPU first loads a complete, camera-independent root cover before explorer creation resolves; `preload: 'all'` restores the previous eager load. `awaitPages()` must be called before the first official image when using the visible preload. Comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) render backends A and B to detached targets with the same camera; they are not an official performance verdict.

What the engine computes for itself — matrices, vectors, colours, its camera, the side of a material — it builds on `sdk-core` (`engineCamera.ts`, `materialSide.ts`), not on host-library objects — one exception left, the secondary capture view of `webgpuPagesSurfaceCapture.ts`, which enters the frame gate as a host camera until #78; the functions and their proofs are listed batch by batch in [`docs/API.md`](API.md). The host contract itself — the `THREE.Scene` handed to `createExplorer` and the `THREE.PerspectiveCamera` read once per frame — holds until the engine-owned scene model lands (#78).

The host camera declares its own clip-depth convention through `camera.coordinateSystem`, and both are supported: `[-1, 1]` (WebGL, the default of the camera the explorer builds) and `[0, 1]` (WebGPU). It is read once per frame into the engine camera and applies to the frustum planes, the view-projection the GPU consumes, the Hi-Z bounds and the CPU visibility raster alike; a camera reaching the engine through `restoreAfterCampaign` or a backend's own `render(camera)` carries its convention with it. The engine never rewrites `coordinateSystem`; a projection matrix inconsistent with the declared convention is the host's own error.

`autonomousGeometry: true` selects the prepared-page WebGL2 backend for wholly static opaque/masked assets. It reads `scene.gltf` and verified geometry pages without downloading the full source geometry buffer; a complete root cover is resident before rendering and useful detail streams afterward. The mode rejects caches without `autonomousScene`, BLEND/skinned/morph scenes and custom backend lists. Existing WebGPU and Three comparison paths still use `source.gltf` and its complete geometry buffer. Material images remain eager in this mode, and GPU-driven selection, indirect drawing and hybrid rasterization are not provided by this WebGL2 path.

`runCameraPath` is a campaign helper: exact A/A image gate, then timed blocks. It is not a general performance verdict. Hosts that already switch backends in the UI should replay the same pose list per backend; do not mix engines inside one timed block.

The `wireframe` diagnostic is a filled unique color per submitted triangle, not `MeshBasicMaterial.wireframe` / GL_LINES. Cluster, page and LOD diagnostics stay on the selected backend's actual cut.

`createGpuPageCache` is a bounded WebGPU buffer/queue adapter. `webgpuPagesBackend` (`webgpu-page-raster`) consumes the same pages and LOD settings. For opaque pages, selection computes the current camera's drawable resident cut on the GPU, retaining complete coarse coverage until every required child is resident. Draw compaction consumes that mask, counts and scatters in parallel groups, and the visibility shader consumes the resulting instance indices and slot offsets against the original page table. No CPU compaction or CPU opaque selection repeats that work. Asynchronous selection readback serves streaming requests and diagnostics; busy readbacks do not block current-camera selection. Selection/submission counters stay `null` until the matching GPU result is available. Transparency keeps its existing forward path; secondary-camera surface captures and unsupported GPU paths retain the CPU selection fallback. `capabilities.gpuDriven` denotes this opaque selection-to-draw path, not a completely GPU-autonomous engine. The visibility path issues at most six geometry `drawIndirect` commands (cull mode × Hi-Z pass); material, lighting, transparency and presentation add their own draw commands.

### Separated surfaces and lighting (pipeline version 1)

The opaque/masked path writes visibility, then reconstructs material properties into three `rgba16float` textures and one `r32uint` texture (28 logical bytes per pixel): base color/metalness, world normal/roughness, emission/AO, and surface flags. Depth uses `depth32float`. Lighting consumes these surfaces and reconstructs world position from depth and the inverse view-projection matrix. Transparency is shaded separately into the HDR target. ACES and sRGB conversion occur at final composition. This changes transparent compositing relative to the previous display-encoded blend; its visual validation remains required.

When a WebGPU canvas is present, final composition writes the same display value to the persistent `rgba8unorm` capture target and the canvas `bgra8unorm` attachment in one pass (`WG HDR composition + present`). This removes the separate fullscreen presentation draw and its logical RGBA8 read (4 bytes per pixel); it does not reduce frame-target allocation or change HDR blending, material precision, or surface captures. Texture-only and secondary-camera renders keep single-target composition. Explicit synchronous capture and main-view restoration may still copy the persistent target to the canvas outside normal rendering.

### Temporal antialiasing

The engine has no MSAA: the visibility buffer cannot be multisampled, and the reference does not multisample either — it recovers the edge temporally, and so does this engine. Each rendered image is projected with a sub-pixel jitter (a Halton (2,3) sequence of eight positions, applied as a clip-space translation to the render matrix only) and then resolved by a fullscreen pass, `WG temporal antialiasing`, between the transparent pass and composition: the lit-and-blended image is refiltered on its 3×3 neighbours with a one-pixel Blackman-Harris window centred on the unjittered pixel centre, the history is read where that unjittered centre was in the previous image, clamped to the YCoCg box of those neighbours, and blended in, each side weighted by its inverse luminance. Two `rgba16float` history targets ping-pong (16 bytes per pixel, counted in the frame allocation budget); composition reads the one just written.

Motion vectors are derived, not rasterised: the visibility buffer already names the page row of every pixel, and the row names its placement, so a pixel is reprojected through `previous · current⁻¹` of that placement — the identity for an object that has not moved, written only for the roots that moved since the last accumulated image and reset the image after — then through the previous unjittered view-projection. Both matrices are anchored on the eye of the image, as the occlusion partition anchors its projection, so a large-coordinate model keeps single-precision reprojection. The background, at depth zero, reprojects as a direction, which keeps silhouettes stable when the camera turns.

Two regimes. While something moves — camera, scene, resources, or work in flight — the current image weighs one eighth, the exponential accumulation of the reference. When an image is _quiet_ (nothing changed, nothing in flight: the conditions of a held frame), the history is dropped, the jitter restarts at phase zero and the k-th quiet image weighs 1/k: after a full cycle of sixteen the held image is the uniform average of sixteen images that depend on the final state only, so two executions render it bit-identically (`0 px` A/A measured on the Emerald cache, both views, with the option on). The exponential regime would have kept 12 % of what the image was while pages and textures were still landing, in an order that is never the same twice — 24 % of the ground-view pixels at up to 61 levels between two executions, measured before this rule. The declared cost of the rule: when everything stops, edges stiffen for an image or two before reconverging. A still scene is held only after those sixteen images.

The jitter never reaches the engine camera: the cluster selection, its frustum planes and its screen-error threshold read the unjittered camera, and the selection proofs are unchanged by construction. The occlusion partition, whose margins are ulp-tight, projects with the same jittered matrix that rasterised the pyramid it reads. A surface capture and a diagnostic view render unjittered and unaccumulated.

`temporalAntialiasing` (`true` by default, `false` to opt out) is the public option; with `false` the image is sampled at the pixel centre with no history — the "before" of a comparison, and what pixel-exact benches of the raster itself ask for. `render-capabilities` reports `temporalAntialiasing` and `motionVectors: 'derived'`. The pass is timed under its own label, but on apple metal-3 the timestamps of the last passes absorb the ones before them (the label reads ~7.5 ms, the whole lighting group), so its cost reads only as a difference of the whole-image envelope with the option off and on (`scripts/mesure/README.md`, `--antialiasing`). Measured on the Emerald cache at 2496×1404, sun and shadows, moving camera, two series each side: whole-image GPU envelope p50 on the ground view 10.57 → 11.09 ms (+0.5; the four samples per side span 10.22–11.01 and 10.95–11.29, so the difference is of the order of the spread), on the general view 9.08 → 9.48 ms (+0.4; spans 8.96–9.30 and 9.26–9.92, above the spread); p95 +1.5 and +1.4 ms — the price of one fullscreen pass reading ten texels and writing one at 3.5 Mpx, with the filter weights and the motion lookups taken out of the per-pixel path. The pass label itself reads 7.5 ms and means nothing. Image, still camera, converged and held: 27.1 % of the ground-view pixels differ from the unaccumulated image (852 926 of them by one level, 42 by more than 64), 12.2 % of the general view (191 775 by one level, 5 363 by more than 64) — edges and texture shimmer, the intended change, published with the captures under `.mesure/out/l16-fixe-*` on the measuring machine.

### No light without a declared source (opaque path)

Nothing lights an opaque surface except a light the host declared. The deferred resolve has no fixed ambient term, no constant sky and no authored scene lighting: a surface no declared light reaches is exactly zero, so a windowless corridor stays black at noon. Emission is a material property and is added as before.

Declare lights through `addLight`/`setLight`/`removeLight`. `SceneLight` (version 2) has three kinds. `point` and `spot` carry `position` and `range` in metres, `spot` also `direction` and a `coneAngle` half-angle; `directional` (sun, overcast sky) carries only `direction` — the propagation direction — and is refused if given a `position`, a `range` or a `coneAngle`, because it has none. All three carry linear `color`, a positive radiometric `intensity` and `castsShadow`. Bounds (`explorer.lightSettings`): 64 lights, 32 per 16x16 screen tile, a 4096-square depth atlas, and at most `shadowUpdatesPerFrame * 6` (24) shadow regions redrawn per frame.

#### A moving image shades a drawn subset of each pixel's lights

The per-tile list bounds what a pixel may walk; what it walks depends on the image. A **moving** image — one temporal antialiasing accumulates, at one eighth — weighs every light of its tile without its shadow (incidence, attenuation, the cosine and the light's luminance: the cheap part) and shades in full, shadow read included, only `samplesPerPixel` (4, `explorer.lightSettings`) of them. A light worth a sample's share of the pixel's weight is shaded exactly and leaves the pool — it would be drawn every image anyway, and drawing it a varying number of times is what would make a sunlit wall flicker; the remaining samples are drawn from the rest, evenly spaced along the cumulative weight from a per-pixel offset that advances by the golden ratio every image, each drawn light divided by its probability. The estimate is unbiased, so the history averages it toward the sum over every light; a list of four lights or fewer is summed in full. A **still** image — the sixteen quiet ones the hold waits for, and any image that does not accumulate: a capture, a diagnostic view, `temporalAntialiasing: false` — shades every light of the tile, character for character the loop from before, so the held image is the exact sum and two runs give it to the bit (`0 px` A/A, Emerald ground view, thirty-two shadowed lights of three-cell range). The blend pass keeps shading its lights in full: a forward surface has no history to average.

Measured (Emerald cache, 2496×1404, ground view, `--lampes 32 --portee 3`: thirty-two shadowed point lights whose ranges reach one pixel, moving camera, the before side built from the same commit): whole-image GPU envelope p50 39.9 → 17.9 ms, the after side's two runs at 17.9 and 19.3; without any light the same image reads 5.0 ms, without shadows and with every light shaded 10.3. `metrics().lightsSampled` is `true` on a frame that drew a subset and `false` on one that shaded every light. The declared cost: a moving image carries a faint grain on lit surfaces where lights of different colours overlap — on a plane under eight lamps of two colours built so that two draws differ as much as they can, the interior settles within 2.4 levels of the still image on average and 27 at worst after twenty-four moving frames (`test/browser/eclairage-echantillonne.browser.mjs`); the still image differs from the one before this rule by 52 pixels of one level over 3.5 million, the rounding of a recompiled shader. What remains, where the reference has one: a spatial denoise before the history.

#### Shadow maps are invalidated page by page, under a millisecond budget

The atlas is cut into `shadowPage` (128) texel pages. A light that moves invalidates its whole map; an object that moves — a transform, a page entering or leaving residence — invalidates only the pages of each face its projected box covers, and only those are redrawn. The frame is the whole face's, only the scissor is the region's, so a page redrawn this way carries **exactly the depth a full redraw would write**, bit for bit. `explorer.shadowAtlasDigest()` returns the raw depth hash so a host can check that for itself; `createExplorer({ shadowPageInvalidation: false })` turns the rule off and redraws whole faces, which is how the two are compared.

What a frame redraws is bounded by `shadowBudgetMs` (`createExplorer`, 1.0 ms by default), measured on the shadow pass's own GPU timestamps and smoothed across frames. Pages the budget refuses wait for the next frame, ordered by the light's screen coverage and by how long they have already waited; they are never dropped, and `metrics().shadowPagesPending` / `shadowWaitMs` publish the queue and the oldest page's delay. Without GPU timestamps there is no budget at all, only the region ceiling. The cost of one region — rejection, depth reset, indirect draw — is folded into an averaged per-page cost: a named approximation, published in the `direct-lighting` diagnostic.

A directional light's shadows are `sunCascades` (4) cascades following the camera, stored in the same atlas slice mechanism as a point light's six faces, under the same rules: the map is reused while neither the light nor the world inside its extent has moved, and while the cascade still describes the same world window — a camera that moves less than the cascade's own texel grid changes nothing, and its map is kept. When that window does move, the cascade is redrawn **whole**: the atlas does not address its pages as a ring, so a window that slides leaves nothing to recover; clusters outside a cascade are rejected before drawing; alpha-masked materials keep their real cutout; no resolution or detail reduction. Cascades cover `sunShadowFarFraction` (0.2) of the camera's far plane. Their splits are a geometric series of ratio `sunCascadeRatioMax` (4), so texel density changes by exactly that ratio at every seam; the near end of the series is `shadow distance / ratio^cascades`, not the camera's near plane, while the first cascade still covers from that near plane.

Beyond the last cascade the sun's shadow is one ray per pixel against the resident proxy (`proxy.bin`), traced by the same bounded traversal the bounce uses. It is deterministic — the ray direction is the sun's — so nothing is accumulated across frames. The ray starts `sunFarShadowStartCells` (1) proxy cells along its own direction, so a blocker nearer than one proxy cell carries no far shadow; the proxy's certified geometric error moves the shadow edge; a ray that exhausts the published traversal bound reports no blocker, which lights. All of these are published in the `sun-far-shadow` diagnostic, together with the pixels tested and darkened on one sampled image out of fifteen. Without a resident proxy in the cache, the diagnostic says the far shadow is unavailable and the surface stays lit with no cast shadow, as before: the last cascade is never stretched to cover the far plane, which would divide the texel density of every near shadow by five on each axis. The blend pass that lights transparent surfaces binds the same proxy and traces the same ray through the same WGSL, so a distant transparent surface darkens exactly like the opaque one beside it; it binds the proxy read-only, so the two sampled counters come from the deferred pass alone, and the blend fragment stage keeps early depth rejection, which a writable storage binding would cost it. The resident proxy lives in a single storage buffer (a twelve-word header, then the three columns) so that both passes stay within the eight storage buffers guaranteed per shader stage.

`setLightingView(view)` selects what the opaque path outputs. `'lit'` is real lighting and nothing else. `'unlit'` is the raw-albedo diagnostic view: base colour as authored, with no light, no ambient and no emission, for geometry benchmarks that compare images pixel by pixel. It is a diagnostic view, not a light. `'auto'` is the default: the unlit view while no light is declared, real lighting as soon as one is. Declaring a light therefore changes the image; declaring none never leaves a black frame.

### What a backend actually does with the lights

`explorer.lightingCapabilities()` reports what the **active** backend applies, not what the contract publishes: `{ sceneLights, lightingView, shadows, transforms, reason? }`. A call the store accepts is not proof of lighting — the store belongs to the session and every backend shares it, so a backend that never reads it leaves the image exactly as it was. `sceneLights` and `lightingView` are read from the backend itself (it reads the store, or it does not); `transforms` is read from `setTransform`; `shadows` is declared by the backend, because no signature says it. `reason` names in one sentence what is not applied. Selecting another backend changes the answer.

The first `addLight`, `setLight` or `setLightingView` made against a backend without `sceneLights` emits one `scene-lights-unsupported` diagnostic per session — the store still accepts the light, because the host may select a backend that applies it later.

`webgpu-page-raster` applies everything, shadow atlas included. `exact-cluster-pages` (Three.js WebGL2) applies the contract lights and the lighting view, without cast shadows: Three would need one shadow map per light — six faces for a point light — far outside any frame budget, and `'bounce'` there renders the lit view. `reference` and `three-lod` apply none.

### The contract lights on the Three.js path

`exact-cluster-pages` translates the same `SceneLight` store into Three lights, refreshed on every store revision. A `point` becomes a `PointLight` with `decay = 2` and `distance = range`, a `spot` a `SpotLight` with the same plus `angle = coneAngle` and the `penumbra` whose inner cosine equals `cos(coneAngle) + spotEdgeSoftness`, a `directional` a `DirectionalLight` placed at `-direction` with its target at the origin. The radiometric convention is carried unchanged, not approximated: `intensity` stays W/sr for a point and a spot, and Three with `decay = 2` and `distance = range` evaluates `pow(clamp(1 - (d/range)^4, 0, 1), 2) / d^2` — term for term the attenuation of the deferred lighting shader (`directLightWgsl.ts`); a directional light carries irradiance on both paths. Colours are written in the linear working space, so no sRGB transfer is applied on the way in. What is **not** equal is the surface model: Three evaluates its own Cook-Torrance, the WebGPU path its own. Same incident irradiance, different image.

`'unlit'` on that path is obtained by lighting, not by substituting materials: a standard material returns `irradiance * albedo / pi` in diffuse, so one white ambient light of irradiance pi returns exactly the albedo — provided nothing else scales that response. For the length of each frame the view zeroes the material factors that would, whatever the surface: `metalness`, because a diffuse response of `albedo * (1 - metalness)` sends a pure metal to black; `aoMapIntensity` and `lightMapIntensity`, two maps that scale or add irradiance; `transmission`, because what shows through would stand in for the base colour. Every one of them is a uniform, so no program is recompiled, and every one is given back its value as soon as the frame is drawn: returning to `'lit'` restores the previous state property by property. The zeroing runs on every frame rather than once at the switch, because pages enter and leave residency between frames. Named deviation from the WebGPU `'unlit'`: a material's own emission is still added, because the materials themselves are never substituted.

The contract only takes over once the host has used it — one light declared, or one view requested. Until then the source light graph lights alone and the image is the one from before, pixel for pixel. From then on the source graph's lights are switched off: two superimposed sets of lights would be nobody's lighting.

### A luminaire does not block its own light

A real light always sits inside something — a lantern glass, a reflector, a shade — and that envelope is geometry like any other: it enters its own light's shadow map and puts the light out. `SceneLight.emitterRadius` (metres, strictly positive and strictly below `range`, point and spot only, refused on a directional which has no position) declares the radius of that envelope. The excluded region is that sphere and nothing beyond it: **that light's** shadow depth pass writes no depth for a surface whose distance to the light's centre is below the radius, and the projection of its faces does not move. Raising a face's near plane instead would exclude a cube — up to sqrt(3) times the radius along the diagonals — and reject occluders the envelope never contained. The cost is one squared distance per fragment of the shadow pass, on a stage that already exists for alpha-masked cutouts; a light that declares no radius carries a radius of zero and nothing is rejected. The rejection is per fragment, so a triangle that starts inside the radius and extends beyond it still occludes beyond it, which is what a wall crossing the envelope should do. A receiver inside the envelope is lit, because the envelope around it wrote nothing into the map.

It is a property of the light, never a name, a scene or a material class: the engine only knows surfaces. Without the field nothing changes and the current behaviour — an envelope 0.15 m from a 30 m-range source falls inside the 0.15 m near plane and occludes — stands as documented. `lights.json` carries the field from two places, in that order. A source that declares a radius on the lamp itself puts it in the light's `extras.emitterRadius`, in metres — the same `extras` channel `castsShadow` already travels on. USD and Blender fill it from their own data: the `inputs:radius` of a `UsdLux` sphere or disk light and the diagonal of a rect light's `inputs:width` × `inputs:height`, the `radius` — `shadow_soft_size` in the files that still name it so — of a Blender `Lamp` and the emitting surface of an area lamp, each carried to world metres by the layer unit and the object's scale. glTF `KHR_lights_punctual` has no radius field, and `ufbx_light`, which every FBX lamp comes through, carries colour, intensity, direction, decay, area shape and cone angles but no size; Maya, Alembic and Unity lamps are counted unsupported and never reach the contract at all. For those the channel is only fed by a glTF authored with it. Otherwise the compiler measures the luminaire: when the lamp's parent node, or one of its direct siblings, carries a mesh whose material emits — a non-zero emissive factor or an emissive texture, a material property and nothing else — the radius is the greatest distance from the lamp's centre to one of that body's vertices, so the sphere contains the envelope and no more. The body is walked vertex by vertex, never by its bounding box, for the same reason the near plane was refused: a sphere's box overruns by sqrt(3). Several emissive bodies bound to one lamp: the tightest sphere wins. The value is written only when it is finite, strictly positive and strictly below `range`, never on a directional; a radius that fails the contract is counted `light-emitter-radius-invalid` and omitted, and a measured one is counted `light-emitter-radius-derived` so the report says where it came from.

### Lights imported from the source file

An imported scene arrives with its own lights. The native compiler reads the lights the source file
declares and writes them beside the manifest as `lights.json`, a cache product of its own: the
manifest format number does not move, and a reader that ignores the file loads the cache exactly as
before. glTF lights come from `KHR_lights_punctual` (`point`, `spot`, `directional`, with colour,
intensity, optional range and cone angles); FBX lights come through ufbx, USD lights from the
`UsdLux` sphere, disk, rect and distant schemas, Blender lights from the `Lamp` blocks of the SDNA,
each driver rewriting them under the same extension, so one reader serves every format. OBJ declares
no light, and the file is empty.
Positions and directions are world space, after instancing: a light instanced by three nodes becomes
three entries, each with the world transform of its node.

**Unit conversion, chosen and published.** glTF is photometric — candela (lm/sr) for `point` and
`spot`, lux (lm/m²) for `directional` — while the engine is radiometric (P1), in W/sr and W/m². The
compiler divides by **683 lm/W**, `K_cd`, the SI constant that defines the candela; no spectrum is
assumed, and no hidden gain is applied. A source whose image is then too dark or too bright is
corrected by `setEnvironment({ exposure })`, never by the import. FBX carries no photometric unit at
all — its `Intensity` is a percentage — so two published settings convert it: one unit is
**1000 lm / 4π ≈ 79.6 cd** for a point or spot (a domestic bulb radiating in every direction), and
**10 000 lux** for a directional (an overcast day). A `point` or `spot` with no `range` gets one
derived from its intensity, `sqrt(I / 0.01 W·m⁻²)`, capped at 10 000 m: the contract needs a finite
range, glTF allows an infinite one. `innerConeAngle` has no equivalent in the contract; the engine
softens a spot edge with its own published `spotEdgeSoftness`. A light whose type, transform or
intensity does not hold the contract is counted in the file's `rejected` map and left out — a
compile never dies on a light, it says so.

`prepare()` and `createExplorer()` declare these lights on open, before the first backend prepares,
so the `auto` view knows from its first frame that it has a source. A light casts a shadow when the
file says so (FBX carries the flag; glTF has none, so imported glTF lights cast one) — the per-frame
cap of `shadowUpdatesPerFrame` (4) already bounds what that costs. If a file declares more than the
64 lights the contract accepts, the ones that carry furthest are kept — directionals first, then by
peak channel intensity — and the rest are counted in the `imported-lights` diagnostic, never
silently lost. `explorer.importedLights()` returns them, in cache order, for the host to change with
`setLight` or drop with `removeLight`; `importedLights: false` in the explorer options opens the
scene without any of them. A scene with no imported light behaves exactly as before: no light, `auto`
resolves to `unlit`. The measurement harness carries the same switch as `--lampes-fichier on|off`.

### Light that bounces (opaque path)

An opaque surface also receives the light that bounced off other surfaces before reaching it. The
bounce is dynamic: it carries no baked lighting, it depends on no camera, and it follows a light
that moves or a door that closes.

It rests on a **resident proxy** the native compiler writes beside the cache, as `proxy.bin`. The
proxy is the coarse cut of the cluster DAG whose certified geometric error stays under
`proxyErrorMetres` (5 cm), raised per primitive until the whole scene fits `proxyTriangleBudget`
(300 000 triangles, every instance placed), plus a BVH over it and one linear diffuse albedo per
triangle. It carries geometry and materials, never light. The threshold it actually reached is
published in the manifest as `proxy.errorMetres`; on a scene whose DAG does not simplify that far,
the proxy is the DAG's root level and says so. A cache compiled before this change carries no `proxy`
field and stays readable: the bounce is then unavailable and declares it.

At run time two compute passes carry it (`explorer.bounceSettings` publishes every bound below).

**Cascades of probes.** Irradiance lives in up to `cascadeLevels` (4) nested cubes of
`cascadeSize` (16) probes per axis. Each level's spacing doubles, the last one is fixed in the world
and covers the whole proxy extent, and every finer level follows the camera. The finest spacing is
at most `cascadeSpacingMetres` (2 m), narrowed further so that the thinnest dimension of the scene
keeps at least `cascadeLayersAcross` (3) layers of probes, and widened if the coarsest level would
not otherwise reach across the scene. A small scene therefore ends up with a single fixed level; a
city gets four. Probes live on a global lattice at cell centres, so a probe never moves: a level
that follows the camera only exchanges the cells it holds, and a cell is stored by its remainder
modulo the cube side, so sliding by one cell only invalidates the slab that enters. Every probe
carries the cell it holds, and a probe that does not hold the cell you ask for contributes nothing.

**Where the probes go.** An occupancy map, built once from the proxy, says which cells touch
geometry — plus one ring around them, so the eight corners of a useful cell are always held. The
scheduler skips the rest: empty sky and the solid core of a block cost no ray. A probe that turns
out to be buried in a surface, or lost in open sky, also puts itself to sleep until a light changes
or it changes cell.

**A budget in milliseconds, not in rays.** `createExplorer({ bounceBudgetMs })` sets the GPU time
the `bounce` stage should take per frame (0.8 ms by default). The engine reads the stage's own
timestamp from the per-pass GPU profile and corrects, with smoothing, the fraction of its published
ceilings — `raysPerFrame` (49 152 probe rays) and `surfaceTexelsPerFrame` (16 384 cache cells) — that
the next frame will encode. The frame rate never gives; convergence stretches instead. The timestamp
comes back several frames late and only every third or twelfth frame, and a device that cannot time
its passes keeps the fraction at one: both are declared in the `bounce-lighting` diagnostic, which
publishes the target, the fraction held and the last duration seen.

**What a probe does.** A probe traces `raysPerProbe` (64) rays against the proxy, at most
`traversalSteps` (128) BVH nodes visited per ray, and reads at the cell it hits the outgoing radiance
the surface cache already holds — direct, shadows included, plus the indirect the cascades converged
on the previous round. One ray, one traversal, one read. It accumulates the result in **order-2
spherical harmonics** (nine coefficients) with an adaptive hysteresis, and the cascades are read from
a snapshot frozen before the pass, so the steady image does not depend on the order the device
scheduled its threads. The surface cache holds one radiance per proxy triangle and face and is swept
on the same budget; each full round adds one bounce order to the series. Once the scene has been
swept `settledSweeps` (16) times with no declared light changing and no cascade sliding, neither pass
is encoded at all: a still scene pays nothing, and the `bounce` stage then reads "not measured",
never zero.

The deferred resolve adds the interpolated irradiance of the eight surrounding probes of the finest
level that reaches the point, multiplied by the pixel's diffuse albedo over pi. Three weights guard
the interpolation: the trilinear weight of the cell, the surface's own facing — a probe behind it
knows nothing about it — and each probe's six measured mean distances, which close the leaks through
a wall. Where no level reaches the point the term is exactly zero: a leak would be light without a
source.

Measured on a control room (8 x 3 x 8 m, one red wall, one shadowing point light) against the
compiler's path tracer at eight bounces: mean error **18.6 %** of the oracle, median 14.4 %, p95
49.9 %, engine mean 1.03x the oracle. The same cascades with an order-1 basis give 25.1 %: order 2
is what buys the accuracy, and the remaining error is the interpolation, not the basis. The published
error target is 10 %, so it is not met. Convergence after a light jumps: **22 frames, 367 ms** at
60 Hz, of which 16 frames are the mandated closure of the bounce series.

The bounce stays **off by default**: measured on Emerald with eight point lights, the `bounce`
stage costs **1.12 / 1.18 / 1.26 ms** (p50, the three bench views) against 2.22 / 2.22 / 2.26 ms
before this change, which is still above the one-millisecond bar that would have made it the default.
Most of that is fixed cost, not work: the millisecond budget drives the fraction down to its floor
(2 %, 15 probes and 328 cache cells per frame) and the stage still reads 1.1 ms.
`createExplorer({ bounce: true })` turns it on for the session. Left off, the deferred resolve
compiles the direct-only program, exactly the shader of the previous change, and the bounce declares
itself unavailable rather than appearing silently. Emission, transparency and specular are not
bounced; the proxy carries diffuse albedo only.

`setLightingView('bounce')` is the measurement view: the indirect irradiance alone, multiplied by
exposure, in linear values with no ACES and no sRGB. It is not an image to look at — it is the
quantity `scripts/mesure/oracle.mjs` compares against the compiler's own path tracer
(`web-geometry-oracle`, built by `pnpm run build:native`), which traces the source triangles with the
same light and diffuse-material model. The oracle truncates the bounce series at its `bounces`
count while the engine carries the whole series, so a comparison only means something at a matching
order.

`setEnvironment({ exposure })` sets camera exposure, applied to linear radiance immediately before ACES. It is not a light: it cannot brighten a surface no declared light reaches, and a scene without lights stays black whatever its value.

The transparent path still uses the authored Three.js light graph and its fixed ambient, so `sceneLighting?: THREE.Object3D` still supplies that graph (falling back to the loaded glTF graph, then to a hemisphere/sun rig), still adapts directional, point, spot, hemisphere and ambient lights to a bounded buffer (maximum 256 visible lights; excess and unsupported types fail explicitly), and `explorer.refreshSceneLighting()` still applies after adding or removing lights there. Extending the no-implicit-light rule to transparents is later work. Environment-map lighting, area lights, probes and global illumination are not implemented.

For `backends: [webgpuPagesBackend]`, `createExplorer` configures the host canvas with its own `GPUCanvasContext` and the engine writes the final image into it; no WebGL renderer is created. A mixed-backend explorer composes on a WebGL2 surface instead: the engine presents into a canvas of its own, publishes it as `presentedSurface` on the backend, and the host copies it there with the engine's own full-screen program (`createBackendPresenter`) — no texture, material or mesh of a rendering library takes part, and the bytes go through unchanged. This cross-API composition has a separate cost and must not be conflated with direct presentation. Neither normal path calls `copyTextureToBuffer` for the image. No physical zero-copy or performance gain is claimed without browser measurements. Geometry-selection feedback is separate from image readback and still exists.

For every WebGL2-hosted session, `createWebglSurface` creates and owns the context before the scene
renderer exists. It fixes the context attributes, computes drawing-buffer dimensions from logical
size and DPR, avoids resetting the buffer on an unchanged size, observes context loss/restoration,
and releases the context once. The current scene renderer is a temporary adapter over that context;
the surface foundation alone does not replace cluster drawing, composition, held frames, or capture.
Pure direct-WebGPU sessions never bind the host canvas to a WebGL context.

`exact-cluster-pages` uses an engine-owned WebGL2 program for paged opaque and alpha-masked
`MeshStandardMaterial` and `MeshBasicMaterial` batches when their inputs fit its declared glTF
contract. The program reads base colour, metallic-roughness, normal, occlusion and emissive maps,
including each map's UV set, transform, sampler and colour space, according to the
[Khronos glTF 2.0 material specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials).
Direct light adds Lambert diffuse to a Cook-Torrance GGX distribution, correlated Smith visibility
and Schlick Fresnel, the published model described in Brian Karis's
[Real Shading course notes](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf).
This is not glTF Appendix B's Fresnel mixture: its diffuse term does not multiply by `(1 - F)`.
The host then returns the context to the temporary scene adapter for non-cluster objects and composition.
`autonomousClusterDrawsTotal` is the session counter that proves these draws came from the owned
program. It is cumulative and therefore is not a per-frame draw-call measurement.

This stage deliberately retains the complete scene-renderer path when a scene uses clustered blend,
material arrays, transmission, physical extensions, environment/light/bump/displacement/alpha maps,
flat shading, custom shader hooks, non-image textures, unsupported UV channels or lights, or later
mutates a material into one of those states. The `cluster-webgl-fallback` diagnostic names the reason
before activation. A runtime mutation raises a named backend error; an ordinary beauty frame then
switches to the complete baseline, while measured and diagnostic frames fail explicitly.
Clustered blend and diagnostics are tracked by #119, transmission composition by #120. No
bit-identical Cook-Torrance result is claimed: the owned implementation follows the published
Lambert and GGX/Smith/Schlick model rather than another renderer's shader. Image comparisons publish
the resulting delta. Geometric roughness filtering uses the less-conservative variance from equation
5 of Tokuyoshi and Kaplanyan's
[Improved Geometric Specular Antialiasing](https://yusuketokuyoshi.com/papers/2019/ImprovedGeometricSpecularAA.pdf),
with the paper's 0.5 pixel radius and 0.18 variance cap. Against the same curved witness, this reduced
the maximum channel delta from 37/25/13 to 33/19/10 at 64/128/256 px without changing the planar
analytic fixture. Across five subpixel translations at 128 px, the centre highlight spans six channel
levels on both implementations (owned 51 to 45; witness 53 to 47), and silhouette coverage matches on
every frame. This proves the tested spatial and motion stability; it does not claim temporal quality
for every material or camera path.

The independent full-surface fixture uses the same 32×16 tessellated sphere and a test-only glTF
Fresnel-mix BRDF (§B.3.5), rendered at 8× and box-resolved to 128 px after decoding the quantised
sRGB samples to linear light and re-encoding the average. Its five-pose 4× to 8× convergence is RMS
0.135 and maximum 4 channel levels. Across the same five subpixel poses, owned spatial error is RMS
1.338/max 24 against the common oracle, versus 2.107/max 40 for the witness; temporal-difference
error is 1.148/max 36 versus 1.461/max 47. The oracle is independent of both production programs.
OPAQUE ignores source alpha and surviving MASK fragments write alpha one, as required by glTF.

On the 1 px Emerald street path at 1280×720 and DPR 1, with one 40-intensity point light, shadows
off, 20 warm-up frames and 60 moving-camera frames, earlier synchronous submission-burst readings
were 5.6/5.6/5.6 ms against 5.6/5.5/5.7 ms for the temporary adapter.
They led to the texture and bounded-light reductions described above, but are not a frame-performance
verdict because that old loop did not yield to the browser. At candidate `c2315306` versus witness
`48c90c4e` (the same runtime as the integrated base), three diagnostic-free moving runs measured rAF p50/p95 intervals of
16.7/33.3, 16.7/16.8 and 16.7/16.8 ms, versus 16.7/83.4, 16.7/83.3 and 16.7/83.3 ms. The headless
display cap was 60 Hz. Synchronous CPU submission p50 was 4.7/5.0/4.9 ms versus 5.0/5.2/4.9 ms;
it is reported separately and never added to the frame interval. Every repeat kept the same cut and
had zero A/A pixels. This establishes better whole-frame cadence for this path, not a general speed
claim; GPU timestamps remained unavailable.

**Memory budgets are fixed reservoirs, as in the reference, never read from the machine.** Free memory changes every second — another application, another tab —, so a budget measured at start-up would be wrong five minutes later. The WebGPU engine keeps two byte-sized pools, both host-set and both defaulting to 512 MiB like `r.Nanite.Streaming.StreamingPoolSize`: `geometryPoolBytes` (cluster page slots: `floor(bytes / pageBytes)` slots, the root cover always resident) and `texturePoolBytes` (virtual-texture tiles, split between the colour and data atlases in 63.5 MiB layers, every texture's tail always resident). What a view asks beyond a pool is shown coarser — the cut raises its screen error until the cover fits (`coverageBudgetLimited`), a tile shows its coarser level — and nothing is refused, nothing stops. A value that cannot be held as given is brought to what can be and the reason is published: `geometryPoolClamp` / `texturePoolClamp` read `root-cover` (raised to the root cover), `scene` (the scene is smaller), `page-cap` (`maxResidentPages`, the page-count cap tests and benches use), `minimum` (one layer per atlas), `device-limit`, `ceiling`, or `null`. `geometryPoolSaturated` counts the pages the image holds — root cover, cut and drawn ancestors — beyond the pool's slots; zero is normal, a lasting count says the pool is too small for that view, and the cut coarsens until it fits. The only true refusal is `GEOMETRY_POOL_DEVICE_LIMIT`: the device cannot hold even the root cover.

Frame targets are **not** budgeted: colour, depth, visibility, HDR, material surfaces, Hi-Z, the temporal history and a surface capture follow the resolution, as the reference's do, and `gpuFrameTargetBytes` says what they cost. Only a size the device cannot make is refused (`SURFACE_DEVICE_LIMIT`). The previous 288 MiB frame cap refused 4K on machines that held it; it is gone.

**Budgets change during the session** — the call an application's memory slider makes — through `explorer.setMemoryBudgets({ geometryPoolBytes?, texturePoolBytes? })`, which resolves to what the engine holds afterwards (`geometryPool`, `texturePool` with their `clamp`, `evictedPages`, `evictedTiles`, `durationMs`). Unlike the reference, which flushes its pools when their size changes, the engine keeps what fits: surviving pages and tiles are copied on the GPU into the new pool, only what no longer fits is evicted, and the image stays complete throughout. The geometry pool can grow up to `geometryPoolCeilingBytes` (the slider's maximum; the initial budget when absent), because the per-drawable-row tables are sized once, at that ceiling; a request above it is clamped `ceiling`. Backends without pools throw `UNSUPPORTED_MEMORY_BUDGETS`.

WebGPU pins the root cover for the lifetime of the backend, including its CPU index bytes. A region keeps a complete resident representation until all replacement pages have been uploaded; queue writes precede subsequent draws on the same GPU queue. If old and new detail cannot coexist, the renderer returns to the root cover before reclaiming old slots. Shared URLs occupy one slot across instances. The pool always holds the pinned cover: a budget under it is raised to it (`geometryPoolClamp: 'root-cover'`), never refused. If requested detail plus the cover cannot fit, rendering retains a complete available cut and reports `coverageBudgetLimited: true`; it may therefore be coarser than the requested pixel error. This does not bound total scene memory or certify the compiler's simplification quality. Standalone backends must supply validated `readPage(url)` or preload the root bytes; otherwise they submit no image until the complete initial cover is available.

`FrameMetrics.coverageReady` reports initial GPU coverage, `coverageBudgetLimited` reports blocked detail admission, and `streamingError` preserves the latest page-loading failure (`null` when absent). Other backends report coverage as `null`.

Two counters say different things about pages, and a host that confuses them reads thrashing where there is none:

| Field            | Meaning                                                                                                                                                                                                                                   | Reported by                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `pagesDetached`  | Clusters that left the drawn cut since the backend was created. A moving camera detaches clusters on every frame; this is a measure of cut churn, not of memory pressure.                                                                 | `exact-cluster-pages` (WebGL). `null` elsewhere. |
| `cacheEvictions` | Pages actually evicted from the cache that feeds the drawn geometry — the backend's own GPU page cache when it owns one (`webgpu-page-raster`, `autonomous-pages`), the host page streamer otherwise. This is the memory-pressure signal. | every backend                                    |

A bounded cache evicting nothing while `pagesDetached` climbs is the normal state of an exploration. Background loads attempt a failed URL at most three times per explorer, then stop retrying it; reload the explorer to retry after repairing the source. `awaitPages()` rejects a failed requested URL. Initial cover read failures reject preparation. Diagnostics include `coverage-bootstrap-start`, `coverage-bootstrap-ready`/`coverage-bootstrap-failed`, `coverage-budget` (delivered during `flush()`), `coverage-upload-failed`, and `coverage-streaming-failed`. The `render-progress.coverage` object uses version 1. CPU cache eviction cannot remove an active GPU fallback; deferred evictions apply when its detail pages are released.

`await explorer.captureSurfaceView(pose, {width, height, signal})` returns an owned `SurfaceCapture` version 1 with the four material textures, depth, inverse view-projection, camera position and selected triangle count. The host must serialize this operation with ordinary rendering and call `capture.dispose()` before requesting another capture. It reuses the engine's geometry and page cache, selects for the requested camera, rejects missing pages/insufficient budgets, and restores the main viewport and camera afterward. Translucency is excluded from these surface textures. The current implementation executes views sequentially and reallocates frame targets when dimensions change; it is not a batched multi-view renderer. It provides a concrete surface interface for future GI work, not Lumen cards, distance fields, ray tracing, velocity or a populated Surface Cache.

If visibility/material initialization fails in a direct WebGPU session, the engine fails visibly. It also rejects transmission rather than silently leaving it out. Mixed sessions retain the earlier reported fallback path; inspect `unsupported` and diagnostics and reject fallbacks for quality/performance comparisons. Per-texture transforms/UV channels/sampler modes, skinning, morph targets and the full material contract remain unsupported. No compiler/cache-format migration or new LOD algorithm is part of this integration.

### WebGPU visual checks and diagnostics

`diagnosticDetail: "trace" | "summary"` controls event detail. An `onDiagnostic` observer defaults to trace; omit the observer to disable collection. The repository's model bench enables debug mode by default and records that choice in its report. Debug frames are marked `measurementKind: "diagnostic"`, including beauty renders. Turn debug off before collecting performance evidence.

Trace covers host frames and camera poses, selection decisions and fallback reasons, complete coverage/admission, residency queues and protections, CPU cache reads and hash verification, retries/errors, GPU slot generations/uploads, actual cache eviction, draw-list detachments, target allocations, rendering steps, and capture/disposal boundaries. Page catalogues and numeric page references avoid repeating long URLs in every snapshot. Missing physical measurements remain `null`; a successful image or coverage flag does not certify compiler correctness or visual parity.

Explorer events carry a session ID, a monotonic sequence and their creation timestamp. The host queues observer delivery outside the measured call, with a 65,536-event pending limit and an explicit `diagnostic-loss` record on overflow. `createDiagnosticChannel` exposes `flush()`, `flushSync()`, `pending()` and `dropped()` for standalone hosts. Do not discard a loss record. A host that streams the full report to a compressed archive extracts its complete JSONL journal plus capture gallery, and does not mark the pending archive successful until writing finishes; such a host archives sequence/session metadata alongside the event context, file export and observer work can still affect scheduling and the next frame.

Every SDK build records SHA-256 hashes of distributed JavaScript modules in its configuration event. A direct source import has `hash: null`; it must not claim a compiled build identity. These hashes identify code, while the cache's compiler/format metadata identifies prepared assets.

CPU scheduling, asynchronous elapsed time, command encoding and GPU pass execution have distinct scopes. GPU trace status records unavailable instrumentation, busy/skipped frames, invalid timestamps and discarded output. A pass-duration sum excludes separate selection dispatches, transfers and display latency. No total VRAM measurement is inferred from allocated buffers.

`onDiagnostic(event)` receives structured phases with `pipelineVersion: 1`: `gpu-presentation` (direct, mixed composition or texture-only), `frame-allocation` (dimensions/reserved bytes/budget), `material-textures`, `material-textures-ready`, `material-surfaces-ready`, `scene-lighting`, `render-capabilities`, and the first readback/presentation samples. `render-progress` reports selected/resident pages, triangles and pending pages during explicit `flush()` calls. In `diagnosticDetail: "summary"`, progress and CPU samples retain the two-second cadence. In `"trace"`, each render also produces detailed records; observers are deferred outside the synchronous measured render call. Surface capture emits start, ready/failure, restoration and release phases. Failures include their phase and error and are deduplicated. Device loss and uncaptured GPU errors are reported. Observer exceptions cannot interrupt this backend. These diagnostic durations are not frame-performance measurements.

The browser requests `timestamp-query` when the adapter advertises it. `gpu-timing-status` reports availability. In summary mode, at most one submission per 60 render calls is instrumented; trace mode requests instrumentation on every render call, with one outstanding readback, at most 64 pass pairs, two fixed 1 KiB buffers and 128 queries allocated lazily. Busy samples are skipped; retained results are bounded to eight. Readback maps asynchronously, and `flush()` publishes `gpu-timing` events outside the beauty loop. Each result carries its render frame, submission number, camera, viewport and per-pass milliseconds, including Hi-Z, draw compaction, visibility, materials, lighting, transparents, HDR composition and direct presentation when those passes execute. `sumPassMs` sums timed pass intervals; it is not end-to-end GPU frame latency and excludes separate GPU selection dispatches, transfers and presentation latency. The host's per-frame `gpuMs` remains null rather than assigning a delayed sample to a different frame. Missing/reversed timestamps are null with their raw pair and reason; any invalid or truncated pass makes the sum null. Actual map/allocation failures disable profiling, emit `gpu-timing-unavailable` and leave rendering available. Timestamp resolution depends on the browser/device.

`cpu-timing` reports backend render duration, light updates, selection, residency scheduling/target management, and command encoding/submission. `transparentEncodeMs` is a subset of `encodeSubmitMs`, not an extra duration to add. CPU logs carry their own frame/submission identifiers. Summary mode publishes at most once every two seconds during `flush()`; trace mode preserves each frame. Async residency waiting and GPU execution are not counted as CPU work. Profiling introduces overhead, so its samples are diagnostic evidence rather than a controlled performance verdict.

WebGPU filters transparent meshes against the current camera frustum before uploading their per-frame uniforms or issuing their draws. Bounds cover the complete transformed geometry, preserving objects that intersect the frustum. Source transforms are baked during preparation, as with the existing geometry path. `frustumCulled: false` and unavailable/nonfinite bounds conservatively retain a mesh. This does not add transparent LOD, occlusion culling or transparency sorting. `FrameMetrics` exposes `transparentMeshes` (retained meshes), `transparentFrustumRejected`, `transparentDrawCalls` and `transparentSubmittedTriangles`; the latter two include both passes of double-sided materials when required. Unsupported backends leave these metrics null. The bounded `render-progress` event includes the same counters in `transparent`, with `version: 1`, total candidates and `gpuMs: null`: command counts do not measure GPU duration.

For image checks, call `setPose()`, `awaitPages()`, `render()`, then `await flush()` and `capture()`. The WebGPU `flush()` performs an explicit asynchronous image readback outside the beauty loop; `capture()` returns bottom-left RGBA bytes for that submitted frame. If a browser host renders again and immediately calls the existing synchronous `capture()` API, an isolated WebGL2 canvas copies the current GPU canvas with the same engine-owned program and reads its pixels on demand; `capture-synchronous` identifies this expensive compatibility path. It is never used by normal `render()`. A texture-only backend rejects unavailable/stale captures. Serialize `flush()` with explicit host rendering; a frame changed by a host render during readback is rejected rather than returned as current. Streaming completion during readback retains the accepted page bytes and defers its automatic redraw to the next render, preserving the captured frame. The first such deferral emits `capture-streaming-deferred`. The WebGL backends continue reading their rendered default framebuffer so pinned Three r174 tone mapping matches the displayed image.

`pnpm run test:gpu` runs every hardware proof (`test/justesse/`, `test/browser/`) with the repository's own Playwright and esbuild, the machine's Chrome and its actual WebGPU device, and the assets under `.mesure/assets/` (see `scripts/mesure/README.md` § Assets). Nothing outside this repository is read. The Emerald visual proof runs standalone on the test harness server:

```sh
node test/browser/emeraude-webgpu.browser.mjs
```

The Emerald check replays ten bench poses on the same source, camera, pixel error 1, and a 2496×1404 viewport — the internal resolution of the published profile `docs/REFERENCE_UE5.md` compares pass shapes against, declared once as `MEASURE_WIDTH`/`MEASURE_HEIGHT` in `test/appui/emeraldProvenance.mjs` and recorded in the provenance. What is matched is the internal render size, not their 4K output: that comes from a temporal upscale this engine does not have. It saves PNGs, per-view differences, source fingerprints and logs under `benchmark-runs/webgpu-visual/`. A successful runner execution is **not** a full-scene visual-parity verdict: inspect the measured differences and screenshots. The runner measures no performance and proves no memory stability.

The current WebGPU path still lacks per-texture transforms/UV channels/filter modes, environment maps, shadows and the full material contract. Padded texture-array boundaries, transparent compositing and full-scene pixel differences still need dedicated parity checks. The CPU shading oracle encodes linear lighting to sRGB without ACES; it is not a substitute for the displayed-image comparisons.

The separated pipeline has completed real render paths and A/A checks; full material parity and a controlled performance verdict remain unvalidated. Start with material fixtures, then Emerald with fixed camera, resolution, lights, pixel error and warmup. Verify actual direct-presentation logs, independent A/A captures, foreground coverage, transparent compositing and second-view restoration before timing. Preserve raw source hashes and results; old reports do not validate this code. Node tests validate orchestration/CPU contracts with GPU doubles and do not execute WGSL.

For prepared WebGPU scenes, material textures are virtual: every texture is cut into 128×128 tiles (plus a 4-texel border) that live in two fixed-size physical pools (sRGB colour, linear data), one page table per texture says which pool tile serves each tile of each mip level, and only the tiles the image reads are resident. `texturePoolBytes` (512 MiB by default, split evenly between the two pools, in 63.5 MiB layers of 30×30 tiles) is the texture memory of the session whatever the scene; a budget under one layer per pool is raised to one layer, named `texturePoolClamp: 'minimum'`, never refused. Residency is driven by the rendered image itself: the material resolution counts, for one pixel in sixteen (a rotating phase, every pixel during `flush()`), the tile each map needs at the mip level the pixel's derivatives select; transparents write their request into their own `r32uint` target, reduced to the same counters by a compute pass, so the blend fragment stage writes no memory and keeps early depth rejection. The counters come back one frame late through `mapAsync`. `maxTextureTransferBytesPerFrame` (16 MiB by default) bounds the tile bytes copied per frame, most-requested tiles first; when a pool is full, the least recently read tile gives its place, and a tile nothing can accommodate is counted in `textureTilesRefused`, never silently dropped. A tile that is not yet resident is served by its finest resident ancestor, down to the texture's tail (every level of 64 texels or less, pinned from the sidecar at `prepare()`): a missing tile shows a coarser level, never a fill texel. `flush()` renders the pose until nothing it reads is missing, redraws the pending shadow pages, and alternates the two until a drain redraws nothing, replaying the temporal accumulation identically; nothing is released there — a tile stays until a full pool evicts the least recently read one, as in the reference — so a flushed pose is deterministic and the held image returns once the pose is quiet (`pose-settle` diagnostic: rounds, tiles served, shadow frames, what still moves). Frame metrics expose the sixteen `texture*` counters of `TextureFrameMetrics` (pool bytes and layers, resident tiles and bytes, tiles requested / served at level / missing levels / pending, served / evicted / refused, level reads and decodes, host level cache bytes, scratch builds).

`textureSource` (`'host'` by default, `'cache'` to opt in) says where material texels come from. With `'host'` the glTF loader fetches and decodes every source image, as it always did — what a backend that draws the host scene (the Three witness) requires — and the WebGPU backend builds, for a texture without a whole baked chain, a scratch texture with its mip chain (mean colour, median alpha) each time one of its tiles is requested, copying the tiles out of it: the resident memory stays that of the pool, the price is paid in transfers and measured. With `'cache'` an image whose mip chain is baked in the compiled cache is neither fetched nor decoded by the loader: the WebGPU backend reads each baked level on demand (decoded by the browser, held in a 192 MiB host cache to cut further tiles from it) and cuts the requested tiles from it. Ask for `'cache'` only when every backend of the session reads the pools, not the host scene.

When colour tiles arrive or leave, every shadow page is invalidated: a shadow map drawn with the previous alpha would describe foliage the image no longer shows. Pages are redrawn under the ordinary shadow budget, and `flush()` drains the pending ones — up to sixty-four frames per round, replaying the temporal accumulation so the number of frames does not change the image — so a flushed pose is settled, shadows included; what remains pending is published by the `pose-settle` diagnostic and `shadowPagesPending`, never assumed zero. A masked material's cut-out is read at the mip level the reading texel's footprint selects — the camera's derivatives in the visibility raster, the shadow texel's in the shadow depth pass — exactly as the material resolution reads its colour, and the material resolution requests, for every masked pixel of its phase, the tiles each sun cascade that draws that point will read, projected into the cascade with the same affine derivative the shadow pass computes. Known limit: a caster the camera never sees has no one to request its tiles; the shadow pass then reads the finest tile resident under that texel, which is whatever the trajectory left in the pool.

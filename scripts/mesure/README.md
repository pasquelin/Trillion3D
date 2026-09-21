# Shared Benchmark Harness

A single harness for all test batches. One command, no server to start manually, only this repository on the machine: Playwright and esbuild are its dev dependencies, Chrome is the system browser, assets live under `.mesure/assets/`.

    node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
         --vues generale,sol,rue --images 60 --pixelError 0,1

    node scripts/mesure/campagne.mjs
    node scripts/mesure/rapportGlobal.mjs --id my-campaign

The report is rendered by the bilingual React portal. See the [report publication pipeline](report/README.md)
for export, immutable campaign staging, provenance and comparison rules. Rebuilding the site does not
rerun benchmarks.

- `--moteur`: `webgl` (exact-cluster-pages), `webgpu` (webgpu-page-raster), or `webgl2`
  (autonomous-pages-webgl, the autonomous engine decoding geometry pages itself, hence the only one incrementing `pagesDecodedWasm`); it also sets Chromium flags (`optionsCote.mjs`). `webgl2` requires a cache where all primitives are exact clusters: otherwise the compiler leaves `autonomousScene` null and the explorer rejects the run with `AUTONOMOUS_SCENE_UNAVAILABLE`.
  Witnesses to pit on one side via `--moteur-avant`: `three-nu` (Three.js alone, everything drawn every frame) and `three-lod` (Three.js with a three-level `THREE.LOD` per mesh, simplified by meshoptimizer at load: the classic method).
- `--avant` / `--apres`: a built `dist/` directory, or a git ref. Without `--avant`, a single side is measured; `--apres` defaults to `dist/`.
- `--moteur-avant` / `--moteur-apres`: per-side engine overrides. This is how the engine is pitted against the Three witness in a single execution — same poses, same lights, same caches, same server —, making `ecartAvantApres` a fidelity metric rather than a cross-campaign comparison. Chromium flags are the union of both sides' requirements.
- `--scene <name>`: asset scene (`emerald-square` or `whisperwind-village`). Sets the `derived` cache for each side without `--cache-<side>`. Omission infers cache name or defaults to `emerald-square`.
- `--cache-avant` / `--cache-apres`: path to compiled cache output (`native/full`), to compare two compilers on the same scene. Omission reads the scene cache from assets.
- `--ressources <dir>`: directory for glTF resources mounted under `/assets/`. Without it, un-based compiled caches yield 404 textures.
- `--vues` among `generale`, `sol`, `rue`, `detail` (`poses.mjs`, `PATH_VERSION` 5); `--pixelError` accepts a list; also `--chauffe`, `--largeur`, `--hauteur`, `--out`, and `--port`.
- `--rebond on|off` (default `off`): enables bounce lighting.
- `--textures cache|host` (default `host`): `cache` makes WebGPU engine read baked texture mips from cache without opening source images.
- `--antialiasing on|off` (default `on`): toggles TAA jitter and accumulation.
- `--profil on|off` (default `on`): requests per-step timing breakdown.
- `--lampes N`: enables N point lights in the scene. `--ombres on|off` toggles shadow casting; `--lampe-mobile` animates the first light in a circle. `--intensite N` sets light intensity. `--portee F` sets each light's range to `F` grid cells (0.75 by default): above one, several lights reach the same pixel.
- `--soleil`: adds directional sun light with shadow cascades. Combines with `--lampes`.
- `--camera-mobile`: the pose advances by one step along the benchmark trajectory at each measured frame, instead of replaying the same one. This is what distinguishes a still scene from a moving camera — and thus, for the sun, a cached cascade from a re-rendered cascade at each frame. It is also the only way to observe selection cost: with a fixed pose, everything retained frame-to-frame is free and appears nowhere. On Emerald, general view, GPU transparent selection drops `cpuFrameMs` p50 from 17.6 to 12.1 ms at threshold 0 and from 7.2 to 4.5 ms at threshold 1 — an invisible difference with a static camera. The recorded cut hash may differ between sides under this option without the image moving: it comes from asynchronous readback, one frame behind the cut it describes.
- Without `--lampes` or `--soleil`, no lights are declared: the engine renders unlit material albedo. This is its default behavior, not a harness option.

## The Three Witness and Contract Lights

Three adapters do not read `SceneLight` store: they copy lights from the source scene graph and nothing else. The harness is an ordinary host — it creates in Three the lights declared in the store via the public `sceneLighting` option of `createExplorer` (`pageTemoin.mjs`, served to page under `/mesure/` and imported by URL). Nothing is hardcoded: everything comes from `explorer.lights()`, thus from compiled cache and contract — imported scene lights as well as benchmark lights —, and no scene is named.

The mapping is exact in Three units: linear color, unscaled radiometric intensity, `distance` = range, `decay` = 2, yielding windowed inverse square of `directIncidence`; spotlight cone edge is matched by penumbra. Each side publishes in its `lampesTemoin` record what it received, or `null` if not rendered with Three.

What the witness does not render, named rather than guessed: **no shadow casting** — the SDK's Three renderer does not enable shadow maps. A fidelity campaign is run `--ombres off` on both sides, otherwise measured delta reflects shadows rendered solely by our engine.

- `--budget-ombres <ms>`: Shadow stage budget in GPU milliseconds per frame. Without the option, engine keeps its default (1.0 ms). Invalidated pages beyond the budget wait their turn; profile reports `pagesEnAttente` and `retardMaxMs`, and `occludeursGardes`, the clusters the region culls kept on the sampled frame `imageRelevee` (one frame in fifteen, read back after submission). Under `--camera-mobile`, sun cascades slide by whole pages and only the entering strips are redrawn; changes of representation (level of detail, residency, colour tiles) stale pages only once the camera rests, so the moving loop's `pagesInvalidees` counts strips and moving objects alone.
- `--ombres-pages off`: invalidates entire shadow face as soon as an object moves within light range, rather than only pages covered by its projected bounding box. This is the shadow map identity check: two runs differing only by this option must render the **same atlas footprint** and the same image.
- `--empreinte-ombres`: flushes shadow page queue, re-reads depth atlas, and publishes footprint in `series[].sides[].atlasOmbres` (`hash`, `written`, `pagesEnAttente`, `images`). Disabled by default: this is a 64 MB read, not an image timing. Use only with deterministic poses and lights.
- `--instances N` (1, 4, 9 or 12): SDK places N grid copies of the object (`replicaCount`). Default 1. Runs affecting instancing should measure both counts, and the report shows published geometry memory per line ("geometry (MB)" column: page cache bytes plus vertex buffers, `null` if unrecorded).
- `--chemin-math auto|js|wasm` (default `auto`): execution path for core batch computations. `auto` lets governor decide by measurement — no hardcoded threshold in code —, `js` and `wasm` force it for the entire run, comparing paths on identical scene, poses and cache. The "Batch Math Path" table in `resume.md` publishes, per side and per operation, the path taken, medians in nanoseconds per item, transitions, and item count; full report in `series[].sides[].cheminCalcul`. Unexecuted operation median is "unmeasured", never zero.
- `--visible`: opens a real window. Without a window, display caps at 60 Hz on macOS.
- `--images-profil` (default 120): number of trailing measured frames included in the per-stage profile. The profile is reset before that moving-window suffix; it does not substitute a still-pose loop for the measured path.

The measured camera path also advances once per `requestAnimationFrame` on both sides. Its
`rafIntervalMs` distribution is the real moving-frame envelope, including browser backpressure and
the display cap. `cpuFrameMs` remains the engine's synchronous submission reading; the two durations
are never added. Use `--profil off` for the beauty verdict; `--profil on` attributes cost inside the
same moving loop but keeps diagnostic instrumentation active.

Outputs in `--out` (default `.mesure/out/<engine>-<timestamp>/`, gitignored and un-linted):
`mesure.json`, `resume.md`, and per view, threshold, and side: `.png`, `.coupe.txt`, and metrics line — `rafIntervalMs`, `cpuFrameMs` and `cpuSelectMs` p50/p95, `gpuFrameMs` p50 (WebGPU), selected and unrendered triangles, Hi-Z counters, selection hash, page budget, system load —, plus A/A check (same side run twice) and before/after delta per channel. `null` = unmeasured, never inferred; all launched tasks exit cleanly.

### Triangle and Fallback Counters

All are read on **a single frame**: the last frame of the measured loop, indexed in `series[].sides[].imageDuReleve`. None are accumulated over the run.

- `selectedTriangles`: triangles from cluster cut chosen for this frame, before downstream rejection (frustum, occlusion). `null` if engine maintains no cut.
- `drawnTriangles`: triangles submitted for rendering — published cut, opaque and transparent hierarchy combined, minus clusters with no resident page (`uncoveredTriangles`). Counted **on the reported frame itself** when cut is committed, without waiting for GPU readback: distinguishes it from `submittedTriangles`, never `null` due to timing. Occlusion rejection is not subtracted; `hiZ.rejectedTriangles` counts it separately. `null` outside this engine.
- `coverage` (`resume.md` column, calculated by report generator):
  `selectedTriangles − drawnTriangles − uncoveredTriangles`. **Zero is expected**: every cut triangle is either rendered or counted as missing. Non-zero means counters desynchronized across frames. Dash when any of the three is missing.
- `submittedTriangles`: separate hardware count — triangles actually submitted to opaque raster pass, reported by GPU; occlusion rejects a portion after submission. `null` when engine selects cut on GPU and readback has not returned — later numbers do not represent this frame.
- `totalSubmittedTriangles`: same hardware count including transparent passes. `null` under same conditions — on moving camera benchmark, cut changes every frame and async readback never returns: both read `null` where `drawnTriangles` has a value. This, and only this, is mapped to `metrics.triangles` for legacy hosts; `null` when unrecorded, never zero.
- `imageTenue` (`frameHeld` contract): true when reported frame was **held** — unchanged scene, engine only re-encoded presentation. Zero clusters drawn, submitted triangles equal zero: exact record of activity, not missing measurement. Fixed camera benchmark almost always holds final frame; reading `submittedTriangles` without checking this column misinterprets held frame as empty frame. `null` outside this engine.
- `uncoveredTriangles`: triangles in published cut that cannot be rendered — no resident page, no covering ancestor. Represents a visual hole: zero is the only valid number. `null` on engines rendering exactly what is selected.
- `hiZ` (`hiz*Clusters`, `hiz*Triangles`, `hizCountedFrame` contracts): occlusion test input, rejected, and downsampled to coarser mip. On GPU path, represents an **earlier** frame: `hiZ.image` records its index, shown in parentheses. `null` before first frame counted.
- `repliSelectionGpu` (`gpuSelectionFallback` contract): true when GPU cut selection fell back to CPU cut fallback — subsequent metrics describe fallback, not GPU cut. `null` on engines without GPU selection (e.g. WebGL witness); `resume.md` shows `yes` / `no` / `—`.

`resume.md` also features "Per-stage Cost": one line per frame stage, CPU and GPU p50/p95 columns (never summed), plus shadow metrics (lights, re-rendered faces, draw calls), device timing method, and profiling overhead. Stored as-is in `mesure.json` under `series[].sides[].profilParEtape`. "Unmeasured" is not zero.

"GPU Memory" section reports allocated and un-freed VRAM per side and view — textures and buffers tracked via device wrapper register, WebGPU having no native VRAM query —, split into three named categories (computed texture atlas, allocated geometry pool, resolution-dependent render targets), remaining by difference, with top labeled allocations; full breakdown in `series[].sides[].metrics.gpuAllocatedByLabel`. The sixteen virtual texture counters appear under each stage ("Textures", "Image Feedback", "Broadcaster"): pool is fixed, "resident" is active view usage.

Capture is taken on a **still pose**: after warmup, pose renders until held — temporal accumulation converged, no pending work —, max 64 frames (`poseCalme`, `pageMesure.mjs`). Mid-accumulation captures reflect trajectory history with non-deterministic tile streaming across runs. `series[].sides[].imagesCalme` records required frame count, `null` if engine does not hold frames (Three witness).

Each series runs in a fresh page, closed immediately after. Emerald scene leaves hundreds of MBs active; reusing pages causes `new THREE.WebGLRenderer` to fail context creation ("Error creating WebGL context", observed Sept 14, 2026). Closing page restores WebGL context and heap to browser.

## Assets

Harness serves `.mesure/assets/` (gitignored; `WG_ASSETS` points to alternative path) under `/benchmark-assets/`. Expects reference scene `emerald-square`: `emerald-square/` (glTF and textures, `emerald-day.gltf`) and `emerald-square-derived/` (compiled cache, `native/full/manifest.json`). Recompile cache from source:

    pnpm run build && pnpm run build:native
    WEB_GEOMETRY_COMPILER_BIN=packages/asset-compiler-rust/target/release/web-geometry-compiler \
    node dist/sdk-node/cli.mjs .mesure/assets/emerald-square/emerald-day.gltf \
         .mesure/assets/emerald-square-derived full 150000 /benchmark-assets/emerald-square/

Resource base URL is where harness serves sources for compiled glTF texture fetch. Cache fingerprint is `key` in `manifest.json`, recorded in `mesure.json`: comparisons require identical keys.

## Measuring Another Scene

Harness is scene-agnostic: measures provided caches, pose bounds read from page model bounds. Three setup steps:

1. **Compile glTF** as shown above (§ Assets), to `<name>-derived/` folder — under `.mesure/assets/` or elsewhere, gitignored.
2. **Name cache for both sides**: `--cache-avant <dir>` and `--cache-apres <dir>`. Scene name derived from `derived` directory; defaulting to reference scene cache if omitted.
3. **Mount resources**: `--ressources <dir>` sets relative glTF resource folder. Omission yields 404 textures. Caches compiled with absolute `resourceBaseUrl` fetch directly from URL; logged errors indicate per-page resolution.

Memory pools match engine fixed byte budgets: `--pool-geometrie <MiB>` (geometry pages, default 512 MiB) and `--pool-textures <MiB>` (texture tiles, default 512 MiB). Extreme values test degradation behavior, logged in metrics (`poolGeometrie.borne`, `poolGeometrie.saturees`, `coverageBudgetLimited`, `budgetPages.seuilBudget` — the rung of the screen-error ladder the image is drawn at, `0` when the requested cut fits, also in the `page budget` column of `resume.md` —, `textureTilesRefused`). `--max-pages` remains a PAGE cap for test scenes. Recorded in metrics; comparisons require matching pool sizes.

IN-SESSION adjustment (app slider via `explorer.setMemoryBudgets`) measured via `--pool-geometrie-vivant <MiB>` and `--pool-textures-vivant <MiB>`: post-warmup, harness resizes pools and logs engine response (`series[].sides[].reglageVivant`: retained pools, evicted items, resize duration, pre-resize residency) and frame count to recover held pose (`imagesReprise`, `null` if unrecoverable — pool smaller than view). Long warmup (`--chauffe 60`) fills pools before adjustment. To GROW geometry pool in-session, `--pool-geometrie-plafond <MiB>` declares max session pool ceiling.

## Performance Benchmarks

Located per package under `packages/<package>/bench/`, executed via `pnpm run perf:all`. Operation, oracles, and baselines documented in [`docs/TESTS.md`](../../docs/TESTS.md); this README covers the campaign harness measuring real scenes in-browser.

# Shared Benchmark Harness

A single harness for all test batches. One command, no server to start manually, only this repository on the machine: Playwright and esbuild are its dev dependencies, Chrome is the system browser, assets live under `.mesure/assets/`.

    node bench/runner/bench.ts --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
         --vues generale,sol,rue --images 60 --pixelError 0,1

    node bench/runner/campaign.ts
    node bench/runner/summaryGlobal.ts --id my-campaign

The report is rendered by the bilingual React portal. See [Published reports](#published-reports)
for export, immutable campaign staging, provenance and comparison rules. Rebuilding the site does not
rerun benchmarks.

- `--moteur`: `webgl` (exact-cluster-pages), `webgpu` (webgpu-page-raster), or `webgl2`
  (autonomous-pages-webgl, the autonomous engine decoding geometry pages itself, hence the only one incrementing `pagesDecodedWasm`); it also sets Chromium flags (`sideOptions.ts`). `webgl2` requires a cache where all primitives are exact clusters: otherwise the compiler leaves `autonomousScene` null and the explorer rejects the run with `AUTONOMOUS_SCENE_UNAVAILABLE`.
  Witnesses to pit on one side via `--moteur-avant`: `three-nu` and `three-lod`, see [The witnesses](#the-witnesses).
- `--avant` / `--apres`: a built `dist/` directory, or a git ref. Without `--avant`, a single side is measured; `--apres` defaults to `dist/`.
- `--moteur-avant` / `--moteur-apres`: per-side engine overrides. This is how the engine is pitted against the Three witness in a single execution — same poses, same lights, same caches, same server —, making `ecartAvantApres` a fidelity metric rather than a cross-campaign comparison. Chromium flags are the union of both sides' requirements.
- `--scene <name>`: asset scene, any folder of `.mesure/assets/` that `assets.ts` compiled (`sponza`, `normal-tangent-mirror-test`, `facade-7`, …). Sets the `derived` cache for each side without `--cache-<side>`. Omission infers cache name or defaults to `sponza`.
- `--cache-avant` / `--cache-apres`: path to compiled cache output (`native/full`), to compare two compilers on the same scene. Omission reads the scene cache from assets.
- `--ressources <dir>`: directory for glTF resources mounted under `/assets/`. Without it, un-based compiled caches yield 404 textures.
- `--vues` among `generale`, `sol`, `rue`, `detail` (`poses.ts`, `PATH_VERSION` 5); `--pixelError` accepts a list; also `--chauffe`, `--largeur`, `--hauteur`, `--out`, and `--port`.
- `--rebond on|off` (default `off`): enables bounce lighting.
- `--textures cache|host` (default `host`): whether the glTF loader opens the source images. `cache` skips every image whose chain the cache carries; `host` decodes them all, which the Three witnesses need. The engine reads the baked levels either way (#289), so the two sides render the same image and differ only in what the loader fetches — the harness keeps `host` by default because a side may be a witness, and a witness side reads its images whatever the flag says (the engine resolves `cache` back to `host` for a backend that draws the host scene).
- `--budget-textures <ms>`: CPU milliseconds a frame may spend copying texture tiles into the pools (`maxTextureUploadMsPerFrame`). Without the option, the engine keeps its default (1.0 ms). Tiles beyond the budget wait for the next frame and show their coarser resident level meanwhile; the profile's "Textures" stage gives the pass's p50/p95 and the metrics its worst pass (`textureUploadPeakMs`) and what it deferred (`textureTilesDeferred`). A cold traversal (`--chauffe 0 --camera-mobile --textures cache`) is where it is read: on a still pose the barrier lifts it.
- `--compression auto|bc7|astc|none` (default `auto`), or per side `--compression-avant` / `--compression-apres`: block family of the WebGPU texture pools, under `--textures cache`. `auto` takes the first family the device samples — the BC family before ASTC 4×4 — that the cache holds kept chains in, `none` keeps every pool RGBA8 (the lossless "before" of a texture comparison), `bc7` or `astc` insist on one and fall back to RGBA8, by name, when the device lacks it. A chain the cook's quality gate left lossless stays in the RGBA8 lane whatever the choice. Two sides on one `dist/` and one cache with `--compression-avant none --compression-apres bc7` measure the family alone; the summary's texture line names the family actually held (`texturePoolFormat`).
- `--antialiasing on|off` (default `on`): toggles TAA jitter and accumulation.
- `--profil on|off` (default `on`): requests per-step timing breakdown.
- `--lampes N`: enables N point lights in the scene. `--ombres on|off` toggles shadow casting; `--lampe-mobile` animates the first light in a circle. `--intensite N` sets light intensity. `--portee F` sets each light's range to `F` grid cells (0.75 by default): above one, several lights reach the same pixel.
- `--soleil`: adds directional sun light with shadow cascades. Combines with `--lampes`.
- `--camera-mobile`: the pose advances by one step along the benchmark trajectory at each measured frame, instead of replaying the same one. This is what distinguishes a still scene from a moving camera — and thus, for the sun, a cached cascade from a re-rendered cascade at each frame. It is also the only way to observe selection cost: with a fixed pose, everything retained frame-to-frame is free and appears nowhere. On a ten-million-triangle interior, general view, GPU transparent selection drops `cpuFrameMs` p50 from 17.6 to 12.1 ms at threshold 0 and from 7.2 to 4.5 ms at threshold 1 — an invisible difference with a static camera. The recorded cut hash may differ between sides under this option without the image moving: it comes from asynchronous readback, one frame behind the cut it describes.
- Without `--lampes` or `--soleil`, no lights are declared: the engine renders unlit material albedo. This is its default behavior, not a harness option.

- `--budget-ombres <ms>`: Shadow stage budget in GPU milliseconds per frame. Without the option, engine keeps its default (1.0 ms). Invalidated pages beyond the budget wait their turn; profile reports `pagesEnAttente` and `retardMaxMs`, and `occludeursGardes`, the clusters the region culls kept on the sampled frame `imageRelevee` (one frame in fifteen, read back after submission). Under `--camera-mobile`, sun cascades slide by whole pages and only the entering strips are redrawn; changes of representation (level of detail, residency, colour tiles) stale pages only once the camera rests, so the moving loop's `pagesInvalidees` counts strips and moving objects alone.
- `--ombres-pages off`: invalidates entire shadow face as soon as an object moves within light range, rather than only pages covered by its projected bounding box. This is the shadow map identity check: two runs differing only by this option must render the **same atlas footprint** and the same image.
- `--empreinte-ombres`: flushes shadow page queue, re-reads depth atlas, and publishes footprint in `series[].sides[].atlasOmbres` (`hash`, `written`, `pagesEnAttente`, `images`). Disabled by default: this is a 64 MB read, not an image timing. Use only with deterministic poses and lights.
- `--instances N` (1, 4, 9 or 12): SDK places N grid copies of the object (`replicaCount`). Default 1. Runs affecting instancing should measure both counts, and the report shows published geometry memory per line ("geometry (MB)" column: page cache bytes plus vertex buffers, `null` if unrecorded).
- `--chemin-math auto|js|wasm` (default `auto`): execution path for core batch computations. `auto` lets governor decide by measurement — no hardcoded threshold in code —, `js` and `wasm` force it for the entire run, comparing paths on identical scene, poses and cache. The "Batch Math Path" table in `resume.md` publishes, per side and per operation, the path taken, medians in nanoseconds per item, transitions, and item count; full report in `series[].sides[].cheminCalcul`. Unexecuted operation median is "unmeasured", never zero.
- `--visible`: opens a real window. Without a window, display caps at 60 Hz on macOS.
- `--images-profil` (default 120): number of trailing measured frames included in the per-stage profile. The profile is reset before that moving-window suffix; it does not substitute a still-pose loop for the measured path.

## The witnesses

A witness is a comparison backend the harness pits against the engine on one side
(`--moteur-avant three-nu|three-lod|webgl`). The SDK never mounts one on its own: they are reached
through the measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`) as
`referenceBackend`, `threeLodBackend` and `exactPagesBackend`, opt-in through the session's
`backends` option.

- `three-nu` (`reference`): Three.js alone, every mesh drawn every frame.
- `three-lod` (`three-lod`): Three.js with a three-level `THREE.LOD` per mesh, simplified by
  meshoptimizer at load — the classic method.
- `webgl` (`exact-cluster-pages`): the cache's clusters drawn over Three.js scene data through an
  engine-owned WebGL2 program — glTF 2.0 metallic-roughness maps, Lambert diffuse with a
  Cook-Torrance GGX specular, correlated Smith visibility and Schlick Fresnel (Karis, SIGGRAPH 2013
  Physically Based Shading course notes), with the geometric specular antialiasing of
  Tokuyoshi and Kaplanyan, *Improved Geometric Specular Antialiasing* (2019). Transmissive meshes are
  composed after the clusters over a frozen backdrop of the frame. A material the program cannot
  preserve fails preparation with `CLUSTER_MATERIAL_UNSUPPORTED`, whose `details.reason` names the
  input; `autonomousClusterDrawsTotal` counts the program's draws.

### Contract lights on the witnesses

`three-nu` and `three-lod` do not read the `SceneLight` store: they copy lights from the source
scene graph. The harness is an ordinary host — it creates in Three the lights declared in the store
via the `sceneLighting` option of `openMeasuredWorld` (`witnessPage.ts`, served under `/runner/` and
imported by URL). Nothing is hardcoded: everything comes from the measured world's `lights()`, thus
from the compiled cache and the contract, and no scene is named. `exact-cluster-pages` translates
the store itself on every store revision (`packages/sdk-browser/src/backend/exact/contractLights.ts`).

The mapping is exact in Three units: linear colour, unscaled radiometric intensity (W/sr for a point
or a spot, irradiance for a directional), `distance` = range and `decay` = 2 — term for term the
windowed inverse square of the engine's own shader — and the spot edge matched by penumbra. What is
not equal is the surface model: same incident irradiance, different BRDF. Each side publishes in its
`lampesTemoin` record what it received, or `null` if not rendered with Three. The contract takes over
only once the host used it (one light declared, one view requested); from then on the source graph's
lights are switched off.

What the witnesses do not render, named rather than guessed: **no shadow casting** — one shadow map
per light, six faces for a point light, is outside any frame budget — and `'bounce'` renders the lit
view. A fidelity campaign is run `--ombres off` on both sides, otherwise the measured delta reflects
shadows rendered by the engine alone. `'unlit'` on `exact-cluster-pages` is obtained by lighting, not
by substituting materials: one white ambient light of irradiance π returns the albedo once
`metalness`, `aoMapIntensity`, `lightMapIntensity` and `transmission` are zeroed for the length of
each frame; a material's own emission is still added. The WebGL witnesses read back their rendered
default framebuffer so captures match the displayed image.


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

Finer than the stages, `series[].sides[].bornesCpu` holds the engine's CPU bounds over the same window as the per-stage profile (`explorer.cpuSteps()`, read once after the measured loop): `frames` is how many images filed a row, `steps` the p50/p95/max of each named bound (`gateMs`, `worldMs`, `selectionDispatchMs`, …) over the images that filed it — a bound no image filed reads `null` — and `worst` the rows of the slowest images. `null` where the path keeps no row (the CPU reference cut), with `--profil off`, or on a dist older than #80.

"GPU Memory" section reports allocated and un-freed VRAM per side and view — textures and buffers tracked via device wrapper register, WebGPU having no native VRAM query —, split into three named categories (computed texture atlas, allocated geometry pool, resolution-dependent render targets), remaining by difference, with top labeled allocations; full breakdown in `series[].sides[].metrics.gpuAllocatedByLabel`. The nineteen virtual texture counters appear under each stage ("Textures", "Image Feedback", "Broadcaster"): pool is fixed, "resident" is active view usage.

Capture is taken on a **still pose**: after warmup, pose renders until held — temporal accumulation converged, no pending work —, max 64 frames (`poseCalme`, `measurePage.ts`). Mid-accumulation captures reflect trajectory history with non-deterministic tile streaming across runs. `series[].sides[].imagesCalme` records required frame count, `null` if engine does not hold frames (Three witness).

What the shadow pass did on each measured frame is in `series[].sides[].ombresParImage`: for `shadowPagesRequested`, `shadowPagesCached`, `shadowPagesDrawn`, `shadowLightCuts`, `shadowPoolPages` and `shadowFacesDrawn`, the mean, p95 and max over the frames that published it (`shadowCountersPerFrame`, `measurePage.ts`); a counter the dist does not publish is `null`, never zero.

Each series runs in a fresh page, closed immediately after. A large scene leaves hundreds of MBs active; reusing pages causes `new THREE.WebGLRenderer` to fail context creation ("Error creating WebGL context", observed Sept 14, 2026). Closing page restores WebGL context and heap to browser.

## Assets

Harness serves `.mesure/assets/` (gitignored; `WG_ASSETS` points to alternative path) under
`/benchmark-assets/`. A scene is a pair of folders: `<scene>/` holds the source glTF and its
images, exactly as published and never written to, and `<scene>-derived/` the compiled cache
(`native/full/manifest.json`). One command produces both:

    pnpm run build && pnpm run build:native
    node bench/runner/assets.ts                 # everything
    node bench/runner/assets.ts --only sponza   # one scene, both steps
    node bench/runner/assets.ts --list          # what each model is kept for

It fetches the twelve models the proofs run on from
[KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) — one sparse,
blobless, depth-one clone for the whole set — into `.mesure/assets/<kebab-name>/`, then compiles
every scene that has no cache yet, with the repository's own compiler, scope `full`, triangle
budget 150 000 and the default `qem-endpoints` simplification. **Both steps are idempotent**: a
source folder already there is kept untouched, a cache whose `manifest.json` is ready is not built
again. Deleting a `<scene>-derived/` folder is how one asks for a rebuild.

The worker count and the RAM admission budget are read off the machine, never chosen: every core
`os.availableParallelism()` reports, and half of `os.totalmem()` as the budget — the other half is
what the OS, the browser and the rest of the session keep. Both are printed with each job, so a
cache carries the shape of the machine that cooked it. The 256 MiB default of the compiler is too
small for a large scene: omitted, a run stops on `RAM_ADMISSION_BUDGET_EXCEEDED`.

The bench's reference scenes are `sponza` (262 267 triangles, 103 primitives, 69 images: the cut,
the sun and its shadows) and `normal-tangent-mirror-test` (mirrored texture coordinates). The other
ten are the small cases a proof points at when it needs one thing and nothing else —
`alpha-blend-mode-test` for the three alpha modes, `texture-coordinate-test` for a layout read
straight off the image, `flight-helmet` for many small primitives, and so on. Measurements
published before 22 Sept. 2026 name two private scenes that are no longer on any machine and are
kept as they were read: no new measurement runs on them.

A **facade** scene is generated rather than fetched — a block of walls whose texture coordinates
are laid out three ways on different walls (one island per wall, one per window, mirrored halves)
over a checkerboard that names each of its cells in digits, so a slide of one cell is visible on a
capture:

    node bench/runner/scenes/facade.ts --seed 7 [--triangles 300000]
    node bench/runner/assets.ts --only facade-7

The seed alone reproduces the block: plan, storeys and which bays are pierced are drawn from it,
and the subdivision is whatever reaches the requested triangle count (a few hundred thousand by
default, also drawn from the seed). `tests/browser/probes/public-scenes.ts` reads what these caches
guarantee — a DAG that climbs above level 0 wherever there is more than one cluster to coarsen, and
a mirrored mapping that costs the simplification nothing — in a tenth of a second, without a GPU.

Resource base URL is where harness serves sources for compiled glTF texture fetch. Cache fingerprint is `key` in `manifest.json`, recorded in `mesure.json`: comparisons require identical keys.

## Measuring Another Scene

Harness is scene-agnostic: measures provided caches, pose bounds read from page model bounds. Three setup steps:

1. **Compile glTF** as shown above (§ Assets), to `<name>-derived/` folder — under `.mesure/assets/`, where dropping a source folder is enough for `assets.ts` to compile it, or elsewhere, gitignored.
2. **Name cache for both sides**: `--cache-avant <dir>` and `--cache-apres <dir>`. Scene name derived from `derived` directory; defaulting to reference scene cache if omitted.
3. **Mount resources**: `--ressources <dir>` sets relative glTF resource folder. Omission yields 404 textures. Caches compiled with absolute `resourceBaseUrl` fetch directly from URL; logged errors indicate per-page resolution.

Memory pools match engine fixed byte budgets: `--pool-geometrie <MiB>` (geometry pages, default 512 MiB) and `--pool-textures <MiB>` (texture tiles, default 512 MiB). Extreme values test degradation behavior, logged in metrics (`poolGeometrie.borne`, `poolGeometrie.saturees`, `coverageBudgetLimited`, `budgetPages.seuilBudget` — the rung of the screen-error ladder the image is drawn at, `0` when the requested cut fits, also in the `page budget` column of `resume.md` —, `textureTilesRefused`). `--max-pages` remains a PAGE cap for test scenes. Recorded in metrics; comparisons require matching pool sizes.

IN-SESSION adjustment (app slider via `explorer.setMemoryBudgets`) measured via `--pool-geometrie-vivant <MiB>` and `--pool-textures-vivant <MiB>`: post-warmup, harness resizes pools and logs engine response (`series[].sides[].reglageVivant`: retained pools, evicted items, resize duration, pre-resize residency) and frame count to recover held pose (`imagesReprise`, `null` if unrecoverable — pool smaller than view). Long warmup (`--chauffe 60`) fills pools before adjustment. To GROW geometry pool in-session, `--pool-geometrie-plafond <MiB>` declares max session pool ceiling.

## What a Cache's Pages Cost in Precision

    node bench/runner/pageQuantization.ts <cache>/native/full

The autonomous WebGL2 path draws decoded geometry pages — positions on the primitive's
quantization grid, normals as octahedral bytes ([`docs/FORMAT.md`](../../docs/FORMAT.md)) — where
every other path reads the float attributes of `source.bin`. This script compares the two corner
by corner and prints the largest and mean position gap and the angle between the two normals: the
input difference behind an image difference between that path and a witness, measured rather than
supposed. On `site/assets/kinetic-garden` (430 pages, 107 520 corners): `maxPositionGap`
6.10 × 10⁻⁵, `maxNormalGapDegrees` 0.613, mean 0.284°.

## Published reports

Reports are part of the bilingual learning portal. Measurement, export and site build are
separate operations; rebuilding the interface never launches Chrome or benchmarks.

1. Build the engine and run `node bench/runner/campaign.ts --out .mesure/out/<campaign>`.
   Resume requires the same execution arguments, repository state, built JavaScript, asset
   manifest, browser version and machine, and a completed measurement without errors. A mismatch refuses to
   overwrite evidence: select another output directory. Browser-version changes invalidate resume and comparisons.
2. Export with `node bench/runner/summaryGlobal.ts --dossier .mesure/out/<campaign>
   --vers .mesure/out/<campaign>-report --id <campaign>` (on one line).
3. Stage with `node bench/runner/publishReport.ts --dossier .mesure/out/<campaign>-report`.
   Campaign IDs are immutable. The script writes `site/reports/<id>/` and updates the
   catalogue, which the portal's Measurements area reads. It does not deploy or push anything.
4. Validate, then preview with `pnpm docs:serve` (it builds the bundles first).
   Publishing follows the normal issue/PR and maintainer release workflow.

`formatVersion: 1` contains runs and individual readings, original PNG evidence, and public
source JSON. Machine and browser records come from measurement time, never the exporter.
Unknown values stay null. Filesystem paths and commands are excluded from public source JSON.
The original private `mesure.json` files are never overwritten. Capture paths must stay inside
the measurement directory. Export into a new directory; do not reuse an existing export.

The portal presents seven categories through the sidebar, with named-engine charts, every measured image
pair as a slider, all scene/run comparisons, and complete source tables including repeated captures.
There are no global filters. Primary charts and comparisons stay visible; raw source and protocol tables use closed disclosures. The hash identifies a campaign and tab; the latest
campaign opens by default. All source numbers remain visible, with null distinct from zero.
Timing methods stay separate; no GPU pass sum is presented as a frame. Observed arithmetic
is shown when both readings exist, with an explicit warning that it is not a controlled performance
claim. Percentages still require matching recorded conditions. Repeated-run uncertainty is not
available in current inputs, so no significance or speedup verdict is claimed.

Source tables and downloads preserve diagnostics for lighting, shadow pages, bounce, residency,
streaming, resolution, CPU stages, GPU passes and fidelity. Hardware publication references
remain outside controlled comparisons. Original captures are lazy-loaded without changing their
pixels. Missing captures remain unavailable. The report does not infer fidelity from appearance.

## Performance Benchmarks

Located under `bench/perf/<package>/`, executed via `pnpm run perf:all`. Operation, oracles, and baselines documented in [`docs/TESTS.md`](../../docs/TESTS.md); this README covers the campaign harness measuring real scenes in-browser.

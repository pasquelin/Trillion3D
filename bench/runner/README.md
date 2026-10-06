# Shared Benchmark Harness

One harness for every test batch: one command, no server to start by hand, only this repository on
the machine — Playwright and esbuild are its dev dependencies, Chrome is the system browser, assets
live under `.mesure/assets/`.

    node bench/runner/bench.ts --engine webgpu --before <ref-git|dist> --after <ref-git|dist> \
         --views overview,ground,street --images 60 --pixelError 0,1

    node bench/runner/campaign.ts                      # writes .mesure/out/global/ by default
    node bench/runner/summary/summaryGlobal.ts --id my-campaign   # exports its report data (see Published reports)

A flag the harness never reads — misspelt, retired (the French names, `--moteur`, `--vues`,
`--largeur`, `--lampes`, …) or naming a side the run does not measure — stops `bench.ts`,
`trajectory/trajectory.ts`, `references/oracle.ts` and `campaign.ts` with `unknown flag: --<name>` before any build or
browser. The report is rendered by the bilingual React portal ([Published
reports](#published-reports)); rebuilding the site does not rerun benchmarks.

## Flags

`<side>` is `before` or `after`. Chromium flags come from the engine (`sideOptions.ts`); with two
engines they are the union of both sides' requirements.

| Flag                                                                   | Default                                 | Effect                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--engine`                                                             | `webgl`                                 | `webgpu` (webgpu-page-raster, the engine), `webgl2` (autonomous-pages-webgl¹), or a witness: `webgl` (exact-cluster-pages), `three-nu`, `three-lod` ([The witnesses](#the-witnesses))                                                                                                                                                                                                                                    |
| `--engine-before` / `--engine-after`                                   | `--engine`                              | per-side engine: the engine against a witness in one run — same poses, lights, caches, server — so `beforeAfterDiff` is a fidelity metric, not a cross-campaign comparison                                                                                                                                                                                                                                               |
| `--before` / `--after`                                                 | none / `dist/`                          | a built `dist/` or a git ref; without `--before` one side is measured                                                                                                                                                                                                                                                                                                                                                    |
| `--scene <name>`                                                       | inferred from the cache, else `sponza`  | any folder of `.mesure/assets/` that `assets/assets.ts` compiled (`sponza`, `normal-tangent-mirror-test`, `facade-7`, …); sets each side's `derived` cache without `--cache-<side>`. `--scene fluids` (`fluids/fluids.ts`, #418): no cache, one ocean, 100 floating bodies, 20 fires, 5 smoke volumes built through the public API on `webgpu` or `webgl2`; `resume.md` then has a "Fluids scene" table instead of views |
| `--cache-before` / `--cache-after`                                     | the scene's cache                       | compiled cache (`native/full`), to compare two compilers on one scene                                                                                                                                                                                                                                                                                                                                                    |
| `--resources <dir>`                                                    | none                                    | glTF resources mounted under `/assets/`; without it, un-based caches yield 404 textures                                                                                                                                                                                                                                                                                                                                  |
| `--views`                                                              | `overview,ground,street`                | among `overview`, `ground`, `street`, `detail` (`trajectory/poses.ts`, `PATH_VERSION` 9)²                                                                                                                                                                                                                                                                                                                                |
| `--images` / `--warmup`                                                | 60 / 8                                  | measured and warmup frames                                                                                                                                                                                                                                                                                                                                                                                               |
| `--pixelError`                                                         | `0`                                     | a list of screen-error thresholds                                                                                                                                                                                                                                                                                                                                                                                        |
| `--width` / `--height` / `--dpr`                                       | 1280 / 720 / 1                          | CSS viewport kept as asked; `--dpr 2` renders twice the pixels per axis; `--dpr` positive                                                                                                                                                                                                                                                                                                                                |
| `--out` / `--port`                                                     | `.mesure/out/<engine>-<timestamp>/` / 0 | output directory, server port                                                                                                                                                                                                                                                                                                                                                                                            |
| `--bounce on\|off`                                                     | `off`                                   | bounce lighting                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--textures cache\|host`                                               | `host`                                  | `cache` skips every source image whose chain the cache carries; `host` decodes them all, as the Three witnesses need. The engine reads the baked levels either way (#289), so the sides differ only in what the scene fetches; a witness side reads its images whatever the flag (the engine resolves `cache` back to `host` for a backend that draws the host scene)                                                    |
| `--texture-budget <ms>`                                                | engine's 1.0 ms                         | CPU ms a frame may copy texture tiles (`maxTextureUploadMsPerFrame`); tiles past it wait, showing their coarser level. Read on a cold traversal (`--warmup 0 --moving-camera --textures cache`) — a still pose's barrier lifts it: "Textures" stage p50/p95, `textureUploadPeakMs`, `textureTilesDeferred`                                                                                                               |
| `--compression auto\|bc7\|astc\|none`, `--compression-<side>`          | `auto`                                  | block family of the WebGPU texture pools under `--textures cache`³                                                                                                                                                                                                                                                                                                                                                       |
| `--antialiasing on\|off`                                               | `on`                                    | TAA jitter and accumulation                                                                                                                                                                                                                                                                                                                                                                                              |
| `--scale <s>`, `--scale-<side> <s>` (#816)                             | display                                 | WebGPU frame drawn at `s` ∈ [0.5, 1] per axis, reconstructed by the temporal resolve⁴                                                                                                                                                                                                                                                                                                                                    |
| `--reference`                                                          | off                                     | class-2 image proof against the [reference image](#reference-images)⁵                                                                                                                                                                                                                                                                                                                                                    |
| `--profile on\|off`                                                    | `on`                                    | per-stage timing; `off` for the beauty verdict                                                                                                                                                                                                                                                                                                                                                                           |
| `--profile-frames`                                                     | 120                                     | trailing measured frames in the per-stage profile, reset before that moving-window suffix (no still-pose loop substituted)                                                                                                                                                                                                                                                                                               |
| `--lights N`                                                           | 0                                       | contract point lights; without `--lights` or `--sun` none are declared and the engine renders unlit albedo (its default, not a harness option)                                                                                                                                                                                                                                                                           |
| `--shadows on\|off` / `--moving-light` / `--intensity N` / `--range F` | `on` / off / 40 / 0.75                  | shadow casting; the first light circles; light intensity; each light's range in grid cells (above one, several lights reach a pixel)                                                                                                                                                                                                                                                                                     |
| `--sun`                                                                | off                                     | directional sun with its virtual shadow maps; combines with `--lights`                                                                                                                                                                                                                                                                                                                                                   |
| `--moving-camera`                                                      | off                                     | the pose advances one trajectory step per measured frame⁶                                                                                                                                                                                                                                                                                                                                                                |
| `--instances N`                                                        | 1                                       | 1, 4, 9 or 12 grid copies (`replicaCount`); instancing changes measure both counts; "geometry (MB)" = page cache plus vertex buffers, `null` if unrecorded                                                                                                                                                                                                                                                               |
| `--math-path auto\|js\|wasm`                                           | `auto`                                  | batch maths path; `auto` lets the governor measure (no threshold in code). "Batch Math Path" table: path, ns/item medians, transitions, item count per side and operation; `series[].sides[].mathBatch`; an unexecuted median is "unmeasured", never zero                                                                                                                                                                |
| `--gaze-network` (#41)                                                 | off                                     | counts bytes Chrome transferred instead of timing ([GAZE_NETWORK.md](GAZE_NETWORK.md)); needs a compiled cache, `--textures cache`, `--engine webgpu` on every side; `gazeNetwork` in `measure.json`, "Gaze-driven network transfer" in `resume.md`                                                                                                                                                                      |
| `--visible`                                                            | off                                     | a real window; headless caps display at 60 Hz on macOS                                                                                                                                                                                                                                                                                                                                                                   |
| `--geometry-pool` / `--texture-pool <MiB>`                             | 512 MiB each                            | [Measuring another scene](#measuring-another-scene)                                                                                                                                                                                                                                                                                                                                                                      |

1. The autonomous engine decodes geometry pages itself, hence the only one incrementing
   `pagesDecodedWasm`. It needs a cache of exact clusters only: otherwise `autonomousScene` is null
   and the explorer rejects the run with `AUTONOMOUS_SCENE_UNAVAILABLE`.
2. Eye-level views walk the model's street, read off its geometry (`street/street.ts`): its cooked
   `physics.json` is asked, column by column, for ground, nearest wall at eye height and open sky;
   the roomiest open-sky column is the street, the nearer the centre between equals; an unanswered
   column is unknown, never the street; no clearance reaches past the box. No `physics.json` or no
   street is reported (`bounds.noStreet`) and walks the box centre with half its narrower side as
   room (`boxStreet`). Other views fly one eye above the top. No scene named, no open share assumed.
3. `auto` takes the first family the device samples (BC before ASTC 4×4) that the cache holds kept
   chains in; `none` keeps RGBA8 (a texture comparison's lossless "before"); `bc7`/`astc` fall back
   to RGBA8 by name without device support. A chain the cook's quality gate left lossless stays
   RGBA8. `--compression-before none --compression-after bc7` on one `dist/` and cache measures the
   family alone; the summary names the family held (`texturePoolFormat`).
4. `--engine webgpu --before dist --after dist --scale-after 0.67` compares converged still
   captures, native vs reconstructed; `resume.md` adds the mean and 99.9th percentile channel error
   in 1/255 steps (#816's bar: mean ≤ 1, p99.9 ≤ 8).
5. `references/imageDiff.ts::referenceDiff`: mean and 99.9th-percentile channel error, mean LDR-FLIP, under
   `series[].referenceDiff` and in `resume.md`. The run stops by name when there is no reference for
   the scene or view, or another pose, image setting (size, DPR, lights, sun, bounce, instances), a
   moving camera or light, a reference from uncommitted changes, or an image absent from
   `.mesure/references/` or other than its `reference.json` names.
6. Separates a still scene from a moving camera (for the sun, cached from redrawn shadow pages), and
   is the only way to see selection cost: on a fixed pose what is retained is free. Its cut hash may
   differ between sides with no image change (async readback, one frame late)⁷.
7. On a ten-million-triangle interior, general view, GPU transparent selection drops `cpuFrameMs`
   p50 from 17.6 to 12.1 ms at threshold 0 and 7.2 to 4.5 ms at threshold 1, invisible to a static
   camera.

Every run first probes browser limits (`limits.ts`): WebGL2 half-float and float colour targets,
`EXT_disjoint_timer_query_webgl2`, WebGPU `timestamp-query` and the limits the adapter grants past
the defaults (`limits` in `measure.json`, "Browser limits" in `resume.md`).

**Shadow pages.** Every page a frame marks is drawn that frame, in as many batches as needed; the
profile gives `pagesPending` (0 unless a batch could not be encoded), `maxWaitMs`, and
`occludersKept` on `sampledFrame` (one frame in fifteen, read back after submission). Under
`--moving-camera` the sun is a clipmap: each level is a window of pages addressed by absolute page
modulo the window, so a step keeps inside pages and draws only entering strips; representation
changes (level of detail, residency, colour tiles) stale pages only at rest, so the moving
`pagesInvalidated` counts strips and moving objects alone.

## The witnesses

A witness is a comparison backend pitted against the engine on one side
(`--engine-before three-nu|three-lod|webgl`). The SDK never mounts one: they come from the witness
entry point (`bench/witnesses/measurement.ts`, bundled by `pnpm run build` into
`dist/witnesses/measurement.js`, left out of the package) as `referenceBackend`, `threeLodBackend`
and `exactPagesBackend`, opt-in through the session's `backends` option.

- `three-nu` (`reference`): Three.js alone, every mesh every frame.
- `three-lod` (`three-lod`): Three.js with a three-level `THREE.LOD` per mesh simplified by
  meshoptimizer at load — the classic method.
- `webgl` (`exact-cluster-pages`): the cache's clusters over Three.js scene data through an
  engine-owned WebGL2 program — glTF 2.0 metallic-roughness, Lambert diffuse with Cook-Torrance GGX
  specular, correlated Smith visibility and Schlick Fresnel (Karis, SIGGRAPH 2013 Physically Based
  Shading course notes), geometric specular antialiasing of Tokuyoshi and Kaplanyan, _Improved
  Geometric Specular Antialiasing_ (2019). Transmissive meshes compose after the clusters over a
  frozen backdrop. A material it cannot preserve fails preparation with
  `CLUSTER_MATERIAL_UNSUPPORTED` (`details.reason` names the input); a physical extension beyond the
  transmission volume (clearcoat, sheen…) is drawn without, and `materialDegraded` says so once per
  surface and feature. `autonomousClusterDrawsTotal` counts its draws.

### Contract lights on the witnesses

`three-nu` and `three-lod` copy lights from the source graph, not the `SceneLight` store, so the
harness, an ordinary host, creates in Three the store's lights through the `sceneLighting` option of
`openMeasuredWorld` (`witnessPage.ts`, served under `/runner/`, imported by URL), all from the
measured world's `lights()` — cache and contract, no scene named. `exact-cluster-pages` translates
the store itself on each revision (`packages/sdk-browser/src/lighting/contractLights.ts`).

The mapping is exact in Three units — linear colour, unscaled radiometric intensity (W/sr for a
point or spot, irradiance for a directional), `distance` = range, `decay` = 2 (term for term the
engine shader's windowed inverse square), spot edge matched by penumbra; the surface model differs
(same irradiance, other BRDF). Each side's `witnessLights` records what it received, `null` if not
drawn by Three. The contract takes over once the host used it (one light declared, one view
requested), or when the source graph declares no light either: `auto` with no light anywhere is
the unlit view on WebGL2 as on WebGPU, never a black frame (#1016); the source graph's lights are
then off.

Witnesses cast **no shadows** (one map per light, six faces for a point light, is past any frame
budget) and `'bounce'` renders the lit view: run fidelity campaigns `--shadows off` on both sides.
`'unlit'` on `exact-cluster-pages` is lighting, not substituted materials: one white ambient of
irradiance π returns the albedo once `metalness`, `aoMapIntensity`, `lightMapIntensity` and
`transmission` are zeroed for each frame; own emission is still added. WebGL witnesses read back
their default framebuffer so captures match the display.

The camera path advances once per `requestAnimationFrame` on both sides: `rafIntervalMs` is the real
moving-frame envelope (backpressure and display cap included); `cpuFrameMs` stays the engine's
synchronous submission; the two are never added. `--profile on` attributes cost in the same moving
loop with diagnostics active.

## Outputs

In `--out` (gitignored, un-linted): `measure.json`, `resume.md`, and per view, threshold and side
`.png`, `.coupe.txt` and a metrics line — `rafIntervalMs`, `cpuFrameMs`, `cpuSelectMs` p50/p95,
`gpuFrameMs` p50 (WebGPU), selected and unrendered triangles, Hi-Z counters, selection hash, page
budget, system load — plus the A/A check (a side run twice) and before/after delta per channel. A
capture whose every pixel is RGB 0 is refused by file name (`black-capture` in `errors`, exit
code 1) and its deltas read "black capture", never 0 px: two black frames prove nothing (`references/imageDiff.ts`,
#1016). `null` = unmeasured, never inferred; every launched task exits cleanly.

### Triangle and Fallback Counters

All read on **one frame**, the measured loop's last (`series[].sides[].recordedFrame`), never
accumulated.

| Counter                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectedTriangles`                                        | the frame's cluster cut before frustum/occlusion rejection; `null` without a cut                                                                                                                                                                                                                                                                                          |
| `drawnTriangles`                                           | submitted: published cut, opaque and transparent, minus clusters with no resident page (`uncoveredTriangles`); on WebGL2 the nearest resident ancestors stand in. Counted **on the reported frame** at cut commit, no GPU readback — unlike `submittedTriangles`, never `null` for timing. Occlusion not subtracted (`hiZ.rejectedTriangles`). `null` outside this engine |
| `coverage` (`resume.md`)                                   | `selectedTriangles − drawnTriangles − uncoveredTriangles`: **zero expected**; non-zero = counters out of step across frames. On WebGL2 non-zero while ancestors stand in, zero once resident. Dash if one is missing                                                                                                                                                      |
| `submittedTriangles`                                       | GPU count of the opaque raster pass (occlusion rejects some after); `null` while a GPU cut's readback is pending                                                                                                                                                                                                                                                          |
| `totalSubmittedTriangles`                                  | same with transparent passes, `null` alike — under `--moving-camera` the readback never returns, so both are `null` where `drawnTriangles` has a value. Only this maps to `metrics.triangles` for legacy hosts                                                                                                                                                            |
| `frameHeld`                                                | the frame was **held** (scene unchanged, presentation re-encoded): zero clusters drawn and zero submitted is a record, not a missing reading. A fixed camera almost always holds; read it before `submittedTriangles`. `null` outside this engine                                                                                                                         |
| `uncoveredTriangles`                                       | cut triangles with no resident page and no covering ancestor — a hole; zero is the only valid value. `null` on engines drawing exactly what they select; WebGL2 counts it from its CPU cut (`docs/RESIDENCY.md`, coverage)                                                                                                                                                |
| `hiZ` (`hiz*Clusters`, `hiz*Triangles`, `hizCountedFrame`) | occlusion input, rejected, downsampled to a coarser mip; on the GPU path an **earlier** frame, index in `hiZ.image` (parentheses). `null` before the first count                                                                                                                                                                                                          |
| `gpuSelectionFallback`                                     | GPU cut selection fell back to the CPU cut; later metrics describe the fallback. `null` without GPU selection (e.g. WebGL witness); `yes` / `no` / `—`                                                                                                                                                                                                                    |

**Per-stage Cost** (`resume.md`; `series[].sides[].stageProfile`): per stage, CPU and GPU p50/p95
(never summed), shadow metrics (lights, re-rendered faces, draw calls), device timing method,
profiling overhead; "Unmeasured" is not zero.

**CPU bounds** (`series[].sides[].cpuBounds`, `explorer.cpuSteps()` read once after the loop, same
window as the profile): `frames` filed a row; `steps` gives p50/p95/max per named bound (`gateMs`,
`worldMs`, `selectionDispatchMs`, …), `null` if none filed it; `worst` the slowest rows. `null` on the CPU
reference cut, with `--profile off`, or on a dist older than #80.

**GPU Memory**: allocated, un-freed VRAM per side and view — textures and buffers registered by the
device wrapper, WebGPU having no VRAM query — in three categories (computed texture atlas, allocated
geometry pool, resolution-dependent render targets), the rest by difference, with top labelled
allocations (`series[].sides[].metrics.gpuAllocatedByLabel`). The nineteen virtual texture counters
sit under "Textures", "Image Feedback", "Broadcaster": the pool is fixed, "resident" is the view's
use.

The capture is taken on a **still pose**: after warmup the pose renders until held — accumulation
converged, no pending work — at most 64 frames (`poseCalme`, `measurePage.ts`), since
mid-accumulation captures carry non-deterministic streaming. `series[].sides[].settleFrames` gives
the count, `null` if the engine holds no frames (Three witness). Each series runs in a fresh page
closed right after: reused pages made `new THREE.WebGLRenderer` fail ("Error creating WebGL
context", Sept 14, 2026) while a large scene held hundreds of MBs.

## Assets

The harness serves `.mesure/assets/` (gitignored; `TRILLION3D_ASSETS` points elsewhere) under
`/benchmark-assets/`. A scene is `<scene>/` — source glTF and images as published, never written —
and `<scene>-derived/`, the compiled cache (`native/full/manifest.json`):

    pnpm run build && pnpm run build:native
    node bench/runner/assets/assets.ts                 # everything
    node bench/runner/assets/assets.ts --only sponza   # one scene, both steps
    node bench/runner/assets/assets.ts --list          # what each model is kept for

It fetches the twelve proof models from
[KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (one sparse,
blobless, depth-one clone) into `.mesure/assets/<kebab-name>/`, then compiles each scene without a
cache with the repository's compiler: scope `full`, budget 150 000 triangles, `qem-endpoints`.
**Both steps are idempotent**; delete a `<scene>-derived/` folder to rebuild. Workers are every core
`os.availableParallelism()` reports, the RAM admission budget half of `os.totalmem()` (the rest for
OS, browser and session), both printed per job; the compiler's 256 MiB default stops a large scene
on `RAM_ADMISSION_BUDGET_EXCEEDED`.

Reference scenes: `sponza` (262 267 triangles, 103 primitives, 69 images: the cut, the sun, its
shadows) and `normal-tangent-mirror-test` (mirrored texture coordinates). The other ten each prove
one thing — `alpha-blend-mode-test` the three alpha modes, `texture-coordinate-test` a layout read
off the image, `flight-helmet` many small primitives… Measurements published before 22 Sept. 2026
name two private scenes no longer on any machine, kept as read; nothing new runs on them.

Generated scenes:

    node bench/runner/scenes/facade.ts --seed 7 [--triangles 300000]
    node bench/runner/assets/assets.ts --only facade-7
    node bench/runner/scenes/aerial.ts --seed 410 [--props 3600] [--lamps 600]
    node bench/runner/assets/assets.ts --only aerial-410

- **facade**: a block of walls whose texture coordinates are laid out three ways (one island per
  wall, per window, mirrored halves) over a checkerboard naming each cell in digits, so a one-cell
  slide shows. The seed alone draws plan, storeys, pierced bays and the triangle count (a few
  hundred thousand by default). `tests/gpu/scene/public-scenes.gpu.ts` (run with the GPU proofs, `pnpm run test:gpu`) checks in a tenth
  of a second, without a GPU, that the DAG climbs above level 0 wherever there is more than one
  cluster and the mirrored mapping costs the simplification nothing.
- **aerial** (#410): an open world's pattern cooked in seconds — 4 × 4 km of rolling ground in 64
  tiles, props (trees, bushes, houses, rocks) written once and placed by thousands of nodes, about
  39 M instanced triangles on a 0.6 M source, street lamps as `KHR_lights_punctual` point lights;
  `overview` flies over it.

The resource base URL is where the harness serves sources for texture fetches. The cache fingerprint
is `key` in `manifest.json`, recorded in `measure.json`: comparisons need equal keys.

## Reference images

The image a rendering technique is held to (CONTRIBUTING.md, "Image and fidelity", class 2) is drawn
by the engine in its reference mode (`packages/sdk-browser/src/frame/referenceMode.ts`,
`openMeasuredWorld(canvas, { reference: true })`), never by a second renderer: render scale 1, no
temporal reuse (no TAA jitter or history), bounce traced at its per-frame ceiling and converged,
shadows at the level they ask (a page pool the budget shrank, or whose fill coarsened the maps,
refuses the capture), and the frame supersampled as TILES — 8 samples per output pixel and axis
within the portable 8192-texel side, box-filtered and assembled in linear light.

    pnpm run build && node bench/runner/references/reference.ts [--scene sponza,facade-7] [--references <dir>]

Each scene's views (`overview`, `ground`, `street`, `trajectory/poses.ts`) at 1728 × 1117 CSS, DPR 2, sun and
bounce on the WebGPU engine (`references/referenceStore.ts::REFERENCE_ARGS`; a later bench flag wins) go to
`.mesure/references/<scene>/<view>.png`, off git (AGENTS.md rule 10), recorded in git by
`bench/references/<scene>/reference.json`: the engine commit (the last to change `packages/`), the
command, a dirty tree or not, image settings, supersampling, approximations switched off, and per
view its pose, pixel SHA-256 and frames to hold. `bench.ts --reference` refuses an absent image or
other pixels: redraw at that commit. `--references <dir>` writes elsewhere (a second run to
compare). Build first: the dist drawn is the tree's own. The open world's aerial view joins once its
bench scene exists (#1274).

## Navigation image regression proof

Acceptance replays the whole versioned camera path without timings:

    node bench/runner/trajectory/trajectory.ts --scene sponza --cache .mesure/assets/sponza-derived \
      --before .worktrees/reference/dist --after dist --out .mesure/out/8-trajectory

Both builds must exist; `--before` is the chosen golden baseline, never replaced by the candidate.
Both sides share cache, poses, resolution, error threshold, memory budgets and texture compression;
`trajectory.json` records build hashes, asset identity, browser version, settings and path version
beside the PNGs. The output directory must be new and under `.mesure/out/`; publish, then remove it.

Default: all 600 poses, checkpoints every 60 and at the last; `--images` shortens a diagnosis,
`--checkpoint-every` samples closer (at most 32 checkpoints). One world stays open; each checkpoint
waits a 64-frame held-image barrier. Every render, convergence included, is checked for coverage and
streaming errors; no SDK flush (it can redraw and converge). Pixels are copied right after render in
the same browser frame, one surface path for arrival and settled images. The baseline runs twice:
only exact, non-black 0 px A/A images become goldens. The candidate records arrival and held images.
Missing captures, page/GPU errors, geometry holes, incomplete coverage, no drawn geometry, unsettled
images and unstable goldens fail; one changed pixel after convergence is a regression. A difference
gone after convergence is reported as `transient`, with arrival page counters and settling frames —
not blamed on streaming alone (accumulation can differ), and no certificate against popping between
checkpoints. No frame or GPU timing claim.

The default scene is Sponza (`DEFAULT_SCENE`); `--scene` and `--cache` pick another; a missing cache
fails, never substituted. Browser runs and goldens belong to acceptance; unit tests cover verdicts,
ordering, transient errors and checkpoint coverage without a browser.

## Measuring Another Scene

The harness is scene-agnostic: pose bounds come from the page model's bounds.

1. **Compile the glTF** ([Assets](#assets)) to `<name>-derived/` — under `.mesure/assets/`, where
   dropping a source folder is enough for `assets/assets.ts`, or elsewhere, gitignored.
2. **Name the cache for both sides**: `--cache-before <dir>`, `--cache-after <dir>`; the scene name
   comes from the `derived` directory, the reference scene's cache if omitted.
3. **Mount resources**: `--resources <dir>`, else 404 textures. Caches with an absolute
   `resourceBaseUrl` fetch from it; logged errors give per-page resolution.

Pools match the engine's byte budgets: `--geometry-pool <MiB>` (pages) and `--texture-pool <MiB>`
(tiles), 512 MiB each by default. Extremes test degradation, logged as `geometryPool.bound`,
`geometryPool.saturated`, `coverageBudgetLimited`, `textureTilesRefused`. `--max-pages` is a PAGE
cap for test scenes. All are recorded; comparisons need equal pools.

IN-SESSION changes (an app slider via `explorer.setMemoryBudgets`): `--geometry-pool-live <MiB>`,
`--texture-pool-live <MiB>` resize after warmup and log the response (`series[].sides[].liveTuning`:
retained pools, evicted items, resize time, prior residency) and frames to recover the held pose
(`recoveryFrames`, `null` if the pool is smaller than the view); `--warmup 60` fills pools first.
`--texture-pool-live <n>%` derives the budget from the scene (`poolFill.ts`): twice n % of the
texture bytes the settled pose holds — a lower bound per atlas, since the engine gives each of its
two atlases half (`texturePoolFor`) and publishes one residency. The `Texture pool set live` line
prints bytes asked, held (and clamp), tiles evicted and ms; `Streamer` gives evictions and texture
pass times of the moving series. The engine draws whole layers, at least one (900 tiles) per lane,
raising a smaller budget to that floor (`minimum`); a lane evicts only when the path asks more tiles
than its layers hold. Sides with different residencies derive different budgets: compare at the
absolute MiB the summary printed (`--texture-pool-live <MiB>`). `--geometry-pool-ceiling <MiB>` sets
the ceiling an in-session growth may reach.

## What a Cache's Pages Cost in Precision

    node bench/runner/pageQuantization.ts <cache>/native/full

The autonomous WebGL2 path draws decoded pages — positions on the primitive's quantization grid,
normals as octahedral bytes ([`docs/FORMAT.md`](../../docs/FORMAT.md)) — where the others read
`source.bin` floats. This compares them corner by corner: largest and mean position gap, normal
angle. On `tests/fixtures/scenes/kinetic-garden` (430 pages, 107 520 corners): `maxPositionGap` 6.10
× 10⁻⁵, `maxNormalGapDegrees` 0.613, mean 0.284°.

## The Screen Error of What Is Drawn

    pnpm run build
    TRILLION3D_ASSETS=<assets> node bench/runner/screenError/screenError.ts --scene sponza --poses bench \
      [--backends webgpu,webgl2] [--pixel-errors 0,1] [--out .mesure/out/<issue>]

The audit's oracle (#959): the screen error of what WebGPU and WebGL2 draw against the source glTF —
forward, drawn-triangle samples to the source surface; reverse, source samples to the drawn
triangles — counting only in-frustum points no drawn surface hides. A single-sided triangle seen
from behind is skipped on both sides (by material side: the source glTF for WebGPU's clusters, the
engine's `sideOf` for WebGL2's meshes). Distances become pixels through the cut's projection
(`screenErrorBound`) under the engine's camera, at 1728×1117, DPR 2; nearest-surface and visibility
queries use the engine's triangle tree. A row passes when the cut held, no browser error, both
directions sampled and both finite maxima ≤ `pixelError + 0.1 px`; a failed or empty run exits
nonzero. Sampled distances, not a continuous maximum or raster comparison. WebGPU returns its cut's
clusters (`selectedClusterIds`, decoded by the engine's page decoder, which the WGSL decode matches
bit for bit), WebGL2 its drawn triangles. `--poses orbit` and `--poses terrain` are the audit's
cameras on the source box, `--poses bench` the four named views. Recette only, on `develop` after
merge, with scenes recooked by that checkout so grid and DAG errors match the runtime. The
compiler-side measure of quantization alone:
`packages/asset-compiler-rust/src/geometry_page_quant/screen/` (#930).

## What Anisotropy Costs

    node bench/runner/anisotropyCost.ts [--anisotropy 1,16] [--images 240] [--width 1920] [--height 1080]

A floor with detail at every texel at a grazing angle, drawn by the WebGPU engine's sources on Dawn,
under the bench lock, per anisotropy; prints p50 GPU time per image (`gpuFrameMs`) and the sum of
timed passes where timestamp queries exist. The camera slides a hair each image, so none is held.

## Light Iterations per Covered Pixel

    node bench/runner/lighting/lightTileIterations.ts [--width 1920] [--height 1080] [--views survey150,roof30]

The R&D audit's synthetic open city (`lighting/lightTileCity.ts`: 1,480 buildings, 11,140 lights and the
sun), ray-cast into reverse-Z depth from five views; each pixel walks the list of its cell of the
light grid, built by the grid pass's oracle (`bench/oracles/browser/gpuLightGridOracle.ts`, #1369):
lights listed, lights reaching a covered pixel (the floor). Counts are per **covered** pixel (sky
walks none; coverage printed). `missed` = lights reaching a pixel yet dropped: 0 when lists stay
image-exact. Untimed: the second table is the audit's cost model (20 lane instructions per light,
half peak rate) times each GPU class's pixels and coverage — a model, never a frame time.

## Published reports

Measurement, export and site build are separate; rebuilding the portal never launches Chrome.

1. Build the engine, run `node bench/runner/campaign.ts --out .mesure/out/<campaign>` (default
   `.mesure/out/global`). Resume needs the same arguments, repository state, built JavaScript, asset
   manifest, browser version and machine, and an error-free measurement; a mismatch refuses to
   overwrite evidence — pick another directory. A browser change invalidates resume and comparisons.
2. Export:
   `node bench/runner/summary/summaryGlobal.ts --from .mesure/out/<campaign> --to .mesure/out/<campaign>-report --id <campaign>`
   (defaults: `--from .mesure/out/global`, `--to <from>/report-data`, `--id current`).
3. Stage: `node bench/runner/publishReport.ts --from .mesure/out/<campaign>-report` writes
   `site/reports/<id>/`, removes the campaign staged before and writes a catalogue naming the new
   one (the portal's Measurements area); an ID already staged is refused. No deploy, no push.
4. Validate, preview with `pnpm docs:serve` (builds the bundles first); publishing follows the
   normal issue/PR and release workflow.

`formatVersion: 1` holds runs and readings, original PNGs and public source JSON (no filesystem
paths or commands). Machine and browser records come from measurement time; unknowns stay null;
private `measure.json` files are never overwritten; captures stay inside the measurement directory;
export into a new directory.

The portal shows seven categories in the sidebar: named-engine charts, each image pair as a slider,
every scene/run comparison, full source tables with repeated captures; no global filters; raw source
and protocol tables in closed disclosures. The hash names campaign and tab; the latest opens by
default. Null stays distinct from zero; timing methods stay apart and no GPU pass sum is shown as a
frame. Observed arithmetic appears when both readings exist, warned as not a controlled claim;
percentages need matching conditions; no significance or speedup verdict (no repeated-run
uncertainty in the inputs). Tables and downloads keep diagnostics for lighting, shadow pages,
bounce, residency, streaming, resolution, CPU stages, GPU passes and fidelity; hardware publication
references stay outside controlled comparisons; captures lazy-load with pixels unchanged, missing
ones stay unavailable; fidelity is never inferred from appearance.

## Performance Benchmarks

Under `bench/perf/<package>/`, run by `pnpm run perf:all`; operation, oracles and baselines in
[`docs/TESTS.md`](../../docs/TESTS.md).

## Deformation batch (#357)

Fixtures: CesiumMan and AnimatedMorphCube under `site/assets/examples/`; compile their registered
caches first. `a-character-that-walks.html`, `a-shape-that-morphs.html`,
`a-crowd-of-characters.html?count=1` (then 10, 100) and `additive-poses.html` expose
`deformationCase.world` and `setTime(seconds)`: freeze at 0, 0.25, 0.5 and 1 second.
`deformationWitness.ts` loads the same public glTF and evaluates its first clip at those times in
the witness; with the same camera, lights, viewport, tone mapping and shadows,
`captureDeformationWitness` posts pixels through the capture transport (crowds on the example's
two-unit grid). Compare with `imageDiff`, never against a rest pose or black capture.

Crowd envelope: with playback on, `deformationEnvelope(deformationCase.world)` per count keeps 120
frames after 30 warmup — CPU frame time, GPU deformation time, geometry allocation, VRAM bytes; no
GPU timestamps = null. Record browser, device, backend, budgets, viewport, frame distribution and
image differences; nothing about performance or pixel parity is inferred from these helpers. Run
both backends. The `deformation/deformation-kernel` GPU proof compares skin/morph/current/previous/
soft/wave and whole-copy outputs with shared fixtures, the wave through the physics wave sampler
within one centimetre. Recette runs these after the merge on `develop`.

## Feedback target A/B/A (#39)

A one-off diagnostic, run on the quiet measurement machine after building:

    pnpm run build && pnpm run build:native
    node bench/runner/feedback/feedbackTargetAb.ts --scene sponza,alpha-blend-mode-test \
      --rebuild-cache alpha-blend-mode-test --images 120

`--rebuild-cache` refreshes named derived caches through the owned compiler. Each scene and view is
one session at a fixed pose, 2496×1404 DPR 1, TAA on. Up to 240 budgeted frames, no convergence
barrier, sample requested/served mips from the r32uint feedback in centre and periphery patches,
whole and per surface kind (opaque, mask, blend). Gaze-first holds when the centre is at level while
the periphery lags, then the periphery reaches level, for the frame and each kind both regions
request in the held frame. The A/B/A verdict needs 12 GPU samples per leg, 0px A/A and A/B,
identical geometry and tile residency, and the expected target-byte delta. JSON and captures go to
`.mesure/out/39-feedback-ab/`; missing values are `null`. The reduce pass is timed steady (A legs)
and converging (frames before the held one). Pass/frame shares are costs, not savings; the off-side
delta bounds any request-packing gain.

# Benchmarks and measurement

Two benches, one per question:

- **Frame time: the GPU bench on Dawn** (`bench/dawn/`). The engine draws a site page in Node on
  this machine's GPU through Dawn, the WebGPU implementation Chrome runs, with no browser, playing a
  scenario identical frame for frame. It is the timing bench.
- **Images and witnesses: the Chrome harness** (`bench/runner/`, this folder). Playwright drives
  the system Chrome: the WebGL2 backend, the engine against the witness libraries, image proofs,
  the screen error of what is drawn, and the published reports.

How the acceptance session uses them, batch by batch:
[the recette skill](../../skills/t3d-recette/SKILL.md). The measurement rules (same input and
budgets, `null` for the unmeasured, CPU and GPU never added):
[CONTRIBUTING.md](../../CONTRIBUTING.md#measure-before-optimising). The CPU benchmarks of
`bench/perf/` (`pnpm run perf:all`):
[docs/TESTS.md](../../docs/TESTS.md#performance-benchmarks).

## The GPU bench on Dawn

    node bench/dawn/run.ts <page> [--scenario orbit|drive|still|world|<file.json>] [--repeat 3]
    node bench/dawn/suite.ts [<page[:scenario]>,…]        # at most 5 scenes, never more
    node bench/dawn/run.ts <page> --dissect <pass label> [--dissect-segment <name>]
    node bench/dawn/run.ts <page> --ab <checkout A> <checkout B> [--rounds 6] [--least 0.05]
    pnpm run test:gpu                  # the GPU proofs on Dawn (bench/dawn/proofs.ts)
    pnpm run test:chrome               # the proofs Dawn cannot run, in Chrome

`<page>` is an example's name (`drive-a-car`), a path, or a held-out validation page's prefix
(`v06`) with `TRILLION3D_VALIDATION_DIR` set. Each run plays `--repeat` fresh processes; `--engine
<checkout>` measures another clean checkout. **One scene carries the whole bench**: the example
`an-open-world-of-every-cost`, played by the scenario `world` — an open world of blocks, a dense
pebble bed under a low sun, transparents, lamps, TAA — every part a switch in the gallery, so it is
seen and checked before it is measured. `suite.ts` runs that scene by default and a list of at most
five (`MAX_SCENES`, `bench/dawn/suiteRuns.ts`): a longer list is refused, no option lifts it.
Method: one scene first, then the five, never a full sweep; stop at the first bad scene.
`--profile desktop|mobile` sets what the device grants (display, limits, features,
`bench/dawn/profiles.ts`), never the GPU's speed.

One bench at a time on the machine: `~/.trillion3d/gpu-bench.lock` refuses a second, the proofs
included. The report, Markdown and JSON, one file of each per run, lands in `.mesure/out/bench-gpu/`.
It opens on **the five biggest gains**: the ms, the pass, its `file:line` and function, the cause the
numbers prove (`wait`, `bandwidth`, `launch`, `occupancy`, `wasted work`, else `unproven`). Then,
per segment:

- the frame's GPU time on every frame: median, p95, min, max, the middle half and the deviation;
- each pass's **work apart from its wait**: its begin and end timestamps, the idle before it, its
  span; and **a doubt named** when a timer is lost (work encoded, no timestamp), a pass reads zero
  with work, the passes do not add up to the frame, or the engine's own timer disagrees. A pass that
  encoded nothing is a true zero (`empty`), never a lost timer: the driver writes no timestamp for it;
- the ranking: each pass by its work, with what it encoded (workgroups, threads, vertices, bound and
  stored MiB, read from the calls the engine makes), its **floor** (its stores at the attachment
  rate, its threads at the launch rate, its fixed cost; and the ceiling were every bound byte
  moved), its gain (at most, and at least) and its source;
- the machine's limits, measured once per adapter and kept in `~/.trillion3d/machine/` beside the bench lock, shared
  by every checkout (`--recalibrate` measures again, in the first play only; a machine measured
  while the GPU is busy with others serves its run and is not kept): read, write, texture and attachment GB/s, threads a ms, the cost of a pass, a
  dispatch and a barrier;
- the CPU by step and function, the engine's counters, the hitches and the images. The bench's
  own probes (the encoding read, the timers) cost the main thread about a millisecond a frame on
  the bench scene (25.4 ms against 23.8–25.1 before them): read the main-thread figure as an
  upper bound, the GPU's as exact.

`--dissect <pass>` takes a pass's shader apart by itself: a shader holds `// @cut <name> keep:
<statement>` lines (`bench/dawn/shaderCuts.ts`); the bench makes one variant per cut, in memory,
stopped there, plays each on the frame, and tells the cost of each step between two plays of the
shader whole (their drift is the noise floor). `--ab` plays two checkouts' engines on the bench's
own page, alternating A B / B A for the rounds, and gives the mean difference with its 95 %
interval and a verdict — gain, loss, or noise. The proofs, their discovery rule and what is
excluded: [docs/TESTS.md](../../docs/TESTS.md#gpu-proofs-on-dawn).

## The Chrome harness

One command, no server to start by hand: Playwright and esbuild are development dependencies,
Chrome is the system browser, assets live under `.mesure/assets/` ([Assets](#assets)).

    node bench/runner/bench.ts --engine webgpu --before <git-ref|dist> --after <git-ref|dist> \
         --views overview,ground,street --images 60 --pixelError 0,1
    node bench/runner/campaign.ts [--out .mesure/out/global] [--scene a,b] [--only name,…] [--list]

A flag a command never reads (misspelt, or naming a side the run does not measure) stops it with
`unknown flag: --<name>` before any build or browser. `campaign.ts` runs every isolating line on
each reference scene into `<out>/<scene>/<name>/` and skips a run that already holds a
`measure.json`.

### Flags

`<side>` is `before` or `after`. Chromium flags come from the engine (`harness/sideOptions.ts`);
with two engines they are the union of both sides' needs.

| Flag                                                                   | Default                                 | Effect                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--engine`                                                             | `webgl`                                 | `webgpu` (webgpu-page-raster, the engine), `webgl2` (autonomous-pages-webgl¹), or a witness: `webgl` (exact-cluster-pages), `three-nu`, `three-lod` ([The witnesses](#the-witnesses))            |
| `--engine-<side>`                                                      | `--engine`                              | per-side engine: the engine against a witness in one run, same poses, lights, caches and server                                                                                                  |
| `--before` / `--after`                                                 | none / `dist/`                          | a built `dist/` or a git ref; without `--before` one side is measured                                                                                                                            |
| `--scene <name>`                                                       | from the cache, else `sponza`           | any compiled folder of `.mesure/assets/`; sets each side's cache. `fluids`: no cache, an ocean, 100 floating bodies, 20 fires, 5 smoke volumes built through the public API (`fluids/fluids.ts`) |
| `--cache-<side>`                                                       | the scene's cache                       | a compiled cache (`native/full`), to compare two compilers on one scene                                                                                                                          |
| `--resources <dir>`                                                    | none                                    | glTF resources mounted under `/assets/`; without it, un-based caches yield 404 textures                                                                                                          |
| `--views`                                                              | `overview,ground,street`                | among `overview`, `ground`, `street`, `detail` (`trajectory/poses.ts`)²                                                                                                                          |
| `--images` / `--warmup`                                                | 60 / 8                                  | measured and warmup frames                                                                                                                                                                       |
| `--pixelError`                                                         | `0`                                     | a list of screen-error thresholds                                                                                                                                                                |
| `--width` / `--height` / `--dpr`                                       | 1280 / 720 / 1                          | CSS viewport; `--dpr 2` renders twice the pixels per axis                                                                                                                                        |
| `--out` / `--port`                                                     | `.mesure/out/<engine>-<timestamp>/` / 0 | output directory, server port                                                                                                                                                                    |
| `--bounce on\|off`                                                     | `off`                                   | bounce lighting                                                                                                                                                                                  |
| `--textures cache\|host`                                               | `host`                                  | `cache` skips every source image whose chain the cache carries; `host` decodes them all, as the Three witnesses need. The engine reads the baked levels either way                               |
| `--texture-budget <ms>`                                                | engine's 1.0 ms                         | CPU ms a frame may copy texture tiles; read on a cold traversal (`--warmup 0 --moving-camera --textures cache`)                                                                                  |
| `--compression[-<side>] auto\|bc7\|astc\|none`                         | `auto`                                  | block family of the WebGPU texture pools under `--textures cache`³                                                                                                                               |
| `--antialiasing on\|off`                                               | `on`                                    | TAA jitter and accumulation                                                                                                                                                                      |
| `--scale[-<side>] <s>`                                                 | display                                 | WebGPU frame drawn at `s` per axis, reconstructed by the temporal resolve; below 1 needs `webgpu` and TAA                                                                                        |
| `--reference`                                                          | off                                     | class-2 image proof against the [reference image](#reference-images)⁴                                                                                                                            |
| `--profile on\|off` / `--profile-frames`                               | `on` / 120                              | per-stage timing over the trailing measured frames; `off` for the beauty verdict                                                                                                                 |
| `--lights N`                                                           | 0                                       | contract point lights (`lighting/lamps.ts`); without `--lights` or `--sun` the engine renders unlit albedo                                                                                       |
| `--shadows on\|off` / `--moving-light` / `--intensity N` / `--range F` | `on` / off / 40 / 0.75                  | shadow casting; the first light circles; light intensity; each light's range in grid cells                                                                                                       |
| `--sun`                                                                | off                                     | directional sun with its virtual shadow maps                                                                                                                                                     |
| `--file-lights on\|off`                                                | `on`                                    | the source file's own lights                                                                                                                                                                     |
| `--moving-node <node>` / `--moving-node-radius`                        | none / 1                                | a named node circles each frame                                                                                                                                                                  |
| `--moving-camera`                                                      | off                                     | the pose advances one trajectory step per measured frame⁵                                                                                                                                        |
| `--instances N`                                                        | 1                                       | 1, 4, 9 or 12 grid copies; "geometry (MB)" = page cache plus vertex buffers                                                                                                                      |
| `--math-path auto\|js\|wasm`                                           | `auto`                                  | batch maths path; `auto` lets the governor measure. "Batch Math Path" table per side and operation                                                                                               |
| `--isolation on\|off`                                                  | `off`                                   | COOP/COEP on the harness server: a cross-origin isolated page                                                                                                                                    |
| `--variant[-<side>]`, `--error-metric[-<side>]`                        | none                                    | a diagnostic variant; the screen-error metric (`certifiee` or `reference`)                                                                                                                       |
| `--gaze-network`                                                       | off                                     | counts the bytes Chrome transferred instead of timing ([gaze/GAZE_NETWORK.md](gaze/GAZE_NETWORK.md))                                                                                             |
| `--visible`                                                            | off                                     | a real window; headless caps display at 60 Hz on macOS                                                                                                                                           |
| `--geometry-pool` / `--texture-pool <MiB>`                             | 512 MiB each                            | [Measuring another scene](#measuring-another-scene)                                                                                                                                              |

1. The autonomous engine decodes geometry pages itself, hence the only one incrementing
   `pagesDecodedWasm`; it needs a cache of exact clusters, else the explorer rejects the run with
   `AUTONOMOUS_SCENE_UNAVAILABLE`.
2. Eye-level views walk the model's street, read off its cooked `physics.json` column by column
   (ground, nearest wall at eye height, open sky): the roomiest open-sky column is the street
   (`street/street.ts`). Without `physics.json` or a street, `bounds.noStreet` is reported and the
   walk takes the box centre (`boxStreet`). Other views fly one eye above the top.
3. `auto` takes the first family the device samples (BC before ASTC 4×4) that the cache holds;
   `none` keeps RGBA8 (a lossless "before"); `bc7`/`astc` fall back to RGBA8 by name without device
   support. `--compression-before none --compression-after bc7` on one `dist/` measures the family
   alone; the summary names the family held (`texturePoolFormat`).
4. `references/imageDiff.ts::referenceDiff`: mean and 99.9th-percentile channel error and mean
   LDR-FLIP, under `series[].referenceDiff` and in `resume.md`. The run stops by name on a missing
   reference, another pose or image setting, a moving camera or light, a reference drawn from
   uncommitted changes, or an image other than its `reference.json` names.
5. Separates a still scene from a moving camera and is the only way to see selection cost: on a
   fixed pose what is retained is free. The cut hash may differ between sides with no image change
   (asynchronous readback, one frame late).

Every run first probes browser limits (`harness/limits.ts`): WebGL2 half-float and float targets,
`EXT_disjoint_timer_query_webgl2`, WebGPU `timestamp-query` and the adapter's limits past the
defaults (`limits` in `measure.json`). Shadow pages report `pagesPending`, `maxWaitMs` and
`occludersKept` in the profile; how the maps are drawn is [docs/SHADOWS.md](../../docs/SHADOWS.md).

## The witnesses

A witness is a comparison backend pitted against the engine on one side
(`--engine-before three-nu|three-lod|webgl`). The SDK never mounts one: they come from the witness
entry point (`bench/witnesses/measurement.ts`, bundled by `pnpm run build` into
`dist/witnesses/measurement.js`, left out of the package) as `referenceBackend`, `threeLodBackend`
and `exactPagesBackend`, opt-in through the session's `backends` option.

- `three-nu`: Three.js alone, every mesh every frame (`witness/threeBarePage.ts`).
- `three-lod`: Three.js with a three-level `THREE.LOD` per mesh simplified by meshoptimizer at load
  (`witness/threeLodPage.ts`).
- `webgl` (`exact-cluster-pages`): the cache's clusters over Three.js scene data through an
  engine-owned WebGL2 program — glTF metallic-roughness, Lambert diffuse with GGX specular,
  correlated Smith visibility, Schlick Fresnel, geometric specular antialiasing. Transmissive meshes
  compose after the clusters over a frozen backdrop. A material it cannot preserve fails preparation
  with `CLUSTER_MATERIAL_UNSUPPORTED`; a physical extension beyond transmission volume (clearcoat,
  sheen…) is drawn without, and `materialDegraded` says so once per surface and feature.

**Lights.** `three-nu` and `three-lod` copy lights from the source graph, so the harness creates in
Three the store's lights through the `sceneLighting` option of `openMeasuredWorld`
(`witness/witnessPage.ts`), from the measured world's `lights()`. `exact-cluster-pages` translates
the store itself (`packages/sdk-browser/src/lighting/contractLights.ts`). The mapping is exact in
Three units — linear colour, radiometric intensity, `distance` = range, `decay` = 2, spot edge
matched by penumbra; the surface model differs. Each side's `witnessLights` records what it
received. With no light anywhere, the witnesses draw the unlit view, never a black frame.

Witnesses cast **no shadows** and `bounce` renders the lit view: run fidelity campaigns
`--shadows off` on both sides. `unlit` on `exact-cluster-pages` is one white ambient of irradiance π
over zeroed `metalness`, `aoMapIntensity`, `lightMapIntensity` and `transmission`; own emission is
still added. The camera path advances once per `requestAnimationFrame` on both sides:
`rafIntervalMs` is the moving-frame envelope, `cpuFrameMs` the engine's synchronous submission; the
two are never added.

## Outputs

In `--out` (gitignored): `measure.json`, `resume.md`, and per view, threshold and side `.png`,
`.coupe.txt` and a metrics line — `rafIntervalMs`, `cpuFrameMs`, `cpuSelectMs` p50/p95, `gpuFrameMs`
p50 (WebGPU), selected and unrendered triangles, Hi-Z counters, selection hash, page budget, system
load — plus the A/A check (a side run twice) and the before/after delta per channel. A capture whose
every pixel is RGB 0 is refused by name (`black-capture`, exit code 1): its deltas read "black
capture", never 0 px. `null` means unmeasured, never inferred.

### Triangle and fallback counters

All read on **one frame**, the measured loop's last (`series[].sides[].recordedFrame`).

| Counter                   | Meaning                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectedTriangles`       | the frame's cluster cut before frustum and occlusion rejection; `null` without a cut                                                                                                                 |
| `drawnTriangles`          | the published cut, opaque and transparent, minus clusters with no resident page; on WebGL2 the nearest resident ancestors stand in. Counted at cut commit, no GPU readback; occlusion not subtracted |
| `coverage` (`resume.md`)  | `selectedTriangles − drawnTriangles − uncoveredTriangles`: zero expected; on WebGL2 non-zero while ancestors stand in                                                                                |
| `submittedTriangles`      | GPU count of the opaque raster pass; `null` while a GPU cut's readback is pending                                                                                                                    |
| `totalSubmittedTriangles` | the same with transparent passes; `null` under `--moving-camera`, where the readback never returns                                                                                                   |
| `frameHeld`               | the frame was held (scene unchanged): zero clusters drawn is a record, not a missing reading                                                                                                         |
| `uncoveredTriangles`      | cut triangles with no resident page and no covering ancestor, a hole: zero is the only valid value                                                                                                   |
| `hiZ`                     | occlusion input, rejected, downsampled; on the GPU path an earlier frame, `null` before the first count                                                                                              |
| `gpuSelectionFallback`    | GPU cut selection fell back to the CPU cut; `null` without GPU selection                                                                                                                             |

**Per-stage cost** (`series[].sides[].stageProfile`): per stage CPU and GPU p50/p95 (never summed),
shadow metrics, device timing method, profiling overhead. **CPU bounds**
(`series[].sides[].cpuBounds`, `explorer.cpuSteps()` over the profile's window): p50/p95/max per
named bound (`gateMs`, `worldMs`, `selectionDispatchMs`, …) and the slowest rows. **GPU memory**:
allocated VRAM per side and view as registered by the device wrapper, in three categories (texture
atlas, geometry pool, render targets) and the top labelled allocations
(`metrics.gpuAllocatedByLabel`).

The capture is taken on a **still pose**: after warmup the pose renders until held, at most 64
frames (`calmPose`, `harness/measurePage.ts`; `settleFrames` gives the count). Each series runs in a
fresh page closed right after.

## Assets

The harness serves `.mesure/assets/` (gitignored; `TRILLION3D_ASSETS` points elsewhere) under
`/benchmark-assets/`. A scene is `<scene>/`, source glTF and images as published, never written,
and `<scene>-derived/`, the compiled cache (`native/full/manifest.json`):

    pnpm run build && pnpm run build:native
    node bench/runner/assets/assets.ts                 # everything
    node bench/runner/assets/assets.ts --only sponza   # one scene, both steps
    node bench/runner/assets/assets.ts --list          # what each model is kept for

It fetches the fourteen models of `assets/assetsCatalogue.ts` from
[KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (one sparse,
blobless, depth-one clone) into `.mesure/assets/<kebab-name>/`, then compiles each scene with the
repository's compiler: scope `full`, budget 150 000 triangles, `qem-endpoints`. Both steps are
idempotent; delete a `<scene>-derived/` folder to rebuild. Workers are every core
`os.availableParallelism()` reports and the RAM admission budget half of `os.totalmem()`. The
reference scenes are `sponza` (the cut, the sun, its shadows) and `normal-tangent-mirror-test`
(mirrored texture coordinates); each other model proves one thing (`--list`).

Generated scenes:

    node bench/runner/scenes/facade.ts --seed 7 [--triangles 300000]
    node bench/runner/assets/assets.ts --only facade-7
    node bench/runner/scenes/aerial.ts --seed 410 [--props 3600] [--lamps 600]
    node bench/runner/assets/assets.ts --only aerial-410

- **facade**: a block of walls whose texture coordinates are laid out three ways (one island per
  wall, per window, mirrored halves) over a checkerboard naming each cell in digits, so a one-cell
  slide shows. The seed draws plan, storeys, pierced bays and the triangle count.
- **aerial**: an open world's pattern cooked in seconds: rolling ground in tiles, props written once
  and placed by thousands of nodes, tens of millions of instanced triangles on a source of a few
  hundred thousand, street lamps as `KHR_lights_punctual` point lights.

The cache fingerprint is `key` in `manifest.json`, recorded in `measure.json`: comparisons need
equal keys.

## Reference images

The image a rendering technique is held to
([CONTRIBUTING.md](../../CONTRIBUTING.md#image-and-fidelity), class 2) is drawn by the engine in
its reference mode (`packages/sdk-browser/src/frame/referenceMode.ts`,
`openMeasuredWorld(canvas, { reference: true })`), never by a second renderer: render scale 1, no temporal reuse, bounce traced at its per-frame
ceiling and converged, shadows at the level they ask (a shrunk or coarsened page pool refuses the
capture), and the frame supersampled in tiles, 8 samples per output pixel and axis, box-filtered in
linear light.

    pnpm run build && node bench/runner/references/reference.ts [--scene sponza,facade-7] [--references <dir>]

Each scene's views at 1728 × 1117 CSS, DPR 2, sun and bounce on the WebGPU engine
(`references/referenceStore.ts::REFERENCE_ARGS`; a later bench flag wins) go to
`.mesure/references/<scene>/<view>.png`, off git, recorded in git by
`bench/references/<scene>/reference.json`: the engine commit, the command, a dirty tree or not,
image settings, supersampling, approximations switched off, and per view its pose, pixel SHA-256 and
frames to hold. `bench.ts --reference` refuses an absent image or other pixels: redraw at that
commit. `--references <dir>` writes elsewhere.

## Navigation image regression proof

    node bench/runner/trajectory/trajectory.ts --scene sponza --cache .mesure/assets/sponza-derived \
      --before <baseline>/dist --after dist --out .mesure/out/<name>

Replays the whole versioned camera path without timings. `--before` is the golden baseline, never
replaced by the candidate; both sides share cache, poses, resolution, error threshold, budgets and
compression; `trajectory.json` records build hashes, asset identity, browser version, settings and
path version beside the PNGs. The output directory must be new and under `.mesure/out/`.

Default: every pose, checkpoints every 60 (`--checkpoint-every`, at most 32 checkpoints) and at the
last; `--images` shortens a diagnosis. Each checkpoint waits a 64-frame held-image barrier; every
render is checked for coverage and streaming errors. The baseline runs twice: only exact, non-black
0 px A/A images become goldens. Missing captures, page or GPU errors, holes, no drawn geometry,
unsettled images and unstable goldens fail; one changed pixel after convergence is a regression. A
difference gone after convergence is reported `transient`, with arrival page counters and settling
frames. `--scene` and `--cache` pick another scene than Sponza; a missing cache fails.

## Measuring another scene

The harness is scene-agnostic: pose bounds come from the page model's bounds.

1. **Compile the glTF** ([Assets](#assets)) to `<name>-derived/`, under `.mesure/assets/` or
   elsewhere, gitignored.
2. **Name the cache for both sides**: `--cache-before <dir>`, `--cache-after <dir>`.
3. **Mount resources**: `--resources <dir>`, else 404 textures; caches with an absolute
   `resourceBaseUrl` fetch from it.

`--geometry-pool <MiB>` (pages) and `--texture-pool <MiB>` (tiles), 512 MiB each by default, match
the engine's byte budgets; extremes are logged as `geometryPool.bound`, `geometryPool.saturated`,
`coverageBudgetLimited`, `textureTilesRefused`. `--max-pages` is a page cap for test scenes. All are
recorded; comparisons need equal pools.

In-session changes, as an application slider (`explorer.setMemoryBudgets`):
`--geometry-pool-live <MiB>` and `--texture-pool-live <MiB>` resize after warmup and log the
response (`series[].sides[].liveTuning`) and the frames to recover the held pose
(`recoveryFrames`); `--warmup 60` fills pools first. `--texture-pool-live <n>%` derives the budget
from the scene (`harness/poolFill.ts`): twice n % of the texture bytes the settled pose holds; the
engine raises a smaller budget to one layer per lane. Compare sides at the absolute MiB the summary
printed. `--geometry-pool-ceiling <MiB>` caps an in-session growth.

## Single measures

    node bench/runner/counts/pageQuantization.ts <cache>/native/full

The positions and normals of decoded pages ([docs/FORMAT.md](../../docs/FORMAT.md)) against the
`source.bin` floats, corner by corner: largest and mean position gap, normal angle.

    TRILLION3D_ASSETS=<assets> node bench/runner/screenError/screenError.ts --scene sponza \
      --poses bench|orbit|terrain [--backends webgpu,webgl2] [--pixel-errors 0,1] [--out <dir>]

The screen error of what WebGPU and WebGL2 draw against the source glTF, both directions, counting
only in-frustum points no drawn surface hides, at 1728×1117, DPR 2, through the engine's triangle
tree. A row passes when the cut held, no browser error, both directions sampled and both maxima
≤ `pixelError + 0.1 px`; a failed or empty run exits nonzero. Run it with scenes cooked by the same
checkout. The compiler-side measure of quantization alone:
`packages/asset-compiler-rust/src/geometry_page_quant/screen/`.

    node bench/runner/counts/anisotropyCost.ts [--anisotropy 1,16] [--images 240] [--width 1920] [--height 1080]

A floor with detail at every texel at a grazing angle, drawn on Dawn under the bench lock per
anisotropy; prints the p50 GPU time per image.

    node bench/runner/lighting/lightTileIterations.ts [--width 1920] [--height 1080] [--views <names>]

A synthetic open city (`lighting/lightTileCity.ts`) ray-cast from five views; each covered pixel
walks its light-grid cell's list, built by the grid oracle
(`bench/oracles/browser/gpuLightGridOracle.ts`): lights listed, lights reaching the pixel, and
`missed` (0 when lists stay image-exact). Untimed: its cost table is a model, never a frame time.

    node bench/runner/feedback/feedbackTargetAb.ts --scene sponza,alpha-blend-mode-test \
      --rebuild-cache alpha-blend-mode-test --images 120

A texture-feedback target A/B/A at a fixed pose, 2496×1404 DPR 1, TAA on: requested and served mips
in centre and periphery patches, whole and per surface kind. The verdict needs 12 GPU samples per
leg, 0 px A/A and A/B, identical geometry and tile residency and the expected target-byte delta.
Output under `.mesure/out/39-feedback-ab/` unless `--out`.

**Deformation.** `a-character-that-walks`, `a-shape-that-morphs`, `a-crowd-of-characters`
(`?count=1`, 10, 100) and `additive-poses` expose `deformationCase.world` and `setTime(seconds)`.
`witness/deformationWitness.ts` evaluates the same public glTF's first clip in the witness;
`captureDeformationWitness` posts its pixels through the capture transport for `imageDiff`.
`witness/deformationEnvelope.ts` keeps 120 frames after 30 warmup per crowd count: CPU frame time,
GPU deformation time, geometry allocation, VRAM bytes; no GPU timestamps means `null`.

## Published reports

Measurement, export and site build are separate; rebuilding the portal never launches Chrome.

1. Run `node bench/runner/campaign.ts --out .mesure/out/<campaign>` on a built engine. Resuming
   needs the same arguments, repository state, built JavaScript, asset manifest, browser version and
   machine, and an error-free measurement; a mismatch refuses to overwrite evidence.
2. Export: `node bench/runner/summary/summaryGlobal.ts --from .mesure/out/<campaign> --to
.mesure/out/<campaign>-report --id <campaign>` (defaults: `.mesure/out/global`,
   `<from>/report-data`, `current`).
3. Stage: `node bench/runner/report/publishReport.ts --from .mesure/out/<campaign>-report` writes
   `site/reports/<id>/`, replaces the campaign staged before and writes the catalogue; an ID already
   staged is refused. No deploy, no push.
4. Preview with `pnpm docs:serve`.

`formatVersion: 1` holds runs and readings, original PNGs and public source JSON (no filesystem
paths or commands). The portal shows named-engine charts, image pairs as sliders, every scene and
run comparison and the full source tables; null stays distinct from zero, timing methods stay
apart, no GPU pass sum is shown as a frame, and no speedup verdict is drawn without repeated runs.

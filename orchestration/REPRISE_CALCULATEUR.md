# Calculateur — handoff

Confirm title `Calculateur` with `get_session("self")`. Follow `AGENTS.md`; plan: `SPEC_MOTEUR_SANS_THREE.md`, R1a–R1f. Nothing pushed by this session; only the Validateur pushes.

## State on 2026-09-16, 16:45

- **Merged into develop** (1dc9b1ba, local; the Validateur pushes): computations of `sdk-browser` off Three.js (foundation `sdk-core/math*.ts`, `EngineCamera` per-frame path, loading/explorer, diagnostics, `visibilityShadingNormal`; `three` importers 137 → 98 locked by `test/engineNoThree.test.mjs` and `engineNoThreeMath.test.mjs`); audit corrections (`setWebgpuTransform` resolves ancestors first, `SINGULAR_PARENT_TRANSFORM`; conditional depth convention `depthConvention.ts`/`DepthCamera`; oriented normal criterion, real-shader substitutions); durable browser proofs of the audit; honest harness counters and synchronous `drawnTriangles` with coverage `selected − drawn − uncovered = 0`; perf: `frustumPlanesFromMatrix` by arguments, `visibilityShadingNormal` without per-pixel allocation, `multiplyMatrix4` without `outOffset` (−6 %); **singular normals settled**: rank 2 → adjugate (= cross product of transformed edges, cofactor identity, no separate fallback), rank ≤ 1 → finite zero (`uniteOuZero`), non-finite transform → `NON_FINITE_TRANSFORM` at load and `setTransform`, regular unchanged bit for bit; bench instruments: `bancProcessusNeuf.mjs` (performance in a fresh process), flat-buffer batch layout published next to the per-element one.
- Proof on each lot's exact SHA: bit-identical benches, `validate` green end to end, `test:gpu` 27/27, common-bench campaign 0 px / max channel 0 on 6 series against its base, coverage 0. Measurements under `.mesure/out/calculs/`.
- **Reference image decision (user, 16:30)**: develop ≥ 37a55d59 (GPU partition included) is the reference at threshold 1; differences against 88af5cde there are exact depth ties at LOD seams (order-dependent, deterministic, A/A 0), no longer a regression. Compare to develop ≥ 37a55d59 with `--pixelError 0,1`.
- Decisions kept: per-frame API takes `EngineCamera`, refuses a raw host camera; `addInstance(transform: THREE.Matrix4)`, `PageRec.matrix`, `explorer.bounds/center` stay host-written (R8).

## To do, in order

1. **Push** develop (Validateur).
2. **Speed verdict**: campaign in progress on 1dc9b1ba at load 4.6 (three passes, A/A, two per-frame campaigns) — `.mesure/out/calculs/vitesse-finale-1dc9b1ba/`. Known structural losses: `composeMatrix4` +3 % (Three reads three objects, we read ten cells), CPU/GPU near-singular threshold differs (CPU `det === 0` in f64, GPU normalised determinant in f32). Next lever: polymorphic call sites of `multiplyMatrix4` in `sdk-browser` (`Float64Array`/`Float32Array`/`Array` → +38 % measured at a monomorphic site).
3. **Two red benches on develop, not from these lots**: `residence.bench.mjs` since af8a53ad (Geometry), `g-soleil-g.bench.mjs` G8 NaN since 061059e0 (Lumière checking). `bench:calculs` not run whole.
4. **Two `?? 0` left**: `explorerMetrics.ts:98`, `explorerRender.ts:114`.
5. **Mip seam** (gutter per level in the atlas compiler; deletes `wrapUv`, `WrapTaps`, the four taps).
6. **Camera-relative rendering (large worlds)** — audit against Epic's engine, 2026-09-16: the GPU works in f32 (7 significant digits); a vertex 12 km from the scene origin is only millimetre-accurate and jitters. Epic keeps double on the CPU and sends the GPU positions relative to the camera. We keep double on the CPU (`Float64Array`) but upload absolute world matrices in f32. No effect on a house or a district; visible on a city-scale scene. Lot: subtract the camera position in double (`cameraWorld.ts`, `EngineCamera.view`) before the f32 upload, world matrices of pages/instances made camera-relative once per frame; 0 px on Emerald by construction, proof on a scene offset by 50 km. Same audit: no reversed-Z with infinite far plane (`perspectiveProjection`, `depthCompare: 'less'`) — depth precision lower far from the camera, second lot, changes the depth buffer convention everywhere (Hi-Z, raster, shaders).
7. **M5 follow-up** (POC merged 0f95e425, no measured gain yet): arena robust to Wasm memory growth (views rebuilt) so engine buffers live in it without copies; whole hierarchy update in Rust (sequential parent→child, not a batch); `mathBatch`/`mathPath` exposed by the measurement harness; worker path (Geometry needs it for page integration). Then R7/R8 (WebGL2 renderer, host API without Three types).

## Workflow

- Opus: code, reproductions, benches; Sonnet: tests, campaigns, read-only audits. Worktree from `develop`; never stash or push. A fresh worktree has no `node_modules`: symlink the repo's. `LAB_ROOT=/Users/pasquelin/Applications/render-tech-lab` for `test:gpu` and `scripts/mesure`; never port 5174.
- One proof per lot on its exact SHA: bit-identical benches, `test:gpu`, common-bench campaign with A/A witness. Equivalence to the previous code and geometric correctness are different claims: name which one each test makes.
- Bug fixes: reproduce on CPU **and executed GPU** before fixing; every correctness test killed by mutation; replay a supplied counterexample before concluding.
- Durations compare only at equal input, camera, resolution, DPR, threshold, budget **and residency** — and load. Otherwise they are observations, not verdicts.

## Traps this project has already sprung

- **A guard on a raw determinant judges scale, not degeneracy** (`±s³`): `abs(det) < 1e-20` dropped out at `(1e-20)^(1/3)`. Normalised guard, one writing, `inverseTransposeWgsl.ts`.
- **An unsigned angle accepts −N and 0**: `|a·b|` and `atan2(0,0) = 0` let a fully wrong shader pass 365 cases (fixed 2026-09-16: signed dot, NaN on null, unit norm, substitution proven on the real shader).
- **A zero can be a fallback, not a measurement**: `triangles = 0` came from an idle Three renderer's `info.render.triangles`, not from a held frame. Publish `null`, or the counter that is actually kept on that engine.
- **The parent's world matrix must be resolved before inverting it**: `setTransform` used a stale parent (x = 3 requested, 13 obtained). A `sameElements` early return needs the same resolution.
- **A plausible thesis is not a defect** (lot 6 cone/winding); **a witness can miscount both ways** (560 → 54 hid 119 false positives); **pixels called noise had a cause** (defect 7 found by bisection); **a test matching shader text proves nothing**; an interrupted agent once left a verification mutation in the source — check the diff before believing a failure.

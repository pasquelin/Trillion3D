# Lumière — todo

Confirm title `Lumière` with `get_session("self")`. Follow `AGENTS.md` and the "Requirements" section at the end of this file. Fable leads and never codes; Opus codes; Sonnet reads and measures; the user tests in the Lab and merges (`git merge --no-ff`, then deletes branch and worktree); nobody pushes. Worktrees by hand from `develop` (`git worktree add -b <branch> .claude/worktrees/<name> develop`), never `isolation: "worktree"`. Never port 5174, never `public/benchmark-assets`. Before any Lab work: `ListAgents` + `git log develop` of the Lab (bench 16 belongs to Texture, Lab develop 8c2157d). "?" is a question, not a go. Image reference = develop ≥ e8819543, campaigns `--pixelError 0,1`. `check:unused` carries 3 findings on develop that are not ours (`scripts/mesure/options.mjs`, `optionsCote.mjs`, `packages/sdk-browser/backendTypes.ts`).

1. **Now** stable image: mobile camera, 8 lights + sun gives 0 / 1,392 / 6,278 px over 3 identical runs and 14 page errors per run. Isolate twice each: fixed camera, sun only, lights only, shadows off, no lights; read the errors. Done when 3 runs give 0 px.
2. Offscreen shadow casters (`webgpuPagesEncodeShadowPass.ts`): a wall behind the camera shadows the visible floor.
3. Far proxy and bounce follow moved objects (`webgpuPagesTransform.ts`): a moved door moves the distant shadow and the bounce.
4. Every contributing light per tile: remove the cap of 32 and give transparent surfaces against the sky a tile depth (`gpuLightTilesShader.ts`). 33 lights, none lost.
5. Bounce shadow test for every light (`bounceSurfaceWgsl.ts`): no wall leakage with 5 lights.
6. Caster rejection inside the shadow budget (`stageMapping.ts`); then skip the test behind a surface, atlas on demand, proxy only with a sun, keep depth on a color-only change. 0 px.
7. Mirrors: branch `lot/reflet` deleted on 2026-09-16; its 9 commits are kept as patches in `.mesure/patches/lot-reflet/` (+ `lot-reflet.bundle`, base d48b66a, 257 commits behind, never drew a reflection). Start again from develop, reuse the fixture `classes-materiaux/miroir.gltf` and the patches as reading material, find why on/off = 0 px. Done when the cubes show in the metal floor.
8. Detached public light copies (`explorerLightApi.ts`): mutating a copy never touches internals.
9. Ground-view GPU cost 3.65 → 6.49 ms at 0 px: bisect on a quiet machine only.
10. After 7: rough reflections, colored semitransparent shadows, leaf translucency. Binary-alpha BLEND → MASK on import conflicts with the transparency rule of `AGENTS.md`: the user settles first.
11. Bounce 3 (`lot/rebond-3`): probe cascades around the camera, budget in milliseconds rather than in mesh and ray counts (X4, LR1), order-2 spherical-harmonics basis, on by default once the budget holds.
12. Shadows of blend materials: a transparent cluster gets no visibility row (`webgpuRowSync.ts`), so it never enters the drawn-row table of the shadow maps and casts nothing; masks already cast their real cutout through the opaque path. The attenuated, colored shadow of a semitransparent surface stays a batch of its own.
13. Per-pixel stochastic lighting (RX2, remainder): per-tile rejection is delivered, the sampling is not. History must go through an extra render target, ping-pong, not a storage buffer (a write from the fragment shader is expensive for the tiler, which then stops discarding hidden surfaces). Also needs a bench where lights really reach transparent surfaces, not just a count of declared lights.

User decisions pending: D1, WebGL `unlit` renders metals black (ambient π on PBR, Three path being removed) — fix exists as unreferenced commit b57ebd89 (`git branch hold/unlit-albedo-three b57ebd89` to keep it): declare "not faithful on metals" in WebGL capabilities, or first batch of the Three-free WebGL2 renderer. `lot/banc-fiable` deleted (patch kept in `.mesure/patches/lot-banc-fiable/`, need now covered by the compiler); Lab duplicate `lot/banc16-refonte` deleted.

Done and on develop, for orientation only: GEO-02 (program and far-proxy arrival through `run.gate.resourcesChanged()`); emitter radius is a sphere, no longer the near-plane cube (`gpuShadowShader.ts` discard by distance, fixture `classes-materiaux/emetteur-sphere.gltf`, GPU test `bench/justesse/emetteur-sphere-gpu.mjs`, compiler 0.7.0 emits `emitterRadius`); a removed light returns its shadow slice (`sceneLightShadowRelease.ts`, bench 16 three "all off" cycles stay at 155.02); bench G8 follows `SunCascade` without `boxRadius`; `sceneLit` read per frame; `unlit` identity composition on WebGPU; two-slice tile lists; far shadow on the blend pass. Images: `.mesure/out/emetteur-sphere/`, `.mesure/out/ombres-lampe-retiree/`, `.mesure/out/aa-*`. Audits: `docs/AUDIT_BANC16_2026-09-16.md`, `docs/VERIFICATION_STABILISATION_5896648_2026-09-16.md` (untracked, break `check:links` in the main checkout only). Engine notes from bench 16: `triangles` GPU counter can read 0 on a held frame while `selectedTriangles` > 0; no way to bind a `SceneLight` to a node, hosts apply the same pose to both. Test gaps: `webgpuBindBudget.test.ts` misses `createDeferredLayouts`; nothing runs `prepareWebgpuPages` end to end. Delete this file when the list is empty.

## Vision: Unreal (Lumen, virtual shadow maps) versus us

| Topic                   | Unreal                                                                                        | Us today                                                               | Gap / todo                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Direct lights           | Deferred, every light per tile, no practical cap                                              | Deferred, lights per tile, cap of 32 per tile, 64 per scene            | Lift the cap (todo 4)                                                                                                          |
| Sun shadow              | One huge virtual map, only visible pages drawn, updated on change                             | Camera-following cascades + far proxy, page invalidation               | Same idea, coarser; offscreen casters missing (todo 2)                                                                         |
| Light shadows           | One virtual map per light, cached across frames                                               | 4096² atlas, 4 maps refreshed per frame, emitter radius as a sphere    | Shadow for every light in the bounce, budget in ms (todo 5, 6)                                                                 |
| Indirect light          | Lumen: surface cache + screen and world probes, traced against a proxy, converges over frames | Resident proxy + damped probes + surface cache, first bounce shipped   | Same architecture, less mature: bounce follows moved objects (todo 3), wall leakage (todo 5), tighten error against the oracle |
| Reflections             | Traced on the surface cache, sharp mirrors by hardware tracing when available                 | Mirror view per reflective surface, coded but black image              | Working planar mirror (todo 7), then rough reflections (todo 10)                                                               |
| Transparents            | Forward lit, shadow and bounce approximated                                                   | Exact light loop, far shadow on the blend pass                         | Tile depth against the sky (todo 4), colored glass shadows (todo 10)                                                           |
| Area / emissive sources | Rect lights, emissives feed Lumen                                                             | Point and spot with emitter radius; emissives visible but do not light | Emissives as bounce sources, later                                                                                             |
| Baking                  | Optional, never required with Lumen                                                           | Refused by the user: everything dynamic                                | Same choice                                                                                                                    |
| Frame rate              | Quality drops on a slow machine (resolution, rays)                                            | Fixed budget in ms, light converges, final image identical everywhere  | Our rule is stricter; hold it on modest machines                                                                               |
| Proof                   | None, judged by eye                                                                           | Bit for bit, A/A, oracle                                               | Image still unstable with a mobile camera (todo 1, first)                                                                      |

Same battle plan as Lumen (exact direct, damped indirect on a proxy, reflections on the same cache) with two harder choices on our side: nothing baked, and a frame rate that never moves. What separates us today is maturity, not architecture: stable image, complete shadows, working mirrors.

## Requirements (dynamic lighting, spec version 2)

Completes `SPEC_MOTEUR_SANS_THREE.md`, which stays the reference for geometry. Every requirement is numbered and verifiable; a requirement without an attached measurement does not exist. Values marked "setting" are product choices: start with them, measure, tighten.

### Guiding principle

The engine is generic: there will be billions of scenes. Emerald, the test house and any other bench are measurement sets, never a destination. No requirement here is coded per object type ("mirror", "water", "tree") nor per scene name: everything is coded from material and light properties declared in the imported data. A rule proven on one bench must hold for any scene carrying the same properties.

### 0. Need, principle, non-goals

- Need: dynamic global lighting, clean, obeying the laws of light, without dropping the frame rate. Colored moving lights that can be switched on, off, recolored; a door that really cuts the light exchange between two rooms; a red wall coloring the indirect; mirrors showing what is offscreen; a moving camera with no incorrect dependency on the current screen.
- **Founding principle: the frame rate never moves, it is the light that converges.** Each component gets a fixed budget per frame, in milliseconds. Work not done waits for the next frame. The steady-state image is the same on every machine; only the time to reach it varies, and it is bounded.
- Non-goals of this version: caustics, participating media, colored transmission through glazing, refraction with depth absorption (water), curved mirrors, nested reflections, rendering with no GPU at all. They are out of scope and named as such in the diagnostic.
- Cross-cutting rules: those of `AGENTS.md` (fidelity before speed, no resolution drop, honest measurements, CPU and GPU never summed, forbidden words). No baked illumination as a product destination: data baked at compile time is geometric, never luminous. An undeclared approximation is a defect.
- **Fidelity for lighting, different from geometry.** Geometry is proven bit-exact (`tri = selected`, E8). Lighting cannot be: temporal and stochastic techniques (traced and interpolated probes, adaptive hysteresis, camera-following cascades, Monte-Carlo oracle) never render exactly the same image twice, on one machine or across machines. The `AGENTS.md` rule therefore applies as written, not as an exception: a difference is explained at the level of the A/A noise (two runs of the same side), measured and published in the batch commit message. For the bounce, the error against the oracle of contract E (section 5) is added: a batch that tightens A/A noise without tightening the oracle error has proven nothing about the physics.

### 1. Target architecture

- [1] Native Rust compiler (the same binary): resident proxy (coarse DAG level with certified error + BVH, or per-object SDF); per-object surface cards (projections, atlas, coverage — geometry and materials, no light); oracle (CPU path tracer converged on the source triangles, measured uncertainty).
- [2] Runtime (TypeScript, WGSL, GLSL): light scheduler, a work queue ordered by residual and influence, drained up to the budget — direct (per-light shadow maps, exact every frame); diffuse indirect (irradiance probes traced against the proxy + surface cache on the cards); specular (reflected view for every reflective surface, surface cache for what is offscreen); final gather in the deferred lighting (R6) or the WebGL2 forward pass (R7).
- [3] Bench 16: scenarios, error contract against the oracle, separated costs, archived reports.

### 2. Physics (P)

P1. **Single units and BRDF**: radiance and irradiance in linear radiometric units; energy-conserving Lambert and GGX, one reference implementation shared by the oracle, the WGSL and the GLSL (generated from the same source, like R7). Criterion: white furnace GGX and Lambert at 1 ± 10⁻³ per channel, analytic value published for maximum roughness.
P2. **Reciprocity and non-negativity**: sampled transport is non-negative; reciprocity is checked on the proxy by test. Criterion: symmetry test on the two-room fixture.
P3. **No double counting**: emission, direct, indirect and specular are partitioned; an emissive surface may also reflect. Criterion: sum of components equal to the oracle at contract E.
P4. **Tone mapping last**: every blend, accumulation or interpolation happens in linear radiance before ACES and sRGB. Criterion: code review and linearity test (two lights = sum of the two linear images). In a view with no light, the composition is the identity: albedo reads as is, linear to sRGB and nothing else — no exposure, no ACES, on either path.
P5. **Named approximations**: probes (interpolation), cards (projection), damping (latency), proxy (certified geometric error). Each approximation has a field in the diagnostic and a bound in contract E.
P6. **No light without a declared source**: no fixed ambient, no "night mode"; daylight is a declared sun or sky light in the scene, entering only through openings and casting shadows — a windowless corridor stays black in broad daylight, except for indirect bounce. Holds for every material, transparent surfaces and foliage included. Criterion: windowless-corridor scenario, zero radiance outside indirect bounce.

### 3. Compiler (LC)

LC1. **Resident proxy**: representation of the whole scene, camera-independent, always in memory (R4 guarantees it for the roots): coarse DAG level whose certified error is ≤ a scene threshold (setting: 5 cm), with its own BVH, or per-object SDF if the E0 measurement justifies it. No light ray traces the fine visible cut. Criterion: Emerald, proxy memory and build time published; max geometric error ≤ threshold.
LC2. **Surface cards**: per-object projections (six directions, split into cards), atlas and table; geometry, normals, materials; no light. Coverage metric (fraction of the surface area represented), concave objects included. Criterion: coverage ≥ 95 % on the bench scenes, atlas size and byte budget published.
LC3. **Instances**: cards are shared between instances; the lighting state never is (see LR6).
LC4. **Formats**: `formatVersion` raised at every new column, unknown formats refused, byte-identical provenance (C10).
LC5. **Oracle**: CPU path tracer in the binary, source triangles, same materials, lights, camera and pixel footprints as the runtime, specular paths included, shadow intersections independent of the shadow maps, several independent runs and verified convergence. Criterion: uncertainty published per pixel; below the contract E threshold, otherwise the verdict is undetermined.

### 4. Runtime (LR)

LR1. **Per-component budgets** (GPU, reference machine Apple M2 Max, 1280 × 720, settings):

| Component                                           | GPU budget per frame |
| --------------------------------------------------- | -------------------: |
| Direct and shadows (shadow maps, PCSS)              |               0.8 ms |
| Irradiance probes (rays against the proxy)          |               0.8 ms |
| Surface cache (texels updated)                      |               0.4 ms |
| Reflected view (if a reflective surface is visible) |               0.5 ms |
| Final gather                                        |       included in R6 |

Criterion: each budget measured per GPU pass (WebGPU); the sum fits in the 8.33 ms frame with geometry at its R6 budget. On an integrated GPU, budgets are divided by the measured power ratio, never the resolution.

LR2. **Light scheduler**: one work queue (probes, card texels, reflected-view faces) with priority = residual × influence on the image (approximate adjoint), drained up to the budget then suspended; zero allocation per frame; last instruction replaceable, answers carrying a revision. Criterion: per-frame time constant within ± 10 % while a door slams; no stale answer applied to another geometry.
LR3. **Direct**: per-light shadow maps (cascades for long-range lights), soft PCSS shadows; a map is redrawn only if its light or an object in its range moved, cached otherwise; it receives only what can cast a shadow, within its range and its face, with no drop in resolution or detail. An `alphaMode: MASK` casts its real cutout (material mask) in the depth pass; a blend material (`alphaMode: BLEND`) still casts nothing. Attenuated and colored shadows of semitransparent surfaces (glass, water): separate batch, out of scope. Criterion: contract E, "direct" component; zero latency.
LR4. **Diffuse indirect**: sparse probe grid with visibility (distance moments) to avoid leaks; rays traced against the proxy; rays re-read the surface cache for multi-bounce and coloring; adaptive hysteresis (change detection per probe and per texel); dynamic occluders (a door) also tested as analytic boxes in the probe interpolation. Criterion: contract E, "indirect" component and latency.
LR5. **Surface cache**: light per card texel, updated by budget, region invalidation on movement. Criterion: LC2 coverage, contract E.
LR6. **Per-instance lighting state**: two instances of the same object in two lightings have two states; moving an instance invalidates its state. Criterion: "instance move" scenario.
LR7. **Reflection for every reflective surface**: the reflected-view mechanism is driven by the material's reflective property, not by an object named "mirror"; every surface declaring that property benefits from it, water included. The reflected view is bounded to the screen footprint of the surface, level of detail chosen by the same screen error as the main view; what is offscreen comes from that view, never from screen space alone. Criterion: "offscreen mirror" scenario, replayable on any declared reflective surface.
LR8. **WebGL2**: same components, probes updated by fragment passes (BVH and proxy in textures), own budgets; parity judged at steady state (B2, ≤ 2 per channel), latency judged by its own limit. Criterion: parity campaign.
LR9. **Honest metrics**: per component, CPU per step, GPU per pass or `null`, queued work, processed work, current estimated latency, memory; `null` for what is not measured.

### 5. Error contract (E)

E1. **Separated components**: direct, diffuse indirect, reflection, compared to the oracle in linear RGB radiance, per pixel.
E2. **Normalized error**: `e = |L − L*| / (ε_abs + ε_rel · |L*|)`, conforming if `e ≤ 1`. Initial settings: ε_rel = 2 %, ε_abs = 0.1 % of the scene reference radiance, to be confirmed by the first campaign.
E3. **Published statistics**: maximum, p95, p99, fraction of pixels with `e > 1`, per component and per scenario.
E4. **Targeted regions**: room behind the closed door, wall receiving the coloring, mirror content, contact between objects, narrow slit.
E5. **Response latency** after an event, measured as the time for the indirect component error to fall back under the E2 threshold relative to the final steady state: **target 100 ms on the reference machine, limit 250 ms everywhere, 500 ms on an integrated GPU** (settings, chosen on the bench 16 videos). Beyond the limit: failure.
E6. **Temporal variations**: error of `(L_t − L_{t−1})` against the oracle on a fixed camera, to detect flicker and trails.
E7. **Oracle**: uncertainty under the E2 threshold, otherwise the verdict is undetermined, never conforming.
E8. **Geometric fidelity unchanged**: the components alter neither silhouettes nor draw order; `tri = selected`, holes 0.

### 6. Platforms (LP)

LP1. The OS does not matter: the browser carries everything. Test matrices cover macOS, Windows, Linux through the same browser.
LP2. WebGPU is the main path (compute, probes, proxy). WebGL2 is a complete fallback at steady state, slower to converge.
LP3. Integrated GPU: same components, reduced budgets, its own E5 latency limit, never a resolution drop.
LP4. With no usable GPU at all: out of scope, declared as a missing capability.

### 7. Bench and proof (LB)

LB1. Bench 16 hosts and measures; the algorithms live in the SDK. Protocol: `16-lighting-transport/docs/protocole-eclairage.md` in the Lab.
LB2. Scenarios: cold start, door slamming, door opening, light moving at fixed speed, switch, narrow slit with a small intense source, mirror seeing an offscreen object, instance move.
LB3. Provenance: resolution, DPR, refresh rate, hardware, machine load, SDK, Lab and compiler commits, cache fingerprints.
LB4. **Per-step profile**: contract `packages/sdk-core/stageProfile.ts`, exposed by `explorer.stageProfile()`, measured by the `scripts/mesure` harness; CPU and GPU never summed, `null` for what is not measured.

### 9. Decisions taken and rejections

- Fixed frame rate, variable convergence, same final image.
- Latency: target 100 ms, limit 250 ms, 500 ms on an integrated GPU; settings revisable after measurement.
- Baked illumination refused as a destination; the cards contain no light.
- Rays against the visible cut: refused (camera-dependent, leaves too coarse); resident proxy mandatory.
- Damping as the only lever: refused; adaptive hysteresis and priority by residual and influence are mandatory.
- SSR and cubemap alone for mirrors: refused, they do not give a sharp offscreen image.
- Per-light bases (linearity): reserved for scenes with many fixed lights; not a priority.
- The rectangle prototype and its dense solver serve as the discretization oracle and the latency scenario; no rendering function is added to them.
- No light without a declared source: fixed ambient and "night mode" removed.
- Reflection for every surface: mechanism driven by the material's reflective property, reusable by any surface, not a named mirror object.
- Water: no dedicated batch; a reflective, transparent material with animated relief, covered by the existing rules (LR7, transparency). Only refraction with depth absorption remains a property to add later. A test scene with water is to be provided by the user.

### 10. Computation placement and bounds (X)

X1. **Three families, three places**: at compile time in the Rust binary (proxy, cards, BVH, oracle); every frame on the GPU (shadows, probe rays, cache texels, reflected view, gather); on the CPU only the scheduler (changes, priorities, queue), a few hundred microseconds, moved into a Worker if the measurement exceeds 1 ms. No dense solver at runtime: the prototype solver stays the offline discretization oracle.
X2. **Every loop is bounded by a constant known before the frame**: BVH traversal bounded by the depth of the proxy tree; PCSS with a fixed number of taps (setting: 16); interpolation over eight probes per pixel; rays per probe and texels per batch fixed. No per-pixel loop over lights, surfaces or source samples: direct comes from the shadow maps, indirect from the probes. Criterion: shader review, bounds published in the diagnostic.
X3. **The only open iteration, convergence, spreads over frames**: each probe update re-reads the surface cache carrying the previous frame's light; successive bounces appear at successive updates. Zero cost per frame; latency bounded by E5.
X4. **Budget held by batches**: work is cut into fixed-size batches; the scheduler picks the number of batches for the frame from the GPU time of previous frames (WebGPU timestamp queries) and stops under the LR1 budget. WebGL2: batch count calibrated at startup. Criterion: LR2.
X5. **Shadow-casting lights capped**: at most N shadow lights updated per frame (setting: 4, the most influential); the others keep their cached shadow map, refreshed in turn; a still light in a still scene costs nothing. Criterion: the cost of direct is independent of the total light count.
X6. **Priorities computed on the GPU, read back asynchronously**: residual (difference between two updates) and influence (visible, distance, seen in a mirror) per probe and per card region; readback one frame late, never synchronous.
X7. **Real cost risks, measured in E0**: memory bandwidth (cache atlas, probe textures) more than arithmetic; traversal divergence on an integrated GPU; the second geometry pass of the reflected view. If a batch overruns, its size shrinks; the frame does not slow down, convergence lengthens.
X8. **Worker and WebAssembly, rule of use**: a Worker when a measured CPU job exceeds 1 ms per frame or lasts several frames (compiling an object, mass invalidation), to keep the main thread free; it speeds up nothing. Rust compiled to WebAssembly when a measured CPU kernel dominates, or when the same math must be shared with the compiler (BVH, proxy, screen error, picking); SIMD if available. Neither relieves the GPU: never an answer to drawing that is too expensive.

### 11. External reference marks, neutral vocabulary (RX)

Public external reference marks, in neutral vocabulary, each with what it changes for us. None is copied as is: each is replayed on our own scenes and its own budget before entering the code.

RX1. **Irradiance fields + probe occlusion as a "light" mode**: this is already our direction (LR4, LC5) — sparse probes and the surface cache are that light mode, not a stepping stone to something else. Priority: tighten that path (order-2 basis, budget in milliseconds) rather than adding a separate per-pixel traced bounce.
RX2. **Per-pixel stochastic lighting** (one shadow ray per pixel, temporal accumulation, rejection of out-of-range lights): carries hundreds of shadowed lights without one shadow map per light. Per-tile rejection of out-of-range lights is our current rule; the sampling and the temporal accumulation remain an open batch (batch 14 above).
RX3. **Virtualized shadows**: a shadow cache with a deferred-invalidation budget, recomputing only the faces actually touched by a change. Already our rule (LR3: rejection by range and by face, residency, zero work in a still scene). To extend: replace the light cap (X5) by a time budget, as X4 requires for the bounce.
RX4. **Minimum card resolution of the surface cache lowered** (external mark: 4 → 2, on the finest axis of a card). Here, LC2 fixes a coverage (≥ 95 %) but does not bound the minimum resolution of a projection card. A parameter to add to LC2, to expose on the compiler side, and to measure on Emerald before any change of default.

# Lumière — todo

Confirm title `Lumière` with `get_session("self")`. Follow `AGENTS.md` and `SPEC_ECLAIRAGE.md`. Fable leads and never codes; Opus codes; Sonnet reads and measures; the user tests in the Lab and merges (`git merge --no-ff`, then deletes branch and worktree); nobody pushes. Worktrees by hand from `develop` (`git worktree add -b <branch> .claude/worktrees/<name> develop`), never `isolation: "worktree"`. Never port 5174, never `public/benchmark-assets`. Before any Lab work: `ListAgents` + `git log develop` of the Lab (bench 16 belongs to Texture, Lab develop 8c2157d). "?" is a question, not a go. Image reference = develop ≥ e8819543, campaigns `--pixelError 0,1`. `check:unused` carries 3 findings on develop that are not ours (`scripts/mesure/options.mjs`, `optionsCote.mjs`, `packages/sdk-browser/backendTypes.ts`).

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

User decisions pending: D1, WebGL `unlit` renders metals black (ambient π on PBR, Three path being removed) — fix exists as unreferenced commit b57ebd89 (`git branch hold/unlit-albedo-three b57ebd89` to keep it): declare "not faithful on metals" in WebGL capabilities, or first batch of the Three-free WebGL2 renderer. `lot/banc-fiable` deleted (patch kept in `.mesure/patches/lot-banc-fiable/`, need now covered by the compiler); Lab duplicate `lot/banc16-refonte` deleted.

Done and on develop, for orientation only: GEO-02 (program and far-proxy arrival through `run.gate.resourcesChanged()`); emitter radius is a sphere, no longer the near-plane cube (`gpuShadowShader.ts` discard by distance, fixture `classes-materiaux/emetteur-sphere.gltf`, GPU test `bench/justesse/emetteur-sphere-gpu.mjs`, compiler 0.7.0 emits `emitterRadius`); a removed light returns its shadow slice (`sceneLightShadowRelease.ts`, bench 16 three "all off" cycles stay at 155.02); bench G8 follows `SunCascade` without `boxRadius`; `sceneLit` read per frame; `unlit` identity composition on WebGPU; two-slice tile lists; far shadow on the blend pass. Images: `.mesure/out/emetteur-sphere/`, `.mesure/out/ombres-lampe-retiree/`, `.mesure/out/aa-*`. Audits: `docs/AUDIT_BANC16_2026-09-16.md`, `docs/VERIFICATION_STABILISATION_5896648_2026-09-16.md` (untracked, break `check:links` in the main checkout only). Engine notes from bench 16: `triangles` GPU counter can read 0 on a held frame while `selectedTriangles` > 0; no way to bind a `SceneLight` to a node, hosts apply the same pose to both. Test gaps: `webgpuBindBudget.test.ts` misses `createDeferredLayouts`; nothing runs `prepareWebgpuPages` end to end. Delete this file when the list is empty.

## Vision: Unreal (Lumen, virtual shadow maps) versus us

| Topic | Unreal | Us today | Gap / todo |
|---|---|---|---|
| Direct lights | Deferred, every light per tile, no practical cap | Deferred, lights per tile, cap of 32 per tile, 64 per scene | Lift the cap (todo 4) |
| Sun shadow | One huge virtual map, only visible pages drawn, updated on change | Camera-following cascades + far proxy, page invalidation | Same idea, coarser; offscreen casters missing (todo 2) |
| Light shadows | One virtual map per light, cached across frames | 4096² atlas, 4 maps refreshed per frame, emitter radius as a sphere | Shadow for every light in the bounce, budget in ms (todo 5, 6) |
| Indirect light | Lumen: surface cache + screen and world probes, traced against a proxy, converges over frames | Resident proxy + damped probes + surface cache, first bounce shipped | Same architecture, less mature: bounce follows moved objects (todo 3), wall leakage (todo 5), tighten error against the oracle |
| Reflections | Traced on the surface cache, sharp mirrors by hardware tracing when available | Mirror view per reflective surface, coded but black image | Working planar mirror (todo 7), then rough reflections (todo 10) |
| Transparents | Forward lit, shadow and bounce approximated | Exact light loop, far shadow on the blend pass | Tile depth against the sky (todo 4), colored glass shadows (todo 10) |
| Area / emissive sources | Rect lights, emissives feed Lumen | Point and spot with emitter radius; emissives visible but do not light | Emissives as bounce sources, later |
| Baking | Optional, never required with Lumen | Refused by the user: everything dynamic | Same choice |
| Frame rate | Quality drops on a slow machine (resolution, rays) | Fixed budget in ms, light converges, final image identical everywhere | Our rule is stricter; hold it on modest machines |
| Proof | None, judged by eye | Bit for bit, A/A, oracle | Image still unstable with a mobile camera (todo 1, first) |

Same battle plan as Lumen (exact direct, damped indirect on a proxy, reflections on the same cache) with two harder choices on our side: nothing baked, and a frame rate that never moves. What separates us today is maturity, not architecture: stable image, complete shadows, working mirrors.

# Lumière — handoff (2026-09-16)

## Workflow

- Run `get_session("self")` first. Follow `AGENTS.md` and the relevant sections of `SPEC_ECLAIRAGE.md`.
- Fable leads, no coding; Opus codes; Sonnet reads and tests; Haiku runs existing commands only. Reuse established findings. Replies brief.
- Sessions merge into develop locally, never push; `npm run validate` is not run by sessions. Deliver branch, SHA, evidence. No measurement lock; discard timings under load. Never kill Lab port 5174 or write `public/benchmark-assets`.
- Scope = batches below, in order. Any new batch: propose in one line, wait for go. Per batch: tsc, `check:changed`, `check:unused`, `check:lines`, `check:duplicates`, one test per corrected behavior. One image campaign at the end, not per batch.
- Visual fix: reproduce, verify expected output, 0 px outside the affected area. Optimization: stable A/A, then before/after 0 px.

## State at hand-off (develop 936b4732)

- Unmerged branches: `fix/geo02-programme-asynchrone` (worktree `agent-afebb1d9f19aa2d78`, rebased on 936b4732, two tests to adapt, see batch A); `repro/geo02-geo03` f7dd7a42 (worktree `agent-a6c26ae32b0ba65ba`, reproduction only, tests written in the direction of the defect: delete once A is merged); `lot/banc-fiable` 3058b3e (worktree `lot-banc-fiable`, base bdaaacf, 213 behind); `lot/reflet` 415c9e1 (worktree `lot-reflet`, base d48b66a, 257 behind).
- Session branch `claude/reprise-lumiere-orchestration-61f682` (worktree `reprise-lumiere-orchestration-61f682`) is docs only and obsolete; its `.mesure/out/aa-audit-{1,2,3}` must be copied to the main checkout before the worktree is deleted.
- Merged since the 15 September handoff: sceneLit read per frame (9ff2a74c); GEO-03 host writes seen by WebGL engines, by Geometry (3a1e4485, `hostSceneWatch.ts`).

## Batches, in order

A. Finish GEO-02 (held frame kept the unlit program after the contract program compiled; far-shadow proxy adopted without a revision). Fix is `resourceArrived` in `frameRevisions.ts`, called on program arrival (`onReady` of `createDeferredLighting`, wired in `webgpuPagesPrepare.ts`) and on proxy adoption (`webgpuPagesPrepareSunFar.ts`); no guard in `frameSettled`. Remaining: `webgpuFrameHold.test.ts` and `webgpuSunFarHold.test.ts` fail after the rebase because develop's `holdWebgpuFrame` now does `run.frame++` and `recordHeldFrameWork` (reads `timing.cpuProfile.row`, `CPU_STEP`, writes `cpuSelectMs`, `lastGpu*Ms`, `rowFilled`, `cpuSample`): give the minimal `rt` those fields and assert on `frameHeld`, not on `run.frame`. Then rerun sdk-browser tests (develop baseline: 2 pre-existing failures), merge, tell Geometry to rebase `fix/lots12-corrections`.
0. Reliable bench: (a) request `lights.json` only when the manifest declares it, reject an incomplete cache: coded on `lot/banc-fiable`, gates pass, browser proof pending (`--vues sol --images 30 --pixelError 1`, zero 404, 0 px); rebase first. (b) A/A instability reproduced on develop, mobile camera, 8 lights + sun: 3 runs = 0 / 1,392 / 6,278 px at threshold 1, 14 page errors per run. Isolate, each case twice: fixed camera, sun only, lights only, shadows off, no lights; read the 14 errors. Acceptance: zero 404, A/A 0 px on 3 runs.
1. Offscreen shadow casters: dedicated selection (`webgpuPagesEncodeShadowPass.ts`). A wall behind the camera must shadow the visible floor.
2. Release the shadow atlas on light removal (`sceneLightStore.ts`); detached public copies (`explorerLightApi.ts`). Add/remove ×20 without failure; mutating a copy must not touch internals.
3. Far proxy and bounce follow moved objects (`webgpuPagesTransform.ts`). A moved door updates the distant shadow and the bounce.
4. Tile depth for transparent surfaces against the sky (`gpuLightTilesShader.ts`). The audit counterexample must receive light.
5. All contributing lights per tile, remove the cap of 32 (`gpuLightTilesShader.ts`). 33 lights, none lost, oracle 0.
6. Bounce shadow tests for every light (`bounceSurfaceWgsl.ts`). No wall leakage with 5 lights.
7. Include caster rejection in the shadow budget (`stageMapping.ts`). Synthetic 2 + 1 ms → 3 ms.
8. After 7: skip the shadow test behind a surface; allocate the 64 MiB atlas on demand; load the proxy only with a sun; keep shadow depth on a color-only change. Stable A/A, 0 px.
9. Reflection, `lot/reflet`: active path, 2 surfaces, +2 ms, but on/off = 0 px and the scene is nearly black; diagnosis stopped. Paused until go. Require visible cube reflections on the metal floor, A/A 0.
10. Ground-view GPU bisection: 3.65 → 6.49 ms, 0 px; lighting passes already skipped at 0 lights, suspect geometry or resolution. Needs a quiet machine: replay `db44508` twice, then the Hi-Z, GPU transparency, instances and water commits, `--profil on`.
11. After 9: rough reflections, colored semitransparent shadows, leaf translucency. The original proposal also converts binary-alpha BLEND to MASK on import, which conflicts with the transparency rule in `AGENTS.md`: settle that before coding.

## Evidence and limits

- External lighting audit, 2026-09-15, bdaaacf: `/private/tmp/webgeometry-lighting-audit-bdaaacf/audit.md`; 8 defects, 1280×720, 8 point lights + sun, mobile camera. External engine audit, 2026-09-16, 21a34f4b: GEO-02 and GEO-03, both confirmed by reproduction.
- Mirror fixture `packages/asset-compiler-rust/fixtures/classes-materiaux/miroir.gltf`; cache `.mesure/cache-miroir` in `lot-reflet`. The harness cannot compare reflection off/on: inspect visually or propose an option.
- Known test gaps: `webgpuBindBudget.test.ts` does not cover `createDeferredLayouts`; `deferredLighting.test.ts` calls `bind` with 3 arguments (3 TypeScript errors, tests excluded from tsconfig); nothing exercises `prepareWebgpuPages` end to end.
- Delete this handoff when all batches are complete.

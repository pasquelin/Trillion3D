# Lumière — handoff

## Workflow

- Run `get_session("self")` first. Follow `AGENTS.md` and relevant sections of `SPEC_ECLAIRAGE.md`.
- Fable leads, no coding; Opus codes; Sonnet reads/reasons about images/analysis; Haiku runs existing commands, never writes scripts. One agent per batch; reuse established findings. Keep replies brief; tables only when useful.
- Only Validateur merges develop, runs `npm run validate` and pushes. Deliver branch, SHA, evidence. No measurement lock; record `uptime`, discard timings under heavy load. Never kill Lab port 5174 or write `public/benchmark-assets`.
- Scope = batches below. Propose any new batch in one line and wait for go. Per-batch gates: tsc, `check:changed`, `check:unused`, `check:lines`, `check:duplicates`; one test per corrected behavior.
- Visual fix: reproduce, verify expected output, 0 px outside affected area; corrected image may change. Optimization: stable A/A, then before/after 0 px.

## Execution order (September 15 handoff; verify status before resuming)

0. Reliable bench:
   - (a) Request `lights.json` only when declared by manifest; reject incomplete cache. Coded `lot/banc-fiable` 3058b3e, worktree `lot-banc-fiable`, base bdaaacf, gates pass. Browser proof pending: `--vues sol --images 30 --pixelError 1`, zero 404, 0 px.
   - (b) A/A instability reproduced on develop, mobile camera, 8 lights + sun: 3 runs = 0 / 1,392 / 6,278 px at threshold 1; up to 28,261 px, max 124 at threshold 0; 14 page errors/run. Evidence `.mesure/out/aa-audit-{1,2,3}` in session worktree. Run each isolation case twice: fixed camera, sun only, lights only, shadows off, no lights; inspect 14 errors. Acceptance: zero 404, A/A 0 px on 3 runs.
1. Offscreen shadow casters: dedicated selection (`webgpuPagesEncodeShadowPass.ts`). Pending; wall behind camera must shadow visible floor.
2. Release shadow atlas on light removal (`sceneLightStore.ts`); detached public copies (`explorerLightApi.ts`). Pending; add/remove ×20 without failure, mutating copy must not affect internals.
3. Far proxy/bounce follow moved objects (`webgpuPagesTransform.ts`). Pending; moved door updates distant shadow/bounce.
4. Tile depth for transparent surfaces against sky (`gpuLightTilesShader.ts`). Pending; audit counterexample must receive light.
5. All contributing lights per tile, remove cap 32 (`gpuLightTilesShader.ts`). Pending; 33 lights, none lost, oracle 0.
6. Bounce shadow tests for every light (`bounceSurfaceWgsl.ts`). Pending; no wall leakage with 5 lights.
7. Include caster rejection in shadow budget (`stageMapping.ts`). Pending; synthetic 2 + 1 ms → 3 ms.
8. After 7: skip shadow test behind surface; allocate 64 MiB atlas on demand; load proxy only with sun; retain shadow depth on color-only change. Require stable A/A, 0 px.
9. Reflection `lot/reflet` 415c9e1 (`lot-reflet`): active path, 2 surfaces, +2 ms, but on/off = 0 px, scene nearly black; diagnosis stopped. Paused until go. Require visible cube reflections on metal floor, A/A 0.
10. Ground-view GPU bisection: 3.65 → 6.49 ms, 0 px. Lighting passes already skipped at 0 lights; suspect geometry/resolution, reference under load 15–26. Pending quiet machine: replay `db44508` twice, then Hi-Z/GPU transparency/instances/water commits, `--profil on`.
11. After 9: rough reflections, colored semitransparent shadows, leaf translucency; original proposal also includes binary-alpha BLEND → MASK on import. That conversion conflicts with AGENTS.md's transparency rule; resolve before implementation. Proof per batch.

## Evidence and limits

- External audit, 2026-09-15, bdaaacf: `/private/tmp/webgeometry-lighting-audit-bdaaacf/audit.md`; 8 defects, 1280×720, 8 point lights + sun, mobile camera.
- Mirror fixture: `packages/asset-compiler-rust/fixtures/classes-materiaux/miroir.gltf`; cache `.mesure/cache-miroir` in `lot-reflet`. Harness cannot compare reflection off/on runs: inspect visually or propose an option.
- Known test gap: `webgpuBindBudget.test.ts` does not cover `createDeferredLayouts`.
- Delete this handoff when all batches are complete.

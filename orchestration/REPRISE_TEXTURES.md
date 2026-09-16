# Textures — handoff

## Identity and workflow

- Confirm title `Textures` with `get_session("self")`. Follow `AGENTS.md`. Neighbours: Geometry, Lumière, Calculateur, Compilateur; only Validateur merges into origin, pushes and runs `npm run validate`.
- Fable orchestrates, never codes or reads long files; Opus 5 codes in a worktree; Sonnet 5 reads/verifies, never commits. Replies ≤5 lines, plain words.
- User order, 2026-09-16: **code one batch, the user tests the render on screen, then only if validated: tests, gates, validate.** No tests between batches. Deliver: branch + SHA + rebuilt `dist` + how to look at it (Lab route, what to expect). Never `npm run validate` here.
- Rules: optimisation = identical image (0 px against the reference at the same residency), otherwise it is a quality change to be decided by the user; generic engine (by material/texture property, never by scene); the two Epic trademark words are forbidden everywhere; ≤200 lines per file.

## Goal

First sharp image fast on modest machines, final fidelity untouched. Model: mip streaming with an always-resident tail (our 16×16 previews), a fixed GPU memory budget and a priority driven by what the screen needs — then, only if memory still dominates, tile virtualisation (batch 5).

## State at 2026-09-16

- Merged (develop 7cf5c6f → 5305f6c): batches 1–4 (preview atlas, prioritised chunked transfers, progressive mips + atlas classes, compression bench: no lossy format retained, 19 500× above A/A noise), pump priority fix (reads `run.desired`, previews before full resolution), harness `CAPTURE_MODE=flush|live`.
- Structural remainder: 7.56 GB of atlas at one class, 16 MiB/frame ⇒ ≥336 frames to full resolution; **priority follows triangle count, not screen area**.
- Decisions pending from the user: `ExplorerOptions.atlasClasses` 2 (−872 MB, 15 142 px differ on small distant objects); batch 5 tiles.

## Batch T1 — screen-driven mip streaming (next, to code)

Files: `packages/sdk-browser/webgpuTexturePriority.ts`, `streamingPriority.ts`, `webgpuAtlasJobs.ts`, `webgpuPagesPrepareTextures.ts`, `webgpuMaterialTextures.ts`, `textureMips.ts` (+ WGSL if a feedback pass is added).

1. **Wanted mip per texture from the screen**: for each visible cluster, projected size and UV density give the mip level actually needed (texels per pixel ≈ 1); a texture's wanted level = min over its visible clusters. Off-screen textures want only the resident tail.
2. **Budget**: fixed GPU byte budget (option, default from device limits); load higher mips in order of (wanted level gap × screen area), evict the least needed first when full; hysteresis so a level does not flap frame to frame.
3. **Transfers**: keep the chunked, prioritised pump; a mip arrives one level at a time (never skip to full res while a coarser level is missing), previews stay resident forever.
4. **No allocation per frame** in the priority pass; per-frame cost measured in `stageProfile` (`textures` stage).
5. `textureMips.ts`: build its pipeline once.

Delivery for the user's eyes: rebuilt `dist`, Lab route `/?test=15-virtualized-integration` (Emerald) and `/?test=16-lighting-transport`: textures sharpen where the camera looks first, memory counter stays under budget while moving; then A/A + reference capture in `flush` mode = 0 px, `live` mode reported (time to sharp, first frame textured).

## Later

- T2: feedback buffer (read the rendered image to get exact wanted mips, like the virtual-texture path) if the analytic estimate of T1 misses cases.
- T3 (= batch 5): tiles, only if memory still dominates after T1.
- Handed to Lumière: WebGPU column brighter/flatter than the Three reference in Lab report 15 is not textures (sRGB tested, flush = 3 px witness).
- Misc: Xcode licence not accepted (`sudo xcodebuild -license`); 4 pixels of develop flicker since the shadow batches (other author).

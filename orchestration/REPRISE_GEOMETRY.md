# Geometry — handoff (sans-threejs)

## Identity and workflow

- Confirm title `Geometry` with `get_session("self")`. Follow `AGENTS.md`. Neighbours: Lumière, Calculateur, Compilateur; only Validateur merges, pushes and runs `npm run validate`.
- Fable orchestrates, no coding; Opus 5 codes; Sonnet 5 reads/verifies, never commits; no Haiku. Replies ≤5 lines; do not relay waiting notifications.
- User order, 2026-09-15: code all batches, then one pass: tests, tsc, `check:changed`, `check:unused`, `check:lines`, `check:duplicates`, then one `scripts/mesure/banc.mjs` campaign (generale threshold 0 + mobile camera threshold 1, 60 frames, A/A). No measurements between batches or after rebase, no waiting/locks; never kill a campaign (orphaned Chrome). Pixels are evidence; timings on a loaded machine are unmeasured.
- Bug fixes: old output is not the oracle; one regression test per counterexample. Optimizations: equal quality, 0 px. Deliver branch + SHA to Validateur; never merge, push or stash. Evidence belongs in commits/delivery, not orchestration logs.

## Open audit defects

2026-09-15 23:00: `/tmp/webgeometry-audit-20260915.mjs`, 7/7 independently replayed on c47231d. 872 passing tests do not establish fixes. Locations below are approximate audit lines.

1. P1 WebGL bounds frozen at prepare (`pageSelectionCollect.ts:95`, `pageSelectionCut.ts:83`): moved object stays invisible; update from transform.
2. P1 cone absolute tolerance `1e-12` (`pageCone.ts:19`, WGSL) rejects visible small-scale faces; use conservative relative check.
3. P1 WebGL budget counts placements, not unique pages (`pageSelectionCutVisit.ts:49`, `pageSelectionCut.ts:97`); instances lose quality. Separate residency/draws.
4. P2 `dropPage()` retains `rec.attributes` (`autonomousResidency.ts:61`); CPU memory accumulates.
5. P2 PRS decomposition loses shear under scaled parent (`webgpuPagesTransform.ts:51`); preserve local matrix.
6. P2 screen error uses Euclidean distance (`projectionOracles.ts:105`, `clusterErrorPixels`, CPU/GPU); underestimates off-axis error.
7. P2 view copied before `getWorldPosition()` (`gpuSelection.ts:121`); parented camera inconsistent for one frame.

## State at 2026-09-15 23:30

- Merged, 0 px: WebGL2 cut 7aacf6f/b2a3266; maintained Hi-Z bounds 8498cd3 (WebGPU generale fixed CPU 5.9 → 4.7 ms); f-cones bench 0fd6834.
- Delivered/unmerged: `lot/selection-boxclip` e95abbb (cut 4.17 → 3.00 ms; touches defects 1–3 without fixing them); `lot/coplanaires` 0d274e3 (occlusion history; R5c exact-tie winner depends on history, ≤0.007%).
- GPU 29 ms at threshold 0 is bottleneck. Remaining fixed CPU: records 1.3 ms, adoption 0.9, occluders 0.4. Cut `keep` + `traverse` page records = 59%; Node instrumentation `.mesure/out/lot-selection-boxclip/instrument/`.

## Order

1. Validateur merges `lot/selection-boxclip`, `lot/coplanaires`.
2. Fix 1–3, then 4–7 in one sequence; one correctness test each.
3. Memory/residency: all-level WebGL indices (`clusterBatchPrimitive.ts:35`), 48 B/vertex WebGPU (`webgpuGeometryPrepare.ts:18`), full cone readback (`gpuDagRuntime.ts:115`), escalation passes when fully resident (`gpuDagDispatch.ts:95`). Then temporal Hi-Z (`essai/hiz-temporelle`, after maintained bounds), records/adoption toward 4 ms, typed-array cut <2 ms.
4. Final validation/browser proof on integrated content; then quiet-machine timings, Three reference on `transmission`, phase 3 first frame, phase 2 without Three. Preserve `essai/*` tags and `.mesure/out/<lot>/` images.

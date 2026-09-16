# Calculateur — handoff

Confirm title `Calculateur` with `get_session("self")`. Follow `AGENTS.md`; plan: `SPEC_MOTEUR_SANS_THREE.md`, R1a–R1f. Verified on `develop` d8d8a555, 2026-09-16: `npm test` 1018/1018, `npm run test:gpu` 21/21, lines, duplicates, types, lint, format green. Nothing pushed; only the Validateur pushes.

## Workflow

- Opus: code, reproductions, benches; Sonnet: tests; Haiku: campaigns. Worktree from `develop`; never stash or push. A fresh worktree has no `node_modules`: symlink the repo's.
- Bug fixes: reproduce on CPU **and executed GPU** (Chromium WebGPU, `LAB_ROOT`) before fixing; every correctness test killed by mutation; name the comparison behind each "0 difference"; replay a supplied counterexample before concluding.
- `npm run test:gpu` runs the justesse benches and browser proofs (21). Deliberately outside `npm test` and `validate`: it needs a GPU and the Lab.
- Durations compare only at equal input, camera, resolution, DPR, threshold, budget **and residency**. Otherwise declare them incomparable rather than explaining them.

## Traps this project has already sprung

- **A guard on a raw determinant judges scale, not degeneracy** (`±s³`): `abs(det) < 1e-20` dropped out exactly at `(1e-20)^(1/3) = 2.1544e-7`. Normalised guard, one writing, `inverseTransposeWgsl.ts`.
- **A plausible thesis is not a defect.** Lot 6 concluded the cone ignored winding under reflection; it was wrong — the engine already compensates via `frontFace`, and following it would have broken a working agreement. The real defect was elsewhere, in the CPU rasteriser.
- **A witness can miscount in both directions.** "560 → 54" held 119 false positives and missed 215 real defects; against real rasterisation it is 656 → 0. A removal count means nothing until correct removals are separated from removals of visible faces.
- **Pixels called noise had a cause.** The "6 unexplained pixels" were defect 7 (linear seam, commit 108a329d, max channel 1), found by bisection. With an A/A witness at zero, no pixel is noise.
- **A test that matches shader text proves nothing** — it breaks on reformatting and guarantees no arithmetic.
- An interrupted agent once left a verification mutation in the source: red tests, correct fix. Check the diff before believing a failure.

## Open

1. **Third guard rule**: `pageCone.ts` and `visibilityShadingNormal.ts` still call `THREE.Matrix3.getNormalMatrix`, guarded by `det === 0` — neither the absolute threshold nor the normalised determinant. CPU and GPU agree only because f64 does not denormalise where f32 does.
2. **Mip seam**: defect 7 fixed magnification only; the limit is written above `wrapAxis`. Lifting it means a gutter of replicated border texels per level, laid by the atlas compiler — that work would **delete** `wrapUv`, `WrapTaps` and the four taps.
3. **Singular matrices**: `matrixWindingCw` (3×3) and `Matrix4.determinant()` (4×4) disagree on 31 % of constructed singular matrices, conditioning under one ULP. Observable — a rank-2 primitive stays visible and the verdict picks the shown side — but the determinant is zero there: neither writing is right. Settle by convention, not by measurement.

## M batches — the bulk of what remains

Getting Three.js out of `sdk-browser` (R1a–R1f) has not moved since 2026-09-15.

- M2 volumes merged. **M1 foundation** `calculs/m1-socle` 2355e89 and **M3a hierarchy** `calculs/m3a-hierarchie` 594b97b (worktree `agent-a96ed1f…`) are delivered but unmerged, **217 and 282 commits behind**; rebase M1 first.
- Then: flat-buffer 4×4 product, M3b (≈150 Three call sites on the per-frame WebGPU path), M4 (loading, diagnostics, Three witness engines out of the SDK), M5 (worker/Wasm only where measured). Call survey: `git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`, lot T1.
- Both branches predate the camera pose contract (`cameraWorld.ts`), the texture addressing rework and the reflection rule moving to `sdk-core`. The rebase is real work, and their old figures are to be re-proven, not trusted.

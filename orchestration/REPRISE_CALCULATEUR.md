# Calculateur — handoff

Confirm title `Calculateur` with `get_session("self")`. Follow `AGENTS.md`; plan: `SPEC_MOTEUR_SANS_THREE.md`, R1a–R1f. Verified on `develop` d8d8a555, 2026-09-16: `npm test` 1018/1018, `npm run test:gpu` 21/21, lines/duplicates/types/lint/format green. Nothing pushed — `origin/develop` is far behind and only the Validateur pushes.

## Workflow

- Opus: code/reproductions/benchmarks; Sonnet: tests; Haiku: campaigns. Worktree from `develop`; never stash or push. A fresh worktree has no `node_modules`: symlink the repo's.
- Only Validateur runs `validate`, merges to publish and pushes. Deliver head + merge-base against recent develop, tests, `check:changed`, and a campaign when the image can move.
- Bug fixes: reproduce first on CPU **and executed GPU** (Chromium WebGPU, `LAB_ROOT`); correctness test killed by mutation; name the comparison behind every "0 difference"; replay supplied counterexamples before concluding.
- `npm run test:gpu` runs the justesse benches and the browser proofs (21). Not wired into `npm test` nor `validate`: it needs a GPU and the Lab.
- Durations are only comparable at equal input, camera, resolution, DPR, error threshold, budget **and residency**. Otherwise say so and do not compare.

## September 15 audit — closed

The ten defects are fixed, proven on executed GPU (apple metal-3) and merged locally. Three follow-up lots came with them: two `/simplify` passes and one repair of test doubles that other merges had made stale (28 failures → 0). Defects 9 and 10 were born from lot 6, which found them while hunting a counterexample.

Verdicts that do not guess themselves, keep them:

- 6 and 9: the `abs(det) < 1e-20` guard judged scale, not degeneracy (determinant `±s³`) — drop-off exactly at `(1e-20)^(1/3) = 2.1544e-7`. One writing now, `inverseTransposeWgsl.ts`, read by selection and lighting.
- 10: lot 6's thesis was **wrong** — the engine already compensates winding under reflection via `frontFace`. The real defect was the CPU rasteriser drawing the complementary set: 2 421 CPU/GPU disagreements → 0.
- 4: the fix was right from the start; an interrupted agent had left a verification mutation in place, which failed its own tests.
- 2 and 5 were only half done at the first pass, and were finished in the 2026-09-16 follow-up (below).

Two counts published then, both wrong, corrected since: the "6 pixels of noise" are defect 7 (linear seam, commit 108a329d, max channel 1), and "560 → 54" miscounted both ways — measured against real rasterisation it is **656 → 0**, the old figure holding 119 false positives and missing 215 real defects.

## September 16 follow-up — closed

- **Transparents follow transforms** (rest of defect 2). The blend copy took sixteen numbers of `matrixWorld` at prepare time — a photo — where an opaque page takes the live reference. Same object now, box set and rebuilt by one function, both painkillers gone (no bake, no per-frame recopy). Proofs: paginated and non-paginated over 13 frames (parent, shear, off-screen, return, held frame broken by a move); bench 12 instances, sol and rue, WebGL and WebGPU, 0 px.
- **Camera pose contract** (rest of defect 5). `cameraWorld.ts` is the single home; 17 of 21 calls go through it. The 13 leaves keep their own resolve — the caller survey shows none is reachable only from a frame entry, and resolving is idempotent. `test/engineStructure.test.mjs` carries three declared lists (who resolves, who touches a local pose, who reads the world pose and through what) and forbids the rest.
- **Projected bounds under a moving rig**: rig moved, scene still, cut identical → rectangles rewritten; nothing moves → none rewritten, so holding stays an optimisation.
- **Proofs made checkable**: 6 px attributed by 16-campaign bisection; the bench substitution is counted and fails loudly; the defect-6 witness separates correct removals from removals of visible faces; `normalTransform.test.ts` tests arithmetic and runs the real shader instead of matching shader text.

## Open

1. **Third guard rule**: `pageCone.ts` and `visibilityShadingNormal.ts` still call `THREE.Matrix3.getNormalMatrix`, whose guard is `det === 0` — neither the absolute threshold nor the normalised determinant. CPU and GPU only agree because f64 does not denormalise where f32 does.
2. **Mip seam**: defect 7 fixes magnification only; the limit is written above `wrapAxis`. Lifting it means a gutter of replicated border texels per level, laid by the atlas compiler — that work would **delete** `wrapUv`, `WrapTaps` and the four taps.
3. **Singular matrices**: `matrixWindingCw` (3×3) and `Matrix4.determinant()` (4×4) disagree on 31 % of constructed singular matrices, conditioning under one ULP. Observable — a rank-2 primitive stays visible and the verdict picks the shown side — but the determinant is zero there: neither writing is right. Settle by convention, not by measurement.

## M batches — untouched by the above, still the main plan

Getting Three.js out of `sdk-browser` (R1a–R1f) has not moved since 2026-09-15 and is the bulk of what remains.

- M2 volumes merged. **M1 foundation**: `calculs/m1-socle` 2355e89, delivered, unmerged, **217 commits behind develop**.
- **M3a hierarchy**: `calculs/m3a-hierarchie` 594b97b (worktree `agent-a96ed1f…`), unmerged, **282 commits behind**; rebase after M1.
- Then: flat-buffer 4×4 product, M3b (≈150 Three call sites on the per-frame WebGPU path), M4 (loading, diagnostics, Three witness engines moved out of the SDK), M5 (worker/Wasm only where measured). Call survey: `git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`, lot T1.
- Both branches predate the camera pose contract, the texture addressing rework and the reflection rule move to `sdk-core`. Expect the rebase to be real work, and re-prove rather than trust their old figures.

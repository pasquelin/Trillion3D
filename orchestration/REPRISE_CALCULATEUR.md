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

1. **Singular transforms and the normal fallback** — open, independent of the migration (audit of 2026-09-16 on 694da77f, confirmed). A singular matrix does not mean the face vanished: local triangle `(0,0,0),(1,0,0),(0,1,0)` under scale `(1,1,0)` then a 90° rotation about Y keeps area 0.5 and geometric normal `+X`. The GPU fallback (`inverseTransposeWgsl.ts`, `select(v, …, regulier)`) returns the LOCAL normal `+Z` (lighting ≈ 0.09 instead of ≈ 0.8 per channel on Apple Metal 3); the CPU (`mathMatrix3.normalMatrix3`, zero matrix on `det === 0`, as Three) returns a zero normal. Neither is right. Settle by convention: a face that keeps a non-zero area gets a world normal (cross product of transformed edges), a really collapsed face is a separate case, an unsupported transform is refused explicitly. The guard rule (absolute threshold vs normalised determinant) is part of the same decision.
2. **Mip seam**: defect 7 fixed magnification only; the limit is written above `wrapAxis`. Lifting it means a gutter of replicated border texels per level, laid by the atlas compiler — that work would **delete** `wrapUv`, `WrapTaps` and the four taps.
3. **Singular matrices**: `matrixWindingCw` (3×3) and `determinantMatrix4` (4×4) disagree on 31 % of constructed singular matrices, conditioning under one ULP. Settle by convention, not by measurement.
4. **Calm-machine timings**: every Node bench and the per-frame campaign of 2026-09-16 ran under load 39–80; pixel proofs stand, ns/op and `cpuFrameMs` verdicts do not. Re-run `socle-math`, `volumes`, `hierarchie`, `normale` benches (`node --expose-gc --experimental-strip-types <file>`) and `scripts/mesure/banc.mjs --avant 538fbe4b --apres <final>` with load < 6 before quoting a gain. Prior loaded run: 20/24 M1 lines faster than Three, `déterminant 4×4` and the 100 000-batch lines slower; `lookAt` camera 0,94× on 2026-09-15 not reproduced.

## M batches — delivered 2026-09-16, branch `calculs/final` (28010d4a, develop 538fbe4b merged), at the Validateur

- M1 foundation + M2 volumes + M3a hierarchy/camera in `sdk-core/math*.ts`; M3b per-frame WebGPU path without Three (`EngineCamera` in `cameraWorld.ts`, held by `frameGateCore.ts` as `gate.cam`: `world`, `projection` copied once per frame from the host camera, `view`, `viewProjection`, `planes`, `eye`, `depthZeroToOne`; one view-projection instead of nine; zero allocation per frame); M4a loading/explorer (`hostWorldMatrices.ts`, `hostWorldBounds.ts`, flat bounds, `hslToLinearRgb`); lot 3 diagnostics without Three, `HostCamera` alias in `backendTypes`; lot 4 `visibilityShadingNormal.ts` on the foundation (`normalizeVector3`, `applyMatrix3Vector3`, `transformDirectionVector3`, `addScaledVector3`…).
- Decisions: the per-frame public API takes `EngineCamera` and refuses a raw host camera (converting there would put an inverse and six planes back per frame and hide an unresolved rig); `addInstance/updateInstance(transform: THREE.Matrix4)`, `PageRec.matrix`, `ClusterRoot.world`, `explorer.bounds/center` stay host-written objects (R8), read once into flat buffers, never computed with.
- Closed list of `three` importers in `sdk-browser` (137 → 98): `test/engineNoThree.test.mjs` (witness engines, host boundaries, test rigs, host resources, each with a reason; a dead entry fails) and `test/engineNoThreeMath.test.mjs` (no Three math method on the loading/explorer perimeter; the engine reads the host matrix, never computes with it).
- Proof: bit-identical benches (`socle-math` 24/24, `volumes` 13/13, `hierarchie` 4/4, `normale` 42 002 cases), `npm test` 1214, `check:changed` 1062, `test:gpu` 23/23 (`LAB_ROOT`), common bench WebGPU emerald-square 3 views × 2 thresholds, moving camera, 60 frames: 0/921 600 px before/after and A/A, identical cut, 0 holes. `gpuSelectionFallback` is not in `mesure.json` yet.
- Next: M5 (worker/Wasm only where a calm measurement shows a cost), then R7/R8 (WebGL2 renderer, host API without Three types). `visibilityShadingNormal` and `pageRaster`/`gpuDagOracleMath` remain CPU witnesses walking the host graph.

# Calculateur — handoff

Confirm title `Calculateur` with `get_session("self")`. Follow `AGENTS.md`; plan: `SPEC_MOTEUR_SANS_THREE.md`, R1a–R1f. Status below is the 2026-09-15 handoff, not fresh verification.

## Workflow

- Opus: code/reproductions/benchmarks; Sonnet: tests; Haiku: campaigns. Worktree from `develop`; never stash or push.
- Only Validateur runs `validate`, merges and pushes. Deliver head + merge-base against recent develop, tests, `check:changed`, and `scripts/mesure/banc.mjs`: WebGPU three views + `--camera-mobile`, WebGL generale, `--pixelError 0,1`. No waiting beforehand.
- M batches (without Three): bit-identical to Three, including parent/child transforms. Run equivalence then comparative bench: Three ns, ours ns, ratio, gain %, pass/fail. Equivalence preserves old bugs; it is not correctness proof.
- Bug fixes: reproduce first on CPU and **executed GPU** (Chromium WebGPU, `LAB_ROOT`); add correctness test, run campaign, explain image changes. Name the comparison behind every “0 difference”; replay supplied counterexamples before concluding.

## M batches

- M2 volumes merged. M1 foundation: `calculs/m1-socle` 2355e89, delivered/unmerged.
- M3a hierarchy: `calculs/m3a-hierarchie` 594b97b (`agent-a96ed1f…`), rebase after M1.
- Next: flat-buffer 4×4 product, M3b, M4, M5. Three calls: `git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`, T1.

## September 15 audit fixes

Agents stopped by user; committed WIP remains unverified unless stated.

1. Small-scale cone: **merged/pushed**, 948aa29.
2. `setTransform` loses shear (`webgpuPagesTransform.ts`): not started; waits for M1.
3. Off-axis screen error (`projectionOracles.ts:142`): `fix/defaut3-erreur-ecran` bebdba6 (`agent-a0b556ff…`), WIP. Bound all directions, depth/near plane; measure triangle/time cost; rebase.
4. Mirrored repeat: `fix/defaut4-miroir` 1558d04, tests WIP d1470bb (`agent-adb78848…`). Oracle = GPU texel 2, not `transformUv` texel 3. Campaign 0 px but no mirrored content. Tests, rebase, campaign remain.
5. Parented camera: `fix/defaut5-camera` 2ef1171 + WIP c7f2324 (`agent-a9ca1348…`); 14 sites, CPU 13/14 → 0, GPU 8/12 → 0, campaign 0 px. Tests, rebase (`pageSelectionCut*`, `hiz*`), campaign remain.
6. WGSL `inverseTranspose3` threshold `1e-20`: `repro/defaut6-inverse-transposee` 7211fd6 (`agent-a701ed76…`), not run. Prove whether visible faces are removed against true orientation; fix in this wave if confirmed.
7. Linear-filter `Repeat` seam: 180 differences, found by batch 4; awaits user.
8. GPU ignores per-map repeat mode: found by batch 4; awaits user.

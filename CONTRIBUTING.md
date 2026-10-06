# Contributing to Trillion3D

## The mission

- **Virtualized geometry for the web** (streamed clusters, one DAG cut per frame, visibility buffer,
  TAA, fixed budgets) at the best desktop engines' performance; end goal, real-time dynamic global
  illumination, reflections and shadows within the web's limits, by the measured stages of
  `docs/ENGINE.md` § "Lighting: the target and the stages".
- **A perfect image, then the frame rate**, on web and native: 60 fps at least, 120 at most needed,
  at the screen's resolution and pixel ratio (up to 4K); an open world crossed without a hitch, a
  pop or a hole.
- **Never copy another engine's code, shaders or assets.** Other engines are named only in a
  measurement or comparison table.
- **Parity**: fixed memory and millisecond budgets, residency driven by what the frame reads,
  compression at cook time, no work in a still scene.

## Measure before optimising

- Same input, camera, quality and budgets: image and performance equal or beat the three.js
  witness. A measured regression reopens its issue in 🔴, never holding a merge.
- **Never optimise an unmeasured path**: state its share of the frame on a real scene (the per-step
  CPU profile, the GPU bench), or say it is unknown. A measurement that contradicts a plan wins.
- **Records**: same input, camera, quality, machine, budget, DPR and commit stated; never add CPU
  and GPU times; unmeasured is `null`, never an estimate; before and after interleaved five times at
  least. A per-pass GPU time says _where_, never _how much_: compare frame totals only.
- A pull request proves its change in a minute on the public scene that exercises it
  (`.mesure/assets/`); the full campaign runs once, on the release pull request.
- Outputs go under `.mesure/out/` only (AGENTS.md rule 10); the numbers a claim rests on go in the
  issue's comment.

## Image and fidelity

- No image loss (AGENTS.md rule 1): never a lower displayed resolution or draw distance, never
  transparency turned into masking inside the engine.
- **Two proof classes**, on the pull request's `Image proof class:` line (none declared is class 1):
  1. **Refactor or pure optimisation:** 0 px against `develop`.
  2. **Rendering technique:** within a stated bound of a named reference image (mean and 99.9th
     percentile channel error, mean LDR-FLIP, `bench.ts --reference`), no flicker, trail, hole or
     lost detail.
- A proof needs a stable A/A (0 px); an unstable scene is frozen or replaced. Tolerance: at most
  4 px of A/A on a still capture, isolated to a masked cut-out at the alpha cutoff, declared.

## Streaming, memory and shadows

The rules of #483, for every change to geometry, streaming, memory, shadows or examples:

1. **No hole**: every surface is drawn by the wanted cluster or its nearest resident ancestor.
2. **No image loss**: a still image converges to full detail; coarsening is temporary.
3. **Compiler first**: errors, bounds, cones, page order and roots computed at cook, checked there.
4. **One mechanism per concern**; what a change replaces is deleted in the same pull request.
5. **Fixed budgets, never read from the machine**; out of memory is one level coarser, never a
   crash; a lost device is rebuilt without a reload.
6. **Bounded by the view**, not by the world's size.
7. **Main thread bounded**: decoding, parsing and IO in workers.
8. **WebGL2 is degraded, never broken**.
9. **Proven by a test of the invariant**, on two scenes, one an open world.
10. **Nothing rebuilt every frame**: moving content takes the dynamic or GPU-deformation path.
11. **Examples use the engine**, never a per-frame workaround.

## Code

- Code first, one final test pass, one test per changed behaviour. No dead code (a file or export
  only tests use is dead), no compatibility with abandoned formats, no claim of an unbuilt feature.
- `pnpm run check:changed` is the one local gate (changed-file format, lint, types, lines,
  duplicates, and the unit tests the change can affect); the CI runs all of `validate`.
- Everything in English. Tests, scripts, site, bench and Rust: 200 lines a file at most; runtime
  modules: no function over 60 lines or a complexity of 20. No duplicated block, no copied helper.
- Generic engine: no scene names, no constant tuned on a measurement scene (every value derives
  from what the object carries, or is declared); the engine never reads `site/` or another project.
- Platform APIs (DOM, filesystem, React, Vite) stay out of the core contracts. `formatVersion`
  apart from `compilerVersion`; unknown formats and incompatible caches refused.
- Build outputs are untracked, except the WebAssembly modules: a change under
  `packages/page-codec-wasm` or `packages/physics-jolt-wasm` rebuilds and commits them.
- Every browser is the system Chrome through `launchChrome`, never `chromium.launch`.
- Personal tools, prompts, indexes and settings stay untracked (`pnpm run check:local`); nothing in
  the workflow requires an assistant.

## Contribution workflow

1. Claim the issue (`in progress`, assignee `pasquelin`); branch `<issue>-<name>` from
   `origin/develop` in `.worktrees/<branch>/`, `pnpm install`.
2. Deliver every To-do and Proof item, nothing beyond.
3. Review the whole diff twice: simplification, then correctness against these rules; then
   `pnpm run check:changed` once on the final head.
4. Commit in English, push, add `in review`. Body from `.github/PULL_REQUEST_TEMPLATE.md`,
   `Closes #<issue>` first.
5. Open the pull request, auto-merge on (AGENTS.md rule 11), "Verification" filled: one line per
   To-do and Proof item, `- <item>: delivered in <file:line>, proved by <test>` (the CI checks it).
6. Merged: remove the worktree and branch, set the labels below, check the issue is closed.

**Labels.** Priority `🔴 critical` … `🟢 low`; `in progress` (claimed); `in review` (pushed);
after the merge `to audit`, `to measure` (unless the diff cannot move the frame cost: docs, tests,
scripts, `.github/`, `skills/`, site text), `measuring`, then the recette's `audited` / `audit ko`
and `measure ok` / `measure ko`. On merge, remove `in progress`, `in review`, the assignee and old
verdicts. A ko reopens its issue (`🔴 critical` for frame cost, `🟠 high` otherwise), its comment
starting with the cause (promise, tests, paperwork or design).

**Release** `develop` → `main`: on the boss's word only, its own issue and pull request, when no
issue carries `to audit`, `to measure`, `audit ko` or `measure ko`. Its merge publishes the site
(`pages.yml`) and packs the npm packages (`release.yml`; real publication when `NPM_PUBLISH` is
`true`).

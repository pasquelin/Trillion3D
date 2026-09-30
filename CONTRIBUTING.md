# Contributing to Trillion3D

## The mission

- **Virtualized geometry for the web** (clusters streamed, one DAG cut per frame, a visibility
  buffer, TAA, fixed streaming and memory budgets) at the best desktop engines' performance, from
  the published literature; at each trade-off, what the state of the art has proven. Those engines
  are points of comparison for the numbers only. **End goal, the whole image:** real-time dynamic
  global illumination, reflections and shadows at that performance, within the web's limits (no
  hardware ray tracing, bounded unreadable GPU memory, one browser frame), by measured stages in
  `docs/ENGINE.md` § "Lighting: the target and the stages"; a stage out of order is not out of scope.
- **A perfect image, then the frame rate**, the same on web and native: 60 fps at least, never
  needing more than 120, at the screen's resolution and pixel ratio (up to 4K); a lower internal
  resolution only when the TAA image proof shows no loss; an open world opens and is crossed without
  a hitch, a pop or a hole.
- **Never copy another engine's code, shaders or assets**, not one line (licence-covered);
  reimplement from papers, talks, documentation, observed behaviour. Third-party engines and feature
  names are trademarks: only as a benchmark in a measurement or comparison table, never in a mission
  statement, tagline, badge, package name or anything presenting this project as a port or clone.
- **Parity**, never a pixel count: fixed memory and millisecond budgets, residency driven by what
  the frame reads, compression at cook time, no work in a still scene. Missing one is not parity.

## Measure before optimising

- With identical input, camera, quality and budgets, image and performance equal or exceed the
  Three.js witness. A measured regression reopens its issue in 🔴, never holding a merge; noise is no
  exemption, an unmeasured metric never evidence of parity.
- **Never optimise an unmeasured path.** State its share of the frame on a real scene, or say it is
  unknown; a batch justified by a supposition is stopped. Rank the largest costs with the per-step
  CPU profile (`packages/sdk-browser/src/webgpu/pages/render/cpuSteps.ts`, `cpu-timing` diagnostic)
  and the bench (`bench/runner/bench.ts`, `bench/runner/README.md`): repeated small calculations,
  allocations in a frame, a JavaScript kernel that belongs in Rust or WebAssembly, work the compiler
  could bake once. A measurement that contradicts a plan wins; the plan is fixed in the same batch.
- **Records:** same input, camera, quality, machine and budget; DPR, error threshold, resolution,
  commit; FPS = 1000 / rAF interval, display cap stated. Never add CPU and GPU times. Unmeasured =
  `null`, never an estimate. Diagnostics outside measured beauty passes; unsupported capabilities
  reported. Interleave before and after at least five times (a busy machine biases otherwise);
  publish the run-to-run spread when a claim rests on a smaller difference.
- A per-pass GPU duration says _where_, never _how much_: tile-based GPUs overlap passes and a
  pass's timestamp absorbs its neighbours' work (17 Sept. 2026: an unchanged composition pass read
  7 ms with the sun, 2.4 ms without). A difference between runs is read on the frame envelope, the
  total, only.
- **Two scales of proof.** A pull request proves its change in seconds to a minute on the public
  scene that exercises it under `.mesure/assets/` (Khronos samples, the generated facade;
  `bench/runner/assets.ts` fetches and compiles them). The full campaign (every view and scene,
  spread, envelope) runs once, on the release pull request `develop` → `main`, and is what is
  published; the site keeps the latest report, each image stored once.
- **After the merge** (AGENTS.md rule 2) issues carry `to audit`, and `to measure` when the diff can
  move the frame cost, until the recette's verdicts (labels per `skills/t3d-cto/SKILL.md`). `main`
  moves only when no issue carries `to audit`, `to measure`, `audit ko` or `measure ko`. A pull
  request carries the gates.
- Outputs go under `.mesure/out/<issue>/` only (AGENTS.md rule 10); the numbers and any capture a
  claim rests on go in the issue's comment.

## Image and fidelity

- No image loss (AGENTS.md rule 1), declared or not: an optimisation that degrades the image is
  refused, even measured and declared, unless it holds its class's proof below or this section's
  tolerance. Sole exception: fluids lower their own quality automatically to hold their budget, and
  say so in their diagnostics.
- Never reduce the displayed resolution or the draw distance (lower internal resolution only under
  the mission's bar); never convert transparency to masking **inside the engine** (the compiler
  reclassifies a material wrongly declared blended at import).
- **Two proof classes**, on the pull request's `Image proof class:` line (none declared is class 1):
  1. **Refactor or pure optimisation:** 0 px against `develop` (and `tri = selected`), no discussion.
  2. **Rendering technique** (temporal upscaler, radiance cache, cached shadow pages, f16 or wave
     intrinsics): within a stated bound of a named reference image — mean and 99.9th-percentile
     channel error and mean LDR-FLIP (`bench/runner/flip.ts`), by
     `bench/runner/imageDiff.ts::referenceDiff` (`bench.ts --reference`, against the references
     `bench/references/` names, drawn off git into `.mesure/references/`) — and no flicker, trail,
     hole or lost detail on still and moving captures.
- **A proof needs a stable A/A** (0 px, or the exception below); a broad spread proves nothing. An
  unstable scene is first frozen (clock, frame) or replaced by a stable one on the same path.
  `health-check` is exempt until #1321 makes it stable: its proof is no error, pages drawn, its
  verdict.
- **At most 4 px of A/A on a still capture** is accepted when isolated to a masked cut-out at the
  alpha cutoff, below human discrimination at the capture resolution, and declared (GPU
  keep/discard on one foliage pixel, not a residency, shadow-page or TAA bug). A hash replacing the
  cutoff that explodes A/A is refused (#25).

## Streaming, memory and shadows

The rules of #483, binding on every change to geometry, streaming, memory, shadows or examples:

1. **No hole, ever**: every surface of every frame is drawn by the wanted cluster or its nearest
   resident ancestor.
2. **No image loss**: a still image converges to full detail (A/A 0 px); coarsening is temporary,
   one DAG level at a time.
3. **Compiler first**: errors, bounds, normal cones, page dependencies and order, world-scale roots
   are computed at cook, and the cook refuses a result that breaks an invariant.
4. **One mechanism per concern** (one cut rule, residency cache, request queue, memory budget); what
   a change replaces is deleted in the same pull request.
5. **Fixed budgets, never read from the machine**, one global memory budget; out of memory is one
   level coarser, never a crash; a lost device is rebuilt without reloading the page.
6. **Bounded by the view**, not by the world's size.
7. **Main thread bounded**: decoding, parsing and IO in workers.
8. **WebGL2 is degraded, never broken**: same rules, declared missing features, no hole.
9. **Proven by a test of the invariant**, on two scenes, one of them an open world.
10. **Nothing is rebuilt every frame**: no recut, re-hash or session reopen for moving content; it
    takes the dynamic or GPU-deformation path.
11. **Examples use the engine**, never a per-frame workaround for a missing feature.

## Quality and evidence

- Code first; one final test pass, one test per changed behaviour. No dead or deprecated code,
  abandoned-format compatibility or claim of an unimplemented feature. A differential test against a
  frozen oracle proves only what the sides do differently; shared code is proved directly.
- **pnpm.** `pnpm run check:changed` is the one local gate: changed-file format, lint, types, lines
  and duplicates, and the unit tests the change can affect — its domain folder's and those that
  really use it (`scripts/affected-tests.ts`); a documentation, site image or translation change runs
  only the gates and the unit tests that read those files (`scripts/docs-tests.ts`). Its test run is
  capped to two processes (`TRILLION3D_TEST_CONCURRENCY`), and every heavy local step (a test run,
  `build`, `build:docs`, `build:native`, `compile:caches`) waits for the other worktrees' and runs at
  low priority (`scripts/heavy-lock.ts`). Inspect dependants after deletions, public-export or
  configuration changes.
- Before merge the CI runs the whole `pnpm run validate` (format, JS/TS lint + Clippy, unused
  code/files/dependencies, TS/native builds, structure, declarations, links, JS/TS/Rust tests),
  sharded; it is the CI's, not a local gate. A documentation-only pull request skips its code jobs,
  runs the tests that read documentation in `quick`, and still reports `validate`.
- **Everything in English**: comments, docstrings, documentation, commit messages, test names.
- Every maintained JS/TS/Rust source file, variants included, fits 200 physical lines, no legacy
  exception; split by responsibility, keep public contracts (`pnpm run check:lines`).
- `pnpm run check:duplicates` rejects blocks ≥8 lines and ≥64 tokens across TS/TSX/Rust,
  `pnpm run check:helpers` a small helper copied (name, signature, body) into a second module of the
  same package or crate. Resolve every finding; share logic only for identical behaviour.

## Engine and package boundaries

- Generic engine: no scene names, hardcoded lights/cameras or object-type special cases; imported
  material/light properties; one lighting model for opaque and transparent, one reflection model.
  Benchmark fixes generalize to any imported scene.
- **No constant tuned on a measurement scene**: scenes prove, never tune. Every algorithmic value
  derives from what the object carries (texture dimensions, attribute amplitude, triangle density,
  the screen unit) and holds on an unmeasured model; compared errors share one unit, the screen
  pixel. A value that cannot be derived is declared, with what it stands for and its sensitivity.
  Proof on two scenes, one never tuned on.
- **Self-contained**: builds, tests, measures and proves itself with its own dependencies
  (`pnpm install`), the machine's Chrome and its own assets (`.mesure/assets/`, off git). Nothing
  reads another project on disk (no neighbour path, no external harness); no host code to make the
  engine work, no writing into a host's folders. Every browser, a scratch harness's included, is
  the system Chrome opened by `launchChrome` (`bench/runner/chrome.ts`), never `chromium.launch`:
  Playwright's own headless shell loses the WebGPU device after the first frame (#1364).
- React/Electron/Vite, DOM and platform filesystem APIs stay out of runtime-core/shared contracts
  (use adapters); consume public entry points, never application internals. Generic Rust
  library/CLI code lives in `packages/`, never numbered benchmarks.
  `tests/integration/engine-structure.test.ts` checks core/adapter boundaries;
  `pnpm run check:structure` type-checks sdk-core without DOM.
- Separate `formatVersion` from `compilerVersion`; reject unknown formats and incompatible caches;
  compiler/cache-identity changes need correctness fixtures and source provenance; never overwrite
  source assets.
- Bound workers and allocations for constrained machines (admission estimates are not enforced RSS
  limits). New stages: versioned contracts, bounded cancellation, observable work, explicit failure
  semantics. Algorithms in libraries, not CLI/UI.
- **Build outputs (`dist/`, bundles, binaries) are untracked, except the WebAssembly modules**
  (`pageCodec.wasm`, `joltPhysics.wasm`, `joltPhysicsThreads.wasm`): their toolchains (Rust `wasm32`
  with LLVM tools; emscripten, CMake, Ninja, the Jolt submodule) are not in `pnpm install`, yet the
  unit suite, site build, npm package and every checkout read them, all on the same bytes. So a
  change under `packages/page-codec-wasm` or `packages/physics-jolt-wasm` rebuilds them
  (`build:wasm`, `build:physics`) and commits the result in the same pull request.

## Native compiler (`packages/asset-compiler-rust`)

- Thin CLI; library algorithms behind versioned strategy/stage contracts. Preserve triangle/material
  identity, validate every persisted cache entry, keep golden fixtures and raw before/after timings.
- Never claim undelivered simplification, compression, hard memory enforcement, N-API bindings or
  platform releases.

## Personal tools stay local

`AGENTS.md` is tool-neutral; the shared skills and agents in `skills/` are aliased into the local
`.claude/` by `pnpm install` (`pnpm run skills:link`, `docs/COMPANY.md`). Nothing in the workflow
requires them or any personal assistant or indexing tool; tool commands named here (`/simplify`) are
optional aids, and no doc, configuration, script, commit message or template may require one.
Personal instructions, prompts, generated knowledge indexes and local settings stay untracked.
The local-files section of `.gitignore` lists them: never force-add; `pnpm run check:local` (in
validation) rejects tracked files it covers; shared checks skip them. Personal helper scripts stay
outside maintained source folders. Back up a previously tracked personal file outside the checkout
before removing it: pulling the deletion removes it in other checkouts.

## Contribution workflow

The rules are AGENTS.md's; this is the procedure.

1. One issue per batch (AGENTS.md rule 5): branch `<issue>-<short-name>` from `origin/develop` in
   `.worktrees/<branch>/` (ignored by git and every tool), `pnpm install`, logs and throwaway files
   in `.worktrees/logs/`; mark the issue `in progress`.
2. Implement it and record its proof, nothing beyond the batch.
3. Review the diff twice: simplify (with Claude Code, `/simplify`; otherwise read the whole diff for
   what is duplicated, needless or at the wrong depth), then correctness against these rules. Fix;
   then `pnpm run check:changed`, the one local gate, runs once on the final head (the reviewer,
   `skills/agents/reviewer.md`); the CI runs all of `validate`.
4. Commit in English, push. The required `pr-body` check (`scripts/check-commit-identity.ts`)
   refuses, naming each hash, a tool identity (author or committer), a `Co-authored-by:` or
   `Generated` trailer, a "Generated with …" footer or a tool session link (AGENTS.md rule 9). Write
   the body in a file from `.github/PULL_REQUEST_TEMPLATE.md`, `Closes #<issue>` first, both passes'
   findings under "Local review before push". Add `in review` (`in progress` stays to the merge).
5. After an independent review, findings resolved, open the pull request (AGENTS.md rule 11) with
   "Lead verification": one line per To-do and Proof item, each Proof line quoted or under
   "Not proven" with the boss's yes (the CI checks it). It merges into `develop` once `validate` is
   green on a head that merged `develop` and merges cleanly. `main` moves only on the maintainer's
   word. Never push to `develop` or `main`, never rewrite published history.
6. After merge: remove the worktree and branch; labels per `skills/t3d-cto/SKILL.md` (set by the
   lead, `skills/agents/lead.md`). `Closes #n` acts only on `main`, so
   [`close-issues.yml`](.github/workflows/close-issues.yml) closes as completed, with a comment
   linking the pull request, each issue a body merged into `develop` names with a closing keyword;
   check it is closed.

A release `develop` → `main`: its own issue and pull request, head `develop` (no release branch),
the same template and `Closes #<issue>` first (it delivers its whole issue), the reviewed pull
requests named under local review, then validation and maintainer approval. Nothing built is
committed: `.github/workflows/pages.yml` builds the site from `main` (`site/` sources, `dist/site/`
output) and deploys it, so a change is published only after its release merges. The same merge runs
`.github/workflows/release.yml`: the five compilers built, `trillion3d` and its compiler packages
packed at one version, those archives proved installed on macOS, Linux and Windows, then the six
publications dry-run. The real npm publication, through Trusted Publishing and no token, waits for
the maintainer's switch, the repository variable `NPM_PUBLISH` set to `true`; `private` stays `true`
in the repository.

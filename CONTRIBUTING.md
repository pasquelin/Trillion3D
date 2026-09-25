# Contributing to Trillion3D

## The mission

- **Build virtualized geometry for the web, at the performance of the best desktop engines.**
  Geometry streamed by clusters, one cut through a DAG per frame, a visibility buffer, temporal
  antialiasing for the image, fixed streaming and memory budgets. The techniques come from the
  published literature (papers, talks, documentation); the desktop engines that ship them are
  **points of comparison for the numbers**, nothing more. At every trade-off, take the solution the
  published state of the art has proven.
- **The end goal is the whole image, not only the geometry: real-time dynamic global illumination,
  reflections and shadows, at that same performance, rebuilt for the web's constraints (no hardware
  ray tracing, bounded and unreadable GPU memory, one browser frame).** The geometry, the temporal
  antialiasing and the memory budgets are the foundation; the lighting is what they are for. It is
  reached by stages, each measured, and the strategy lives in `docs/ENGINE.md` § "Lighting: the target and the stages".
  A stage that is out of order is not out of scope.
- **The bar, in this order: a perfect image, then the frame rate.** The same engine runs on the
  web and in a native application, with the same image in both. A frame holds 60 fps at the least
  and never needs more than 120, at the screen's own resolution and pixel ratio (up to 4K); a
  lower internal resolution is allowed only when temporal reconstruction makes the image proof
  show no loss; an open world opens and is crossed without a hitch, a pop or a hole.
- **Never copy another engine's code, shaders or assets into this repository.** Not one line, ever.
  Commercial engines are not open source and their sources are licence-covered; reimplement from
  public material only — papers, talks, documentation, observed behaviour. Third-party engines and
  their feature names are trademarks of their owners: they may be cited as a benchmark in a
  measurement or a comparison table, never in a mission statement, a tagline, a badge, a package
  name or anything that presents this project as a port or a clone of them.
- Parity means four things, and none of them is a pixel count: fixed memory and millisecond budgets,
  residency driven by what the frame actually reads, compression at cook time, no work in a still
  scene. A batch that misses these has not reached the reference, however good it looks.

## Measure before optimising

- Under identical input, camera, quality and budgets, image quality and performance must equal or
  exceed the Three.js witness. Any measured regression blocks validation and merge. Measurement
  noise is not an exemption, and an unmeasured metric is never evidence of parity.
- **Every millisecond counts, measured.** The frame's largest costs are ranked on a real scene
  (`docs/roles/measurer.md` step 8): small calculations repeated per frame or per page,
  allocations in a frame, a JavaScript kernel that belongs in Rust or WebAssembly, work the
  compiler could bake once.
- **Never optimise a path whose cost is not measured.** State its share of the frame first, on a real
  scene, or say plainly that it is unknown. A batch justified by a supposition is a batch to stop.
- Measure the whole frame before a part of it: the engine publishes a per-step CPU profile
  (`packages/sdk-browser/src/webgpu/pages/render/cpuSteps.ts`, `cpu-timing` diagnostic) and the repository has its own bench
  (`bench/runner/bench.ts`, README alongside). Read them before choosing a target.
- When a measurement contradicts a plan, the measurement wins, and the
  plan is corrected in the same batch.
- Compare identical input, camera, quality, machine and resource budget. Record DPR, error threshold,
  resolution and commit. FPS = 1000 / rAF interval; state display cap. Never add CPU and GPU times.
  Unmeasured values = `null`, never estimates presented as measurements. Keep diagnostics outside
  measured beauty passes; report unsupported capabilities. Measure on a quiet machine, and publish
  the run-to-run spread whenever a claim rests on a difference smaller than it.
- **Two scales of proof.** A pull request proves its change on the public test scenes under
  `.mesure/assets/` (Khronos sample models, the generated facade; `bench/runner/assets.ts` fetches
  and compiles them), on the scene that exercises the change, in seconds to a minute. The full
  campaign — every view, every scene, the run-to-run spread, the frame envelope — runs once, on the
  release pull request from `develop` to `main`, and its numbers are the ones published. The site
  keeps one report, the latest, each image stored once.
- **One measuring queue per machine.** Browser proofs, GPU probes and benchmarks never run
  concurrently: two Chrome instances pollute each other's numbers and saturate the machine. They
  run one at a time, in one queue, on merged batches, and never block a pull request: the issue
  closes at merge labelled `to measure`, the queue measures it against the merge's first parent
  and comments the numbers (`measure ok`); a regression reopens the measured issue, labelled
  `measure ko`, with the numbers in a comment. A pull request carries the fast gates and names its proof.
- **A campaign's outputs are deleted once published.** A cook, a bench or a proof writes under
  `.mesure/out/<batch>/` and nowhere else; the numbers, and any capture a claim rests on, go into
  the pull request body, and the folder is removed before the pull request is opened.
- A per-pass GPU duration says _where_, never _how much_: on tile-based GPUs passes overlap and a
  pass's timestamp absorbs its neighbours' work (17 Sept. 2026: a composition pass read 7 ms with
  the sun and 2.4 ms without, having not changed). The frame envelope is the total; a difference
  between two runs is read on the envelope only.

## Image and fidelity

- Never reduce the displayed resolution or the draw distance (a lower internal resolution only
  under the mission's bar). Never convert transparency to masking **inside the engine**: a source
  material wrongly declared blended is reclassified by the compiler at import.
- `0 px`, `tri = selected` and A/A noise stay the default proof for geometry and lighting. A batch
  that keeps them owes no discussion.
- **At most 4 px of A/A on a still capture is accepted** when it is isolated to a masked cut-out at
  the alpha cutoff, below human discrimination at the capture resolution, and declared in the batch.
  That is GPU keep/discard on the same foliage pixel, not a residency, shadow-page or TAA bug.
  Replacing the cutoff with a hash that explodes A/A is refused (#25).
- **No image loss, declared or not.** An optimisation that degrades the image is refused, even
  measured and declared: it holds the default proof above, or the tolerance this section names, or
  it does not merge. Sole exception: fluids may lower their own quality automatically to hold their
  budget, and say so in their diagnostics.

## Streaming, memory and shadows

The rules of #483, binding on every change to geometry, streaming, memory, shadows or examples:

1. **No hole, ever.** Every surface of every frame is drawn by a resident representation of
   itself: the wanted cluster or its nearest resident ancestor.
2. **No image loss.** A still image converges to full detail (A/A 0 px); coarsening is temporary,
   one DAG level at a time.
3. **Compiler first.** Errors, bounds, normal cones, page dependencies and order, world-scale roots
   are computed at cook, and the cook refuses a result that breaks an invariant.
4. **One mechanism per concern**: one cut rule, one residency cache, one request queue, one memory
   budget. What a change replaces is deleted in the same pull request.
5. **Fixed budgets, never read from the machine**, one global memory budget; out of memory is one
   level coarser, never a crash; a lost device is rebuilt without reloading the page.
6. **Bounded by the view**, not by the world's size.
7. **Main thread bounded**: decoding, parsing and IO in workers.
8. **WebGL2 is degraded, never broken**: same rules, declared missing features, no hole.
9. **Proven by a test of the invariant**, on two scenes, one of them an open world.
10. **Nothing is rebuilt every frame**: no recut, re-hash or session reopen for moving content;
    it takes the dynamic or GPU-deformation path.
11. **Examples use the engine**, never a per-frame workaround for a missing feature.

## Quality and evidence

- Code first; one final test pass, one test per changed behavior. No dead/deprecated code,
  abandoned-format compatibility or claims of unimplemented features.
- A differential test against a frozen oracle proves only what the two sides do differently. Where
  they share code, prove it directly.
- **This repository uses pnpm.** `pnpm run check:changed` checks changed-file format, lint, lines,
  duplicates and import-related unit tests; `pnpm run test:changed` runs only those tests. Also
  inspect dependants after deletions, public-export or configuration changes.
- Before merge: `pnpm run validate` (format, JS/TS lint + Clippy, unused code/files/dependencies,
  TS/native builds, structure, declarations, links, JS/TS/Rust tests). The browser proof follows
  the merge, in the measuring queue.
- **All wording in the repository must be in English.** Comments, docstrings, documentation,
  commit messages and test descriptions are strictly written in English.
- Every maintained JS/TS/Rust source file, including variants, must fit 200 physical lines; no legacy
  exceptions. Split by responsibility, preserve public contracts. Gate: `pnpm run check:lines`.
- `pnpm run check:duplicates` rejects blocks ≥8 lines and ≥64 tokens across JS/TS/Rust, and
  `pnpm run check:helpers` a small helper copied, name, signature and body alike, into a second
  module of the same package or crate. Resolve every finding before integration; share logic only
  for identical behavior.

## Engine and package boundaries

- Generic engine: no scene names, hardcoded lights/cameras or object-type special cases. Use imported
  material/light properties; one lighting model for opaque and transparent surfaces, one reflection
  model for reflective surfaces. Benchmark fixes must generalize to any imported scene.
- **No constant is chosen by sweeping a measurement scene.** Benchmark scenes prove, they never
  tune. Every algorithmic value is derived from what the imported object carries — texture
  dimensions, attribute amplitude, triangle density, the screen unit — and must hold on a model
  nobody has measured. Two errors compared are converted to the same unit, the screen pixel. A value
  that cannot be derived is declared as such, with what it stands for and its sensitivity. Proof
  runs on two scenes, one of which was never tuned on.
- **This repository is self-contained.** It builds, tests, measures and proves itself with only its
  own dependencies (`pnpm install`), the machine's Chrome and its own assets (`.mesure/assets/`, off
  git). No code, script, test or doc may read another project on disk — no neighbour path, no
  external harness. Every test, visual proof and benchmark runs on the repository's own standalone
  tools. Never add host code to make the engine work, never write into a host's folders.
- Keep React/Electron/Vite, DOM and platform filesystem APIs out of runtime-core/shared contracts;
  use browser/filesystem adapters. Consume public entry points; packages never import application
  internals.
- All generic Rust library/CLI code belongs in `packages/`, never numbered benchmarks.
  `tests/integration/engine-structure.test.ts` checks core/adapter boundaries in the unit suite;
  `pnpm run check:structure` type-checks sdk-core without DOM.
- Separate `formatVersion` from `compilerVersion`; reject unknown formats and incompatible caches.
  Compiler/cache-identity changes require correctness fixtures and source provenance. Never overwrite
  source assets.
- Bound workers and allocations for constrained machines; admission estimates are not enforced RSS
  limits. New stages need versioned contracts, bounded cancellation, observable work and explicit
  failure semantics. Algorithms belong in libraries, not CLI/UI.

- **Compiled build outputs (`dist/`, bundles, binaries) are not tracked, with one exception: the
  WebAssembly modules** (`pageCodec.wasm`, `joltPhysics.wasm`, `joltPhysicsThreads.wasm`). Their
  toolchains — the Rust `wasm32` target with LLVM tools, and emscripten, CMake, Ninja and the Jolt
  submodule — are not installed by `pnpm install`, yet the unit suite, the site build, the npm package and every
  checkout read the modules. Tracking them keeps the repository self-contained and makes every
  consumer run the same bytes. The cost is staleness, so a change to their sources
  (`packages/page-codec-wasm`, `packages/physics-jolt-wasm`) rebuilds them (`build:wasm`,
  `build:physics`) and commits the result in the same pull request.

## Native compiler (`packages/asset-compiler-rust`)

- Thin CLI; library algorithms behind versioned strategy/stage contracts. Preserve triangle/material
  identity, validate every persisted cache entry, retain golden fixtures and raw before/after timings.
- Never claim undelivered simplification, compression, hard memory enforcement, N-API bindings or
  platform releases.

## Personal tools stay local

The agent rules (`AGENTS.md`) and the agent roles (`docs/roles/`) are tool-neutral and tracked.
The company's shared assistant skills and agents are tracked in `skills/` and aliased into the
local `.claude/` by `pnpm install` (`pnpm run skills:link`, see `docs/COMPANY.md`); nothing in the
workflow requires them, and `.claude/` itself stays local.
Personal assistant instructions, prompts, generated knowledge indexes and local tool settings
must remain untracked. The shared setup, validation and contribution workflow must work without
any personal assistant or indexing tool. Do not introduce such requirements in documentation,
configuration, scripts, commit messages or pull-request templates.

The local-files section in `.gitignore` defines the excluded paths. Keep those exclusions in place;
never force-add their contents. `pnpm run check:local`, also run by validation, rejects tracked
files covered by `.gitignore`. Shared checks exclude ignored local files. Keep personal helper
scripts outside maintained source folders when they are not already covered by that policy.
Before removing a previously tracked personal file, back it up outside the checkout and preserve
its contents locally. Pulling a deletion can remove a previously tracked copy in another checkout.

## Contribution workflow

1. Work from one issue per batch; only the CTO, the maintainer's agent, opens issues (AGENTS.md
   rule 5). Create a branch named `<issue>-<short-name>` from `origin/develop` in an isolated
   worktree under `.worktrees/<branch>/` (ignored by git and by every tool), then run
   `pnpm install`. Logs and throwaway files go in `.worktrees/logs/`. Mark the issue `in progress`.
2. Implement the issue and record the relevant proof. Keep changes limited to the batch.
3. Review the diff twice: first simplify duplicated or unnecessary work — in Claude Code
   `/simplify`, elsewhere a read of the whole diff for what is duplicated, needless or at the wrong
   depth —, then check correctness against the requirements above. Fix findings and run
   `pnpm run check:changed`, `pnpm run test:changed` and `pnpm run validate`. Name the browser proof in the issue; the
   measuring queue runs it after the merge.
4. Commit with a descriptive English message. Open a draft pull request targeting `develop`, using
   `.github/PULL_REQUEST_TEMPLATE.md` and beginning with `Closes #<issue>` when it delivers every
   To-do item, `Part of #<issue>` otherwise (the remainder is a comment on the issue, which stays
   open). Describe what both
   local review passes found under "Local review before push". Replace `in progress` with `in review`.
5. Obtain an independent review and resolve its findings before integration. The maintainer, or
   whoever the maintainer entrusts with it, merges into `develop` once the review holds, the pull
   request is out of draft (`gh pr ready`, after which the body check asks for its "Lead
   verification" section, one line per To-do and Proof item) and `validate` is green on a head
   that merged `develop` and merges cleanly into it, oldest pull request first (AGENTS.md rule
   11); `main` moves only on the maintainer's word. Never push directly to `develop` or `main`, or
   rewrite published history.
6. After merge, remove the worktree and merged branch, remove `in review` and close the issue;
   an engine batch is labelled `to measure` first. Every merge into `develop` is then re-read
   against this file; a finding reopens the issue, labelled `audit ko`, with the findings in a
   comment.
   If a pull request is closed without merging, remove both lifecycle labels; add `in progress`
   only if work resumes.

A release from `develop` to `main` has its own issue and pull request. Its head is `develop`;
no separate release branch is needed. Use the same template and `Closes #<issue>` first line (the release delivers its whole issue),
name the already reviewed implementation pull requests in the local-review section, and wait
for validation and maintainer approval. Nothing built is committed on any branch: the site
workflow (`.github/workflows/pages.yml`) builds the site from `main` (`site/` sources,
`dist/site/` output) and deploys that tree, so a change is published only after that release
merges.

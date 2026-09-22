# Contributing to Web Geometry

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
  reached by stages, each measured, and the strategy lives in `docs/LIGHTING_STRATEGY.md`.
  A stage that is out of order is not out of scope.
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
- **Never optimise a path whose cost is not measured.** State its share of the frame first, on a real
  scene, or say plainly that it is unknown. A batch justified by a supposition is a batch to stop.
- Measure the whole frame before a part of it: the engine publishes a per-step CPU profile
  (`webgpuPagesCpuSteps.ts`, `cpu-timing` diagnostic) and the repository has its own bench
  (`scripts/mesure/banc.ts`, README alongside). Read them before choosing a target.
- When a measurement contradicts a plan, the measurement wins, and the
  plan is corrected in the same batch.
- Compare identical input, camera, quality, machine and resource budget. Record DPR, error threshold,
  resolution and commit. FPS = 1000 / rAF interval; state display cap. Never add CPU and GPU times.
  Unmeasured values = `null`, never estimates presented as measurements. Keep diagnostics outside
  measured beauty passes; report unsupported capabilities. Measure on a quiet machine, and publish
  the run-to-run spread whenever a claim rests on a difference smaller than it.
- A per-pass GPU duration says _where_, never _how much_: on tile-based GPUs passes overlap and a
  pass's timestamp absorbs its neighbours' work (17 Sept. 2026: a composition pass read 7 ms with
  the sun and 2.4 ms without, having not changed). The frame envelope is the total; a difference
  between two runs is read on the envelope only.

## Image and fidelity

- Never reduce resolution or draw distance. Never convert transparency to masking **inside the
  engine**: a source material wrongly declared blended is reclassified by the compiler at import.
- `0 px`, `tri = selected` and A/A noise stay the default proof for geometry and lighting. A batch
  that keeps them owes no discussion.
- **At most 4 px of A/A on a still capture is accepted** when it is isolated to a masked cut-out at
  the alpha cutoff, below human discrimination at the capture resolution, and declared in the batch.
  That is GPU keep/discard on the same foliage pixel, not a residency, shadow-page or TAA bug.
  Replacing the cutoff with a hash that explodes A/A is refused (#25).
- **A pixel cost is not a veto.** When the reference's solution costs image quality — masked foliage
  with a hard silhouette, lossy texture compression — take it, then declare the cost, measure it, and
  publish before/after captures in the batch. What is forbidden is an undeclared loss, not a loss.

## Quality and evidence

- Code first; one final test pass, one test per changed behavior. No dead/deprecated code,
  abandoned-format compatibility or claims of unimplemented features.
- A differential test against a frozen oracle proves only what the two sides do differently. Where
  they share code, prove it directly.
- **This repository uses pnpm.** `pnpm run check:changed` checks changed-file format, lint, lines,
  duplicates and import-related unit tests; `pnpm run test:changed` runs only those tests. Also
  inspect dependants after deletions, public-export or configuration changes.
- Before merge: `pnpm run validate` (format, JS/TS lint + Clippy, unused code/files/dependencies,
  TS/native builds, structure, declarations, links, JS/TS/Rust tests), then browser proof.
- **All wording in the repository must be in English.** Comments, docstrings, documentation,
  commit messages and test descriptions are strictly written in English.
- Every maintained JS/TS/Rust source file, including variants, must fit 200 physical lines; no legacy
  exceptions. Split by responsibility, preserve public contracts. Gate: `pnpm run check:lines`.
- `pnpm run check:duplicates` rejects blocks ≥12 lines and ≥100 tokens across JS/TS/Rust. Resolve
  every finding before integration; share logic only for identical behavior.

## Engine and package boundaries

- Generic engine: no scene names, hardcoded lights/cameras or object-type special cases. Use imported
  material/light properties; one lighting model for opaque and transparent surfaces, one reflection
  model for reflective surfaces. Benchmark fixes must generalize to any imported scene.
- **This repository is self-contained.** It builds, tests, measures and proves itself with only its
  own dependencies (`pnpm install`), the machine's Chrome and its own assets (`.mesure/assets/`, off
  git). No code, script, test or doc may read another project on disk — no neighbour path, no
  external harness. Every test, visual proof and benchmark runs on the repository's own standalone
  tools. Never add host code to make the engine work, never write into a host's folders.
- Keep React/Electron/Vite, DOM and platform filesystem APIs out of runtime-core/shared contracts;
  use browser/filesystem adapters. Consume public entry points; packages never import application
  internals.
- All generic Rust library/CLI code belongs in `packages/`, never numbered benchmarks.
  `test/integration/structure-moteur.test.ts` checks core/adapter boundaries; `pnpm run check:structure` also
  type-checks sdk-core without DOM.
- Separate `formatVersion` from `compilerVersion`; reject unknown formats and incompatible caches.
  Compiler/cache-identity changes require correctness fixtures and source provenance. Never overwrite
  source assets.
- Bound workers and allocations for constrained machines; admission estimates are not enforced RSS
  limits. New stages need versioned contracts, bounded cancellation, observable work and explicit
  failure semantics. Algorithms belong in libraries, not CLI/UI.

## Native compiler (`packages/asset-compiler-rust`)

- Thin CLI; library algorithms behind versioned strategy/stage contracts. Preserve triangle/material
  identity, validate every persisted cache entry, retain golden fixtures and raw before/after timings.
- Never claim undelivered simplification, compression, hard memory enforcement, N-API bindings or
  platform releases.

## Personal tools stay local

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

1. Open one issue per batch. Create a branch named `<issue>-<short-name>` from `origin/develop`
   in an isolated worktree, then run `pnpm install`. Mark the issue `in progress`.
2. Implement the issue and record the relevant proof. Keep changes limited to the batch.
3. Review the diff twice: first simplify duplicated or unnecessary work, then check correctness
   against the requirements above. Fix findings and run `pnpm run check:changed`,
   `pnpm run test:changed` and `pnpm run validate`, followed by relevant browser proof.
4. Commit with a descriptive English message. Open a pull request targeting `develop`, using
   `.github/PULL_REQUEST_TEMPLATE.md` and beginning with `Closes #<issue>`. Describe what both
   local review passes found under "Local review before push". Replace `in progress` with `in review`.
5. Obtain an independent review and resolve its findings before integration. The maintainer
   decides when to merge. Protected-branch checks and CI validation remain required; never push
   directly to `develop` or `main`, or rewrite published history.
6. After merge, remove the worktree and merged branch, remove `in review`, and close the issue
   if the merge into `develop` did not close it. If a pull request is closed without merging,
   remove both lifecycle labels; add `in progress` only if work resumes.

A release from `develop` to `main` has its own issue and pull request. Its head is `develop`;
no separate release branch is needed. Use the same template and `Closes #<issue>` first line,
name the already reviewed implementation pull requests in the local-review section, and wait
for validation and maintainer approval. Nothing built is committed on any branch: the Pages
workflow (`.github/workflows/pages.yml`) builds the site from `main` (`site/` sources,
`dist/site/` output) and deploys that tree, so a change is published only after that release
merges.

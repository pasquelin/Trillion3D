# Web Geometry — agent rules

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
  reached by stages, each measured, and the strategy lives in `docs/SPEC_ENGINE_WITHOUT_THREE.md`
  §8. A stage that is out of order is not out of scope.
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

- **Never optimise a path whose cost is not measured.** State its share of the frame first, on a real
  scene, or say plainly that it is unknown. A batch justified by a supposition is a batch to stop.
- Measure the whole frame before a part of it: the engine publishes a per-step CPU profile
  (`webgpuPagesCpuSteps.ts`, `cpu-timing` diagnostic) and the repository has its own bench
  (`scripts/mesure/banc.mjs`, README alongside). Read them before choosing a target.
- When a measurement contradicts a plan, the measurement wins, and the
  plan is corrected in the same batch.
- Compare identical input, camera, quality, machine and resource budget. Record DPR, error threshold,
  resolution and commit. FPS = 1000 / rAF interval; state display cap. Never add CPU and GPU times.
  Unmeasured values = `null`, never estimates presented as measurements. Keep diagnostics outside
  measured beauty passes; report unsupported capabilities. Measure on a quiet machine, and publish
  the run-to-run spread whenever a claim rests on a difference smaller than it.
- A per-pass GPU duration says *where*, never *how much*: on tile-based GPUs passes overlap and a
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
  commit messages and test descriptions are strictly written in English. Only conversational
  replies to the user remain in French.
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
  `LAB_ROOT`. `render-tech-lab` is one ordinary host of `prepare()` and `createExplorer()`: it tests
  the engine, the engine never leans on it. Never add host code to make the engine work, never
  write into a host's folders. The only proofs that touch it are mounted on its pages, take its
  address by `LAB_URL`, and are excluded from `test:gpu` by name.
- Keep React/Electron/Vite, DOM and platform filesystem APIs out of runtime-core/shared contracts;
  use browser/filesystem adapters. Consume public entry points; packages never import application
  internals.
- All generic Rust library/CLI code belongs in `packages/`, never numbered benchmarks.
  `test/integration/structure-moteur.test.mjs` checks core/adapter boundaries; `pnpm run check:structure` also
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

## Workflow

- **Every change reaches `develop` through an issue and a pull request, whatever tool writes it.**
  One issue per batch; branch `<issue>-<short-name>` cut from `develop`; pull request body on
  `.github/PULL_REQUEST_TEMPLATE.md`, starting with `Closes #<issue>`. The tracked git hooks in
  `.githooks/` (installed by `pnpm install`) refuse a commit on any other branch shape and a push
  to `develop` or `main`; the GitHub ruleset `.github/ruleset.json` (applied with
  `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input .github/ruleset.json`) refuses a direct
  or forced push and a merge without the `validate` check green.
- **The branch is checked out in a worktree of its own, never in the shared checkout.**
  `git worktree add ../webGeometry-<issue>-<short-name> -b <issue>-<short-name> origin/develop`,
  then `pnpm install` there. Once the maintainer has merged the branch, whoever notices first
  removes the tree and the branch it left behind: `git worktree remove`, then `git branch -d`.
  Several agents work on this repository at the same time: two of them in one working tree
  overwrite each other's files without a word, and a single `git status` then mixes two batches
  on one branch.
- **Issue lifecycle labels make ongoing work visible.** As soon as the worktree is created, mark
  the issue in progress (`gh issue edit <issue> --add-label "in progress"`). When the pull request
  is opened, replace `in progress` with `in review`. After merge, remove `in review` and close the
  issue when cleaning up the worktree: merging into `develop` does not close it automatically.
  If the pull request is closed without merging, remove both labels; add `in progress` again only
  if implementation continues. The coder role gives the commands for each transition.
- **The release is a pull request like any other.** `develop` reaches `main` through its own
  issue and its own pull request, body on the same template and starting with `Closes #<issue>`,
  merged once `validate` is green; its head is `develop` itself, so no branch is cut for it and
  it carries no code — what it releases was proved by the pull requests already merged, which its
  "Local review before push" section names. `scripts/check-pr-body.sh`, run by the CI on a pull
  request to `main` as on one to `develop`, refuses a body without that first line: a release
  opened without an issue fails `validate` before anything else is read. Pages serves
  `main` + `/docs`, so nothing is published until that merge.
- **Before the push that opens a pull request, the author reviews its own diff twice**: a
  simplification pass, then a correctness pass, fixes applied, gates rerun (`docs/roles/coder.md`
  step 6 names the commands per tool). The pull request says what each pass found under "Local
  review before push"; the CI refuses an empty section.
- Two tool-neutral roles in `docs/roles/`: `coder` implements one issue and opens the pull
  request; `reviewer` checks it against this file and comments, without editing. The coder hands
  every pull request to the reviewer, a separate agent with a fresh context, and loops with it —
  fix, push, re-check — until it answers `READY` (three rounds at most), then reports to the
  maintainer. Claude Code has them as subagents in `.claude/agents/`,
  the reviewer without edit tools.
- Merging is the maintainer's decision, never an agent's. `gh pr merge` is not for agents.

## Interaction and replies

- Reply in simple, concise French: outcome first, usually 1–5 lines. Include necessary evidence,
  limitations or blockers; expand only when needed or requested. No filler, repeated summaries or
  command transcripts. One question at a time, never a menu of options.
- Read this file first, then only the current task's handoff and relevant plan sections. Search
  before reading; avoid loading whole plans, unrelated sessions or old reports.
- Do not start writing code until the user has asked for it. Explain, wait.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- Navigate graphify-out/wiki/index.md instead of reading raw files. The wiki is not committed — it is rebuilt from the graph for free, with no LLM, by `graphify export wiki`; generate it when the folder is missing rather than falling back to grep
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` then `pnpm run graphify:libelles` to keep the graph current (AST-only, no API cost). The update reclusters and flattens every community name back to a filename; the second command gives them back their meaning, from the witnesses kept in `scripts/graphify-communautes.json`. The post-commit hook rebuilds in the background and does not run the second step
- After changing docs, specs or READMEs, only `/graphify --update` refreshes what the graph knows of them — no CLI does it, and it costs tokens

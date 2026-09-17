# Web Geometry — agent rules

## The mission

- **Build Unreal Engine 5's virtualized geometry for the web, with its performance.** The reference
  is UE5: Nanite for the geometry, its temporal antialiasing for the image, its streaming and memory
  budgets. Its techniques, its constraints, its numbers. At every trade-off, take its solution.
- **Never copy Unreal code, shaders or assets into this repository.** Not one line, ever. Unreal is
  not open source and its source is EULA-covered; reimplement from public material only — papers,
  talks, documentation, observed behaviour. Naming it as a reference is fine and expected; carrying
  its code is what creates a lawsuit. The same goes for any other engine.
- Parity means four things, and none of them is a pixel count: fixed memory and millisecond budgets,
  residency driven by what the frame actually reads, compression at cook time, no work in a still
  scene. A batch that misses these has not reached the reference, however good it looks.

## Measure before optimising

- **Never optimise a path whose cost is not measured.** State its share of the frame first, on a real
  scene, or say plainly that it is unknown. A batch justified by a supposition is a batch to stop.
- Measure the whole frame before a part of it: the engine publishes a per-step CPU profile
  (`webgpuPagesCpuSteps.ts`, `cpu-timing` diagnostic) and the lab has a headless walk
  (`render-tech-lab/scripts/headless/`). Read them before choosing a target.
- When a measurement contradicts a plan — including one in `TODO.md` — the measurement wins, and the
  plan is corrected in the same batch.
- Compare identical input, camera, quality, machine and resource budget. Record DPR, error threshold,
  resolution and commit. FPS = 1000 / rAF interval; state display cap. Never add CPU and GPU times.
  Unmeasured values = `null`, never estimates presented as measurements. Keep diagnostics outside
  measured beauty passes; report unsupported capabilities. Measure on a quiet machine, and publish
  the run-to-run spread whenever a claim rests on a difference smaller than it.

## Image and fidelity

- Never reduce resolution or draw distance. Never convert transparency to masking **inside the
  engine**: a source material wrongly declared blended is reclassified by the compiler at import.
- `0 px`, `tri = selected` and A/A noise stay the default proof for geometry and lighting. A batch
  that keeps them owes no discussion.
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
- Every maintained JS/TS/Rust source file, including variants, must fit 200 physical lines; no legacy
  exceptions. Split by responsibility, preserve public contracts. Gate: `pnpm run check:lines`.
- `pnpm run check:duplicates` rejects blocks ≥12 lines and ≥100 tokens across JS/TS/Rust. Resolve
  every finding before integration; share logic only for identical behavior.

## Engine and package boundaries

- Generic engine: no scene names, hardcoded lights/cameras or object-type special cases. Use imported
  material/light properties; one lighting model for opaque and transparent surfaces, one reflection
  model for reflective surfaces. Benchmark fixes must generalize to any imported scene.
- `render-tech-lab` is an ordinary host of `prepare()`, `createExplorer()` and public SDK validation.
  Never add host code to make the engine work or write `public/benchmark-assets`.
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

## Backlog and replies

- `TODO.md` at the repository root holds the open tasks, grouped by category: one line per task, no
  rules, no logs, no narratives or catalogues — rules belong here, history belongs in Git. Delete a
  task once it is done. The engine target stays in `docs/SPEC_MOTEUR_SANS_THREE.md`.
- Reply in simple, concise French: outcome first, usually 1–5 lines. Include necessary evidence,
  limitations or blockers; expand only when needed or requested. No filler, repeated summaries or
  command transcripts. One question at a time, never a menu of options.
- Read this file first, then only the current task's handoff and relevant plan sections. Search
  before reading; avoid loading whole plans, unrelated sessions or old reports.
- Do not start writing code until the user has asked for it. Explain, propose the backlog lines, wait.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- Navigate graphify-out/wiki/index.md instead of reading raw files. The wiki is not committed — it is rebuilt from the graph for free, with no LLM, by `graphify export wiki`; generate it when the folder is missing rather than falling back to grep
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` then `pnpm run graphify:libelles` to keep the graph current (AST-only, no API cost). The update reclusters and flattens every community name back to a filename; the second command gives them back their meaning, from the witnesses kept in `scripts/graphify-communautes.json`. The post-commit hook rebuilds in the background and does not run the second step
- After changing docs, specs or READMEs, only `/graphify --update` refreshes what the graph knows of them — no CLI does it, and it costs tokens

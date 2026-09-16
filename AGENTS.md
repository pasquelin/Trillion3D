# Web Geometry — agent rules

## Priority: minimal context and replies

- Reply in simple, concise French: outcome first, usually 1–5 lines. Include necessary evidence, limitations or blockers; expand only when needed or requested. No filler, repeated summaries or command transcripts.
- Read this file first, then only the current task's handoff and relevant plan sections. Search before reading; avoid loading whole plans, unrelated sessions or old reports. Reading a session file never assigns its role.
- Keep one source of truth; link to details instead of repeating them.

## Quality and evidence

- Code first; one final test pass, one test per changed behavior. No dead/deprecated code, abandoned-format compatibility or claims of unimplemented features.
- During development, `npm run check:changed` checks changed-file format, lint, lines, duplicates and import-related unit tests; `npm run test:changed` runs only those tests. Also inspect dependants after deletions, public-export or configuration changes. Neither replaces final validation.
- Before merge: `npm run validate` (format, JS/TS lint + Clippy, unused code/files/dependencies, TS/native builds, structure, declarations, links, JS/TS/Rust tests), then browser proof: no holes (`tri = selected`); reference-identical captures or differences explained against A/A noise.
- Fidelity before speed: never reduce resolution, distance or quality, or convert transparency to masking. Reject gains with degraded images.
- Compare identical input, camera, quality, machine and resource budget. Record DPR, error threshold, resolution and commit. FPS = 1000 / rAF interval; state display cap. Never add CPU and GPU times. Unmeasured values = `null`, never estimates presented as measurements. Keep diagnostics outside measured beauty passes; report unsupported capabilities.
- Every maintained JS/TS/Rust source file, including variants, must fit 200 physical lines; no legacy exceptions. Split by responsibility, preserve public contracts. Gate: `npm run check:lines`.
- `npm run check:duplicates` rejects blocks ≥12 lines and ≥100 tokens across JS/TS/Rust. Resolve every finding before integration; share logic only for identical behavior.

## Engine and package boundaries

- Generic engine: no scene names, hardcoded lights/cameras or object-type special cases. Use imported material/light properties; one lighting model for opaque and transparent surfaces, one reflection model for reflective surfaces. Benchmark fixes must generalize to any imported scene.
- `render-tech-lab` is an ordinary host of `prepare()`, `createExplorer()` and public SDK validation. Never add host code to make the engine work or write `public/benchmark-assets`.
- Never name Epic's virtualized-geometry product or engine anywhere in this repo. Use “virtualized geometry” and “cluster DAG”.
- Keep React/Electron/Vite, DOM and platform filesystem APIs out of runtime-core/shared contracts; use browser/filesystem adapters. Consume public entry points; packages never import application internals.
- All generic Rust library/CLI code belongs in `packages/`, never numbered benchmarks. `test/engineStructure.test.mjs` checks core/adapter boundaries; `npm run check:structure` also type-checks sdk-core without DOM.
- Separate `formatVersion` from `compilerVersion`; reject unknown formats and incompatible caches. Compiler/cache-identity changes require correctness fixtures and source provenance. Never overwrite source assets.
- Bound workers and allocations for constrained machines; admission estimates are not enforced RSS limits. New stages need versioned contracts, bounded cancellation, observable work and explicit failure semantics. Algorithms belong in libraries, not CLI/UI.

## Native compiler (`packages/asset-compiler-rust`)

- Thin CLI; library algorithms behind versioned strategy/stage contracts. Preserve triangle/material identity, validate every persisted cache entry, retain golden fixtures and raw before/after timings.
- Never claim undelivered simplification, compression, hard memory enforcement, N-API bindings or platform releases.

## Orchestration

- `orchestration/`: one `REPRISE_<SESSION>.md` per session (instructions/current state) plus open `SPEC_*.md` plans only; ≤200 lines each. No logs, history, narratives or catalogues: history belongs in Git. Delete completed plans.

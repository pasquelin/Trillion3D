# Web Geometry — agent rules

## Priority: minimal context and replies

- Reply in simple, concise French: outcome first, usually 1–5 lines. Include necessary evidence, limitations or blockers; expand only when needed or requested. No filler, repeated summaries or command transcripts.
- Read this file first, then only the current task's handoff and relevant plan sections. Search before reading; avoid loading whole plans, unrelated sessions or old reports. Reading a session file never assigns its role.
- Keep one source of truth; link to details instead of repeating them.

## Quality and evidence

- Code first; one final test pass, one test per changed behavior. No dead/deprecated code, abandoned-format compatibility or claims of unimplemented features.
- During development, `npm run check:changed` checks changed-file format, lint, lines, duplicates and import-related unit tests; `npm run test:changed` runs only those tests. Also inspect dependants after deletions, public-export or configuration changes. Neither replaces final validation.
- Before merge: `npm run validate` (format, JS/TS lint + Clippy, unused code/files/dependencies, TS/native builds, structure, declarations, links, JS/TS/Rust tests), then browser proof: no holes (`tri = selected`); reference-identical captures or differences explained against A/A noise.
- **Performance parity with the reference engine is the primary goal** (decision of 17 Sep 2026): at every trade-off take its solution — fixed memory and millisecond budgets, residency driven by what the frame actually reads, compression at cook time, no work in a still scene — rather than a workaround that holds the pixels and misses its numbers. A cost in pixels is declared, measured and published in the batch; it is no longer a reason to refuse on its own.
- Fidelity: never reduce resolution or draw distance, and never convert transparency to masking inside the engine (a source material wrongly declared blended is reclassified by the compiler at import, never at runtime). Pixel-exact proof — 0 px, `tri = selected`, A/A noise — stays mandatory for geometry and lighting. The single approved image cost is lossy GPU texture compression at cook time (BC, ASTC), judged by eye against published before/after captures.
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

## Backlog

- `TODO.md` at the repository root holds the open tasks, grouped by category: one line per task, no rules, no logs, no narratives or catalogues — rules belong here, history belongs in Git. Delete a task once it is done. The engine target stays in `docs/SPEC_MOTEUR_SANS_THREE.md`.

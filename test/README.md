# Cross-cutting Tests

This directory contains what does not belong to any specific package. Unit tests live alongside their source code under `packages/*/`.

- **`integration/`** — 10 architecture and contract tests (`engineStructure`, `engineNoThree`, `public`, `dts-extensions`…), run by `pnpm test`.
- **`browser/`** — 30 rendering proofs executed in real Chromium (WebGPU / WebGL2): all launched, none excluded (`BROWSER_ECARTES`, `test/test-gpu.mjs`).
- **`justesse/`** — 18 hardware precision probes, plus their 25 support modules. A probe is a file whose name contains a hyphen; others are never executed standalone.
- **`appui/`** — modules shared by rendering tests: fixture server, pages served to browser, case suites.
- **`fixtures/`** — test scenes and data.
- **`assets/`** — source format corpus, delivered outside repo and gitignored.

The two folders are discovered by rule and their names follow benchmark and probe convention: explicit kebab-case. `browser/` and `justesse/` run together via `pnpm run test:gpu` (`test/test-gpu.mjs`), and `test/test-gpu.test.mjs` preserves the equality **launched ∪ skipped == disk** in both: no file can silently stop running.

Full documentation: [`docs/TESTS.md`](../docs/TESTS.md).

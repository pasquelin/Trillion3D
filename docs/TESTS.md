# Tests and Performance Benchmarks

How to run the tests, the GPU proofs on Dawn, the Chrome proofs and the performance benchmarks.

## 1. Where Tests Live

**A unit test (`*.test.ts`) sits next to the file it tests; every other kind lives under `tests/`**,
one folder per nature:

- `tests/integration/`: architecture, package boundaries, public contracts;
- `tests/gpu/`: the GPU proofs, one folder per engine area, `kit/` shared;
- `tests/fixtures/`: test data builders; `formats/` holds the compiler's golden fixtures
  ([README](../tests/fixtures/formats/README.md)), whose local corpus of source formats stays off
  git;
- `tests/kit/`: one fake GPU device family in `gpu/`, one static server and the fixture route in
  `server/`, one bit-exact comparison and one hostile-value list in `assert/`.

A test-only module is named `*.fixture.ts` and stays out of the build. The tracked git hooks
(`.githooks/`, one-line shims onto `scripts/hooks/*.ts`) are proved in a throwaway repository by
`tests/integration/workflow-gates.test.ts`. The compiler's own tests stay in its crate
(`packages/asset-compiler-rust/src/tests/` by topic, `tests/` for the CLI).

Benchmarks measure speed, never correctness, under `bench/`, outside every published package:
`bench/core/` (measure, report, diff, ulp, baseline), `bench/perf/<package>/` (`*.perf.ts`),
`bench/oracles/` (reference implementations), `bench/runner/` (the measurement harness,
[README](../bench/runner/README.md)), `bench/witnesses/` (the host-library witnesses, never
published).

## 2. The Commands

| Command | What it runs |
|---|---|
| `pnpm test` | every `*.test.ts` under `packages/`, `tests/`, `bench/`, `scripts/` and `site/examples/kit/` |
| `pnpm run check:changed` | the local gate: the gates of `validate` and the unit tests the changed files reach |
| `pnpm run validate` | every gate, as the CI runs it |
| `pnpm run test:gpu` | the GPU proofs on Dawn |
| `pnpm run test:chrome` | the Chrome proofs |
| `pnpm run test:mutation` | the mutation measurement of `packages/sdk-core/src` |
| `pnpm run perf:all` | every benchmark of `bench/perf/`, then the aggregated report |

`check:changed` (`scripts/check-changed.ts`) compares with `develop` (`TRILLION3D_BASE_REF`
overriding) and runs the unit tests a change can affect (`scripts/affected-tests.ts`). A change of
documentation, translations or example thumbnails also runs the tests that read them
(`pnpm run test:docs`, `scripts/docs/tests.ts`). It type-checks (`tsc --noEmit`) every tracked
`tsconfig*.json` project owning a changed TypeScript file, by listing it or by import
(`scripts/ts-projects.ts`); a changed file no project reaches fails, unless a type-check-only
(`noEmit`) project's `include` covers it and its `exclude` takes it back. A project reading
`trillion3d` from `dist/` (the site, the tools) is checked after `pnpm run build`.

CI ([`quality.yml`](../.github/workflows/quality.yml)) runs `validate` as parallel jobs, one per
group of `scripts/validate-steps.ts`, the `unit` group split into shards of one file list
(`TRILLION3D_TEST_SHARD=i/n`, passed to `node --test --test-shard`). No test is skipped by path.
The single required check, `validate`, needs every job; it runs on every pull request, on `develop`
and on every push of a branch named `<issue>-<name>`. Push and pull request runs never share a
concurrency group, so a push never cancels the run proving the merge with `develop`.

### Unit and Integration Tests

Algorithms, package boundaries and public contracts; no graphics device, run anywhere. A test
checks a result — a value, a buffer, an image, an output read cell by cell — never the literal
text of a generated shader or report: such a test breaks on a rewrite that keeps the same image
and proves nothing about the image. What a shader computes is proved on a device (`tests/gpu/`).

### Mutation Measurement

`pnpm run test:mutation [--out <dir>] [--mutate <glob>…]` (`scripts/test-mutation.ts`) runs
Stryker on `packages/sdk-core/src`: each mutant (a `<` turned into `<=`, a branch emptied) runs
against the package's unit test files that reach it, and the report credits each test file with
the mutants it kills. It is a measurement, never a gate, and the CI does not run it: an hour or
more at the lowest priority on a quarter of the cores (`TRILLION3D_MUTATION_CONCURRENCY`
overriding). `--out` (default `.mesure/out/mutation/`) receives `summary.md`, `kills.tsv`,
`survivors.md` and Stryker's `mutation.html` and `mutation.json`.

A test file that kills no mutant catches no bug of the package's sources: it is strengthened until
it kills one, or deleted. A surviving mutant is a change no test notices: a test is added that
fails on it, or the mutant is equivalent (the change keeps every result) and the reason is written
beside the code.

### GPU Proofs on Dawn

`tests/gpu/` checks what the device computes and draws: WGSL precision, error floors, projection
matrices, texel coordinates, readbacks and whole frames of the engine. Every proof is a
`tests/gpu/<area>/<name>.gpu.ts`, the area named after the engine folder it tests; the other files
of an area are the modules its proofs load. They run on Dawn in Node — the WebGPU implementation
Chrome runs, on the machine's GPU, no browser (`tests/gpu/kit/onDawn.ts`).

`pnpm run test:gpu` (`bench/dawn/proofs.ts`) takes the machine's bench lock, compiles the test
scenes (`TEST_SCENES`, `scripts/site-caches.ts`) under it, then runs every `*.gpu.ts` in one
sequential `node --test`. The proofs are found by rule, never by a hand-curated list:
`bench/dawn/proofs.test.ts` keeps launched ∪ excluded == disk, and no exclusion outlives the proof
it names. A proof never opens the GPU from an import: only an explicit run does
(`assertProofEntryPoint`).

```bash
pnpm run test:gpu                                             # run all
node bench/dawn/proofs.ts tests/gpu/dag/cut-rule.gpu.ts       # run one, excluded or not
```

What cannot run is declared in `EXCLUDED` (`bench/dawn/proofs.ts`) with a category and a reason,
printed before the run:

- **setup** — the proof is valid but the machine is not ready;
- **regression** — the proof fails on an engine defect, fixed in the engine;
- **stale duplicate** — the proof keeps a copy of a contract that drifted in the source: it is
  repaired by reading the contract instead.

Some proofs read compiled public scenes under `.mesure/assets/`, off git:
`node bench/runner/assets/assets.ts` fetches and compiles them
([Assets](../bench/runner/README.md#assets)), the default scene being `DEFAULT_SCENE`
(`'sponza'`, `bench/runner/assets/scene.ts`). A sibling worktree has none: point
`TRILLION3D_ASSETS` at the shared folder, else such a proof stops by name on the missing cache.
What a proof needs beyond that is in its file's header.

### Chrome Proofs

What Dawn does not have is proved in the system Chrome: the WebGL2 backend (`tests/gpu/webgl/`, the
WebGL2 halves of `particles/`, `reflections/` and `backend/`) and the per-material comparison with
the witness renderer (`webgpu/material-pixels`). Each is a `tests/gpu/<area>/<name>.chrome.ts`,
found by the same rule and declared in the same `EXCLUDED`; its page module is served from the
sources and called in a fresh headless Chrome (`tests/gpu/kit/onChrome.ts`), under the bench lock.
Their scenes are built by the proofs, never a page of the site.

```bash
pnpm run test:chrome                                                       # run all
node bench/dawn/proofs.ts --chrome tests/gpu/webgl/blend-passes.chrome.ts  # run one
```

The site has no browser proof. `node scripts/site-first-load.ts <siteDir> [route …]` measures a
route's first load (DOMContentLoaded, settled, requests, bytes) over cold contexts: a measurement,
not a proof.

### Performance Benchmarks

A benchmark measures a package computation on named cases and compares it to an oracle: the
pre-optimisation implementation, kept unchanged under `bench/oracles/`. Each line gives median,
p95, nanoseconds per element, operations per second, baseline difference, witness difference and
the oracle verdict. `mesure()` refuses to run if the file a benchmark reports as measured does not
exist.

A witness (`temoin` in `mesure()`) is a second calculation of the same thing — the host library, a
rejected candidate — timed on the same input and settings; "vs witness" reads the median relative
to it as "vs baseline" does to the baseline. A witness is a comparison, never a regression gate.

Two verdict types, never silence:

- **✓ / ✗** — bitwise equality (`diff.ts`: `-0`, `NaN`, typed arrays, `Map`, `Set`), or a declared
  tolerance (`differences` + `tolere`, in ULPs by `ulp.ts`);
- **reason** — no oracle exists; the line says why and where correctness is held. A stale oracle is
  declared, never silently removed.

The witness duels (`bench/perf/core/three-vs-core-*.perf.ts`, `pnpm run perf:core`) run the host
library and the engine on the same seeded inputs, Three.js the witness and its result read untimed
as the oracle; they refuse an engine that differs by a bit (or beyond the tolerance a family
declares) or runs slower than its declared ceiling. The `three-vs-core-batch-*` duels pit the
reference's loop over 200 000 elements against one batch call; [MATHS.md](MATHS.md) carries the
ratios.

## 3. Baselines and Report

`pnpm run perf:all` writes one fragment per domain into `.mesure/perf/`;
`bench/runner/perf/aggregate.ts` joins them into `.mesure/out/perf/perf-<date>.md` and `.json`.
`pnpm run perf:baseline` turns fragments into baselines under `.mesure/baselines/`, one per domain,
keyed by measurement and case — off git and machine-specific. Without one, "vs baseline" shows `—`
and the report says no baseline exists on this machine. Fragments and baselines carry `version: 3`;
an older file is ignored and `pnpm run perf:baseline` records it again. The report flags machine
load above 4: timings are then inconclusive.

These timers run in the process that just ran the oracle: enough to track regressions on one
machine, not a campaign, which uses the [harness](../bench/runner/README.md) under the rules of
[Measure before optimising](../CONTRIBUTING.md#measure-before-optimising).

## 4. Quality Gates

The gates and their order are `VALIDATE_GROUPS` in `scripts/validate-steps.ts`; each gate's rule is
in its script's header, and `pnpm run check:changed` runs them on what a branch changed. Two rules
that shape every file: a maintained JS, TS or Rust file holds at most 200 lines (`check:lines`),
except the runtime modules of `sdk-core`, `sdk-browser`, `sdk-node` and `page-codec`, which answer
to `check:cohesion` instead (functions of at most 60 lines and a complexity of at most 20, on the
modules a branch touches). The translations gate is described in
[LEARNING_PORTAL.md](LEARNING_PORTAL.md#languages).

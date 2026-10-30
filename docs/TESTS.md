# Tests and Performance Benchmarks

## 1. Where Tests Live

**A unit test (`*.test.ts`) sits next to the file it tests; every other kind lives under `tests/`**:

- `tests/integration/`: architecture, package boundaries, public contracts;
- `tests/gpu/`: GPU proofs per engine area, `kit/` shared;
- `tests/fixtures/`: data builders; `formats/` holds the compiler's golden fixtures
  ([README](../tests/fixtures/formats/README.md)); its local corpus stays off git;
- `tests/kit/`: fake GPU device `gpu/`, static server `server/`, comparisons `assert/`.

A test-only module is named `*.fixture.ts`. Git hooks (`.githooks/`, shims onto
`scripts/git/hooks/*.ts`): proved by `tests/integration/workflow-gates.test.ts`. Compiler tests: `packages/asset-compiler-rust/src/tests/`.

Benchmarks live under `bench/`: `bench/core/` (measure, report, diff, baseline),
`bench/perf/<package>/` (`*.perf.ts`), `bench/oracles/`, `bench/runner/` (harness,
[README](../bench/runner/README.md)), `bench/witnesses/` (entry the harness pages import).

## 2. The Commands

| Command | What it runs |
| - | - |
| `pnpm test` | every `*.test.ts` under `packages/`, `tests/`, `bench/`, `scripts/` |
| `pnpm run check:changed` | `validate`'s gates and the unit tests the changed files reach |
| `pnpm run validate` | every gate, as CI runs it |
| `pnpm run test:gpu` | the GPU proofs on Dawn |
| `pnpm run test:chrome` | the Chrome proofs |
| `pnpm run test:mutation` | mutation measurement of `packages/sdk-core/src` |
| `pnpm run perf:all` | every benchmark of `bench/perf/`, then the aggregated report |

`check:changed` (`scripts/check/check-changed.ts`) compares with `develop` (`TRILLION3D_BASE_REF`
overrides) and runs the affected unit tests (`scripts/check/affected-tests.ts`); a documentation-only
change runs the gates only. It type-checks (`tsc --noEmit`) every `tsconfig*.json` project owning a
changed TypeScript file (`scripts/check/ts-projects.ts`); a changed file no project reaches fails,
unless a `noEmit` project's `include` covers it and its `exclude` takes it back. A project reading
`trillion3d` from `dist/` needs `pnpm run build` first.

CI ([`quality.yml`](../.github/workflows/quality.yml)) runs `validate` as one parallel job per group
of `scripts/check/validate-steps.ts`; the `unit` group is sharded (`TRILLION3D_TEST_SHARD=i/n`, passed to `node --test --test-shard`). Required check
`validate` runs on every pull request, on `develop` and on pushes of `<issue>-<name>` branches.

### Unit and Integration Tests

No graphics device. A test checks a result, never the literal text of a generated shader or report.

### Mutation Measurement

`pnpm run test:mutation [--out <dir>] [--mutate <glob>…]` (`scripts/check/mutation.ts`) runs Stryker
on `packages/sdk-core/src`: each mutant (a `<` turned into `<=`, a branch emptied) runs against the
unit tests reaching it. Not a gate, not in CI: an hour or more on a quarter of the cores
(`TRILLION3D_MUTATION_CONCURRENCY`). `--out` (default `.mesure/out/mutation/`) receives
`summary.md`, `kills.tsv`, `survivors.md`, `mutation.html`, `mutation.json`. A test file killing no
mutant: strengthen or delete it. A survivor: add a test failing on it, or note why it is equivalent.

### GPU Proofs on Dawn

`tests/gpu/<area>/<name>.gpu.ts` (area = engine folder) checks what the device computes and draws,
on Dawn in Node (machine's GPU, no browser; `tests/kit/device/onDawn.ts`).

`pnpm run test:gpu` (`bench/dawn/proofs.ts`) takes the bench lock, compiles the test scenes
(`TEST_SCENES`, `scripts/native/scene-caches.ts`), then runs every `*.gpu.ts` in one sequential
`node --test`. `bench/dawn/proofs.test.ts` keeps launched ∪ excluded == disk; no exclusion outlives
its proof. A proof opens the GPU only on an explicit run (`assertProofEntryPoint`).

```bash
pnpm run test:gpu                                             # run all
node bench/dawn/proofs.ts tests/gpu/dag/cut-rule.gpu.ts       # run one, excluded or not
```

`EXCLUDED` (`bench/dawn/proofs.ts`) declares what cannot run, with a category and reason:

- **setup**: the machine is not ready;
- **regression**: the proof fails on an engine defect;
- **stale duplicate**: the proof copies a contract that drifted; repair it.

Some proofs read compiled scenes under `.mesure/assets/` (off git): `node bench/runner/assets/assets.ts`
builds them ([Assets](../bench/runner/README.md#assets)); default `DEFAULT_SCENE` = `'sponza'`
(`bench/runner/assets/scene.ts`). A sibling worktree has none: set `TRILLION3D_ASSETS`.

### Chrome Proofs

System Chrome proves absence of WebGPU (`world/no-webgpu`) and per-material fixtures on screen
(`webgpu/material-pixels`). Each is `tests/gpu/<area>/<name>.chrome.ts`, found and excluded by the
same rule; run in a fresh headless Chrome (`tests/kit/device/onChrome.ts`) under the bench lock.

```bash
pnpm run test:chrome                                                       # run all
node bench/dawn/proofs.ts --chrome tests/gpu/webgpu/material-pixels.chrome.ts  # run one
```

### Performance Benchmarks

A benchmark measures a package computation on named cases against an oracle (pre-optimisation
implementation, unchanged under `bench/oracles/`). Each line: median, p95, ns per element, ops/s,
baseline and witness differences, oracle verdict. `mesure()` refuses to run if the
file reported as measured does not exist. A witness (`temoin`) is a second calculation. Verdicts:

- **✓ / ✗**: bitwise equality (`diff.ts`: `-0`, `NaN`, typed arrays, `Map`, `Set`);
- **reason**: no oracle; says why and where correctness is held.

## 3. Baselines and Report

`pnpm run perf:all` writes one fragment per domain into `.mesure/perf/`; `bench/perf/aggregate.ts`
joins them into `.mesure/out/perf/perf-<date>.md` and `.json`. `pnpm run perf:baseline` turns
fragments into baselines under `.mesure/baselines/` (per domain, off git). Without
one, "vs baseline" shows `—`. Files carry `version: 3`; an older file is ignored. The report flags
load above 4.

Campaigns: [harness](../bench/runner/README.md),
[Measure before optimising](../CONTRIBUTING.md#measure-before-optimising).

## 4. Quality Gates

Gates: `VALIDATE_GROUPS` in `scripts/check/validate-steps.ts`; rules in each script's header. A JS,
TS or Rust file holds at most 300 lines (`check:lines`), except `sdk-core`, `sdk-browser`,
`sdk-node` runtime modules, which answer to `check:cohesion` (functions at most 60 lines, complexity
at most 20, on touched modules). `check:webgpu-only` fails on any trace of the GL family of APIs in
a tracked file or file name, no allowlist.

# Tests and Performance Benchmarks

One command per intent, one location per nature of test. Everything below is verified:
counts reflect the repository tree, and `test/test-gpu.test.mjs` tracks the probe list.

## 1. Directory Tree

```
packages/
  sdk-core/            57 *.test.ts      — unit tests, placed alongside source
    bench/
      *.perf.mjs          6 performance benchmarks
      socle.mjs           single entry point for benchmarks
      socle/              mesure.mjs, rapport.mjs, ecart.mjs, ulp.mjs, baseline.mjs
      oracles/            reference implementations, copied verbatim
  sdk-browser/        244 *.test.ts
    bench/
      *.perf.mjs         38 performance benchmarks
      oracles/            package oracles
      appui/              28 support modules: scenes, replays, test cases
  sdk-node/             5 *.test.mjs
test/
  integration/         15 *.test.mjs     — architecture, boundaries, export contracts,
                                        documentation portal
  browser/             30 *.browser.mjs  — rendering in real Chromium (all launched)
  justesse/            18 GPU probes + 25 support modules
  appui/               27 shared modules: fixtures server, served pages
  fixtures/            scenes and test data
  assets/              corpus of source formats, off-git (66 MB, ignored by git)
  test-gpu.mjs         hardware test runner, with its own test
scripts/
  mesure/perf/          agrege.mjs (report), baseline-save.mjs (baselines)
```

One rule: **unit tests live next to their source**, everything else lives under `test/`, organized by
nature. A benchmark belongs in the package whose code it measures, referenced by relative path.

## 2. The Four Commands

| Command | What it runs |
|---|---|
| `pnpm test` | 306 unit tests, 10 integration tests and script tests |
| `pnpm run test:gpu` | 18 GPU correctness probes followed by runnable rendering proofs, sequentially |
| `pnpm run perf:all` | 44 benchmarks, then the aggregated report |
| `pnpm run validate` | full pre-merge validation gate |

`pnpm run test:changed` and `pnpm run check:changed` only execute what modified files
touch; neither replaces `validate`.

### Unit and Integration Tests

They validate algorithms, package boundaries, and public contracts. They do not initialize
any graphics device and run anywhere.

### GPU Correctness Probes

`test/justesse/` verifies what the graphics device actually calculates: WGSL shader precision, error
floors, projection matrices, texel coordinates, readbacks. A probe is a file whose name
contains a hyphen; other files in the folder are its support modules, never run alone.
`test/browser/` renders frames in real Chromium and compares them.

Both folders are discovered **by rule, never by a hand-curated list**: every
`test/browser/*.browser.mjs` is executed, and names follow the same convention as probes and
benchmarks — explicit kebab-case, e.g. `coupe-gpu-tenue`, `normale-eclairage-petite-echelle`.

Anything that cannot run is **explicitly declared** in `BROWSER_ECARTES` (`test/test-gpu.mjs`) with its
category and reason, and the command prints it before starting — never in silence:

- **montage** (setup) — the proof is valid, but the machine is not ready: assets in `.mesure/assets/`
  need recompilation, `timestamp-query` unavailable.
- **regression** — the proof fails because an issue exists. This is an open debt to be resolved by
  fixing the engine.
- **stale-double** — the proof maintains a manual copy of a contract that evolved in the source.
  The engine is correct, the copy drifted: fix by reading the contract rather than duplicating it.

`BROWSER_ECARTES` is empty: every render proof runs. The Emerald proof
(`emeraude-webgpu`) reads the compiled cache `emerald-square-derived` under `.mesure/assets/`, off
git, and a sibling worktree has none of its own: point `WG_ASSETS` at the shared folder. Without it
the proof exits on an `HTTP 404` naming the manifest it could not fetch, and `pnpm run test:gpu`
fails with it — loudly, never in silence.

`test/test-gpu.test.mjs` enforces symmetric guarding across both directories: **executed ∪ excluded ==
on-disk**, and no exclusion outlives the file it names. Without this guard, forgotten proofs would
never execute without notice.

```bash
pnpm run test:gpu                                  # run all
node test/test-gpu.mjs test/justesse/reflexion-cone.mjs   # run single target
```

### Performance Benchmarks

A benchmark measures a package computation against named cases and **compares it to an oracle**:
the pre-optimization implementation, copied verbatim under `bench/oracles/`. Each published line
includes its median, p95, nanoseconds per element, operations per second, baseline difference,
witness difference and the oracle verdict.

A **witness** (`temoin` in `mesure()`) is a second calculation of the same thing — the host
library, a rejected candidate — timed on the same input with the same settings; the row keeps its
statistics under `temoin` and the "vs witness" column reads the calculation's median relative to
it, as "vs baseline" reads it relative to the baseline. The Three.js-versus-engine benches
(`three-vs-core-*.perf.mjs`) are written on it: one row per calculation family, Three the witness,
Three's result read untimed as the oracle. A witness is a point of comparison, never a regression
gate: the column carries no icon, and the `duel` helper's own `node:test` enforces each family's
declared performance ceiling.

Three verdict types, never silence:

- **✓ / ✗** — bitwise equality (`ecart.mjs`: `-0`, `NaN`, typed arrays, `Map`, `Set`), or declared
  tolerance (`differences` + `tolere`, counted in ULPs by `ulp.mjs`).
- **published diff** (`ecartPublie`) — the benchmark measures a *rejected* candidate and quantifies
  the displacement instead of expecting equality that does not apply. This is the case for C1
  (`raster-tampon`) and C3 (`pages-anneau`).
- **reason** — no oracle exists, and the line explains why and where correctness is held. A stale
  oracle is explicitly declared, never silently removed.

`mesure()` refuses to run if the file reported as measured by a benchmark does not exist.

## 3. Baselines and Report

`pnpm run perf:all` outputs a fragment per domain into `.mesure/perf/`, then
`scripts/mesure/perf/agrege.mjs` aggregates them into a single table under
`.mesure/out/perf/perf-<date>.md` and `.json`.

`pnpm run perf:baseline` converts fragments into baselines under `.mesure/baselines/`, one per domain,
keyed by measurement/case pairs. They are **off-git and machine-specific**: timing is only valid on
the hardware where it was recorded. Without a baseline, the "vs baseline" column shows `—` and the
report indicates no baseline exists on this machine, rather than erroneously claiming zero regression.
Fragments and baselines carry `version: 3` (rows keyed `name` / `size`, in English); a file of an
older version is ignored, and `pnpm run perf:baseline` records it again.

The report flags any machine load higher than 4: above this threshold, timings are inconclusive.

### What Benchmarks Do Not Measure

Timers run in the process that just executed the oracle, following warmup. This is sufficient to
track regressions between batches on the same machine; it is not a campaign measurement. A publishable
campaign is run with the `scripts/mesure/` harness (see its README), on a quiet machine, comparing
identical budgets, scenes, and poses.

## 4. Quality Gates

| Command | Role |
|---|---|
| `pnpm run check:lines` | Maximum 200 physical lines per maintained JS/TS/Rust file |
| `pnpm run check:duplicates` | No duplicated blocks ≥ 12 lines and ≥ 100 tokens |
| `pnpm run check:structure` | Package boundary isolation, sdk-core typed without DOM |
| `pnpm run check:unused` | Dead exports and files (`knip`) |
| `pnpm run check:docs-demo` | The demo bundle committed under `docs/js/` is the current packages |
| `pnpm run validate` | Complete gate: formatting, linting, tests, builds, structure, links |

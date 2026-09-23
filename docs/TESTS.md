# Tests and Performance Benchmarks

One command per intent, one location per nature of test. Everything below is verified:
counts reflect the repository tree, and `tests/browser/test-gpu.test.ts` tracks the probe list.

## 1. Directory Tree

<!-- tests-inventory:begin -->
```
packages/
  sdk-core/src/       68 *.test.ts — unit tests, next to their source
  sdk-browser/src/    333 *.test.ts
  sdk-node/src/       10 *.test.ts
tests/
  integration/        21 *.test.ts — architecture, boundaries, public contracts
  browser/renders/    42 *.browser.ts — rendering in real Chromium
  browser/probes/     20 GPU probes + 32 support modules
  browser/support/    68 pages and cases served to the render proofs
  kit/                16 shared test tools: fake GPU devices, servers, assertions
  fixtures/           12 test data builders; formats/ holds the compiler goldens
bench/
  core/               14 modules: measure, report, diff, ulp, baseline
  perf/core/          15 *.perf.ts
  perf/browser/       38 *.perf.ts + 32 support modules
  oracles/            46 reference implementations, copied verbatim
  runner/             81 modules: the measurement harness (README)
```
<!-- tests-inventory:end -->

The counts are read from the tree by `node scripts/tests-inventory.ts --write`, and
`scripts/tests-inventory.test.ts` fails when this page and the tree disagree.

One rule: **a unit test sits next to the file it tests; every other kind of test lives under
`tests/`**, one folder per nature — `integration/` for architecture and public contracts,
`browser/` for what runs in Chromium, `fixtures/` for test data, `kit/` for the shared test tools
(one fake GPU device family, one static server, one bit-exact comparison, one hostile-value list).
A module used only by tests is named `*.fixture.ts` and stays out of the build. Benchmarks measure
speed, never correctness, and live under `bench/`, outside every published package. The golden
fixtures of the native compiler are under `tests/fixtures/formats/`; the compiler's own tests stay in
its crate (`packages/asset-compiler-rust/src/tests/`, by topic, and `tests/` for the CLI).

## 2. The Four Commands

| Command             | What it runs                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `pnpm test`         | every unit, integration, kit, bench-runner and script test                    |
| `pnpm run test:gpu` | the GPU correctness probes, then every rendering proof, sequentially          |
| `pnpm run perf:all` | every benchmark of `bench/perf/`, then the aggregated report                  |
| `pnpm run validate` | full pre-merge validation gate                                                |

`pnpm run test:changed` and `pnpm run check:changed` only execute what modified files
touch; neither replaces `validate`.

### Unit and Integration Tests

They validate algorithms, package boundaries, and public contracts. They do not initialize
any graphics device and run anywhere.

### GPU Correctness Probes

`tests/browser/probes/` verifies what the graphics device actually calculates: WGSL shader precision, error
floors, projection matrices, texel coordinates, readbacks. A probe is a file whose name
contains a hyphen; other files in the folder are its support modules, never run alone.
`tests/browser/renders/` renders frames in real Chromium and compares them.

Both folders are discovered **by rule, never by a hand-curated list**: every
`tests/browser/renders/*.browser.ts` is executed, and names follow the same convention as probes and
benchmarks — explicit kebab-case, e.g. `held-gpu-cut`, `lighting-normal-small-scale`.

Anything that cannot run is **explicitly declared** in `BROWSER_ECARTES` (`tests/browser/test-gpu.ts`) with its
category and reason, and the command prints it before starting — never in silence:

- **montage** (setup) — the proof is valid, but the machine is not ready: assets in `.mesure/assets/`
  need recompilation, `timestamp-query` unavailable.
- **regression** — the proof fails because an issue exists. This is an open debt to be resolved by
  fixing the engine.
- **stale-double** — the proof maintains a manual copy of a contract that evolved in the source.
  The engine is correct, the copy drifted: fix by reading the contract rather than duplicating it.

### Site proofs

The learning portal under `site/` has its own proofs, run on demand in system Chrome. The four
`scripts/docs-*.browser.ts` and `tests/browser/renders/explorer-startup.browser.ts` build the site into
`dist/site/` before serving it, so they need no committed bundle. A behaviour-neutral change to the
site is proved by `node scripts/site-diff.browser.ts <beforeDir> <afterDir>`: every portal route
(entries and examples in both locales, gallery, API index, reports, engine scene, not found),
served from two built trees, settled, its DOM compared after normalising what is dynamic by
nature (canvas contents and sizes, `disabled`, stat values, generated ids, frame metrics).
`node scripts/site-first-load.ts <siteDir> [route ...]` measures a route's first load
(DOMContentLoaded, settled, requests, bytes) over cold contexts: a measurement, not a proof.

`BROWSER_ECARTES` is empty: every render proof runs. The reference-scene proof
(`scene-webgpu`) reads the compiled cache of `DEFAULT_SCENE` (`sponza-derived`) under
`.mesure/assets/`, off git, and a sibling worktree has none of its own: point `WG_ASSETS` at the
shared folder. Without it the proof stops by name on the cache it could not find, and
`pnpm run test:gpu` fails with it — loudly, never in silence. `node bench/runner/assets.ts`
fetches and compiles every scene the proofs read (`bench/runner/README.md` § Assets). The material proof (`witness-materials`) needs no asset:
its fixtures are built in the page and served from `tests/browser/support/`, the SDK from `dist/`, so
`pnpm run build` precedes it.

`tests/browser/probes/public-scenes.ts` needs no GPU and no browser: it opens the compiled caches of
the public scenes and asserts what each one guarantees — a DAG that climbs above level 0 wherever a
primitive holds more than one cluster, a mirrored mapping that locks no vertex — in a tenth of a
second. It reads the caches, never builds them: without
`node bench/runner/assets.ts` and a facade (`node bench/runner/scenes/facade.ts --seed 7`,
then `node bench/runner/assets.ts --only facade-7`) it fails by name on the cache it could not
find.

`tests/browser/test-gpu.test.ts` enforces symmetric guarding across both directories: **executed ∪ excluded ==
on-disk**, and no exclusion outlives the file it names. Without this guard, forgotten proofs would
never execute without notice.

```bash
pnpm run test:gpu                                  # run all
node tests/browser/test-gpu.ts tests/browser/probes/reflection-cone.ts   # run single target
```

#### Known failures of `test:gpu`, and where they were read

`test:gpu` drives a real GPU, so its result belongs to a machine: a batch declares the failures it
inherited rather than the ones it caused, and the baseline lives here so the next batch compares
against something written down. Read on an Apple M2 Max (Mac14,6), macOS 27.0, Chrome headless,
`WG_ASSETS` pointed at the shared `.mesure/assets/`, 2026-09-22: **7 fail**, and always these
seven files — `scene-webgpu` (then named after the private scene it read), `explorer-startup`,
`materiaux-temoin`, `observatory`,
`partition-gpu-conservatrice`, `rendu-clusters-webgl`, `shadow-camera-stop`. Seven, not the six
an older note quoted. Two readings, one commit apart: `origin/develop` at `005b5c445`, 52 pass /
7 fail; the head of #297, which adds one proof file, 53 pass / 7 fail. A batch that leaves exactly
these seven failing has changed nothing here; one that adds an eighth owns it. The pass count
moves with the number of proof files and means nothing on its own. Re-read the baseline on your
own machine before leaning on it — the failures are not portable, only the method is.

### Performance Benchmarks

A benchmark measures a package computation against named cases and **compares it to an oracle**:
the pre-optimization implementation, copied verbatim under `bench/oracles/`. Each published line
includes its median, p95, nanoseconds per element, operations per second, baseline difference,
witness difference and the oracle verdict.

A **witness** (`temoin` in `mesure()`) is a second calculation of the same thing — the host
library, a rejected candidate — timed on the same input with the same settings; the row keeps its
statistics under `temoin` and the "vs witness" column reads the calculation's median relative to
it, as "vs baseline" reads it relative to the baseline. The Three.js-versus-engine benches
(`three-vs-core-*.perf.ts`) are written on it: one row per calculation family, Three the witness,
Three's result read untimed as the oracle. A witness is a point of comparison, never a regression
gate: the column carries no icon, and the `duel` helper's own `node:test` enforces each family's
declared performance ceiling.

Three verdict types, never silence:

- **✓ / ✗** — bitwise equality (`diff.ts`: `-0`, `NaN`, typed arrays, `Map`, `Set`), or declared
  tolerance (`differences` + `tolere`, counted in ULPs by `ulp.ts`).
- **published diff** (`ecartPublie`) — the benchmark measures a _rejected_ candidate and quantifies
  the displacement instead of expecting equality that does not apply. This is the case for C1
  (`raster-tampon`) and C3 (`pages-anneau`).
- **reason** — no oracle exists, and the line explains why and where correctness is held. A stale
  oracle is explicitly declared, never silently removed.

`mesure()` refuses to run if the file reported as measured by a benchmark does not exist.

**The reference-library duels** (`bench/perf/core/three-vs-core-*.perf.ts`,
`pnpm run perf:core`) put the host library and the engine on the same seeded inputs and refuse an
engine that differs by a bit or runs slower. The four `three-vs-core-batch-*.perf.ts` files —
`volumes` (frustum, spheres, unions, points, directions), `matrices` (invert, normal, compose),
`instances` (per-instance points, decompose, transformed union) and `colors` (the two curves) — pit
the reference's `for` loop over 200 000 elements against one batch call. A line reads: the
reference's median and the batch's, the ratio, then the verdict — bit for bit, or within the
tolerance the line declares once (the sRGB curves), and under the ceiling the line declares where
the two sides do not compute the same thing (`Matrix4.invert`, `NormalMatrix3`: the engine keeps
its singularity policy). `docs/API.md` § "Batch math for hosts" carries the ratios of one
published run.

## 3. Baselines and Report

`pnpm run perf:all` outputs a fragment per domain into `.mesure/perf/`, then
`bench/runner/perf/aggregate.ts` aggregates them into a single table under
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
campaign is run with the `bench/runner/` harness (see its README), on a quiet machine, comparing
identical budgets, scenes, and poses.

## 4. Quality Gates

| Command                       | Role                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm run check:lines`        | Maximum 200 physical lines per maintained JS/TS/Rust file                |
| `pnpm run check:duplicates`   | No duplicated blocks ≥ 8 lines and ≥ 64 tokens                           |
| `pnpm run check:helpers`      | No small helper copied into a second module of the same package          |
| `pnpm run check:structure`    | Package boundary isolation, sdk-core typed without DOM                   |
| `pnpm run check:unused`       | Dead exports and files (`knip`)                                          |
| `pnpm run check:no-js`        | No JavaScript source under `site/`: the site is TypeScript               |
| `pnpm run check:docs-bundles` | No build product of the site (`dist/site/`) is tracked by git            |
| `pnpm run check:site-types`   | The site under `site/` type-checks (`tsconfig.site.json`, `allowJs` off) |
| `pnpm run validate`           | Complete gate: formatting, linting, tests, builds, structure, links      |

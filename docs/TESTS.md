# Tests and Performance Benchmarks

One command per intent, one location per nature of test. The tree below is checked against the
repository, and `tests/browser/test-gpu.test.ts` tracks the probe list.

## 1. Directory Tree

<!-- tests-inventory:begin -->
```
packages/sdk-core/src/       unit tests (*.test.ts), next to their source
packages/sdk-browser/src/    unit tests (*.test.ts), next to their source
packages/sdk-node/src/       unit tests (*.test.ts), next to their source
tests/integration/           architecture, boundaries, public contracts (*.test.ts)
tests/browser/renders/       rendering in real Chromium (*.browser.ts)
tests/browser/probes/        GPU probes and their support modules
tests/browser/support/       pages and cases served to the render proofs
tests/kit/                   shared test tools: fake GPU devices, servers, assertions
tests/fixtures/              test data builders; formats/ holds the compiler goldens
bench/core/                  measure, report, diff, ulp, baseline
bench/perf/core/             CPU benchmarks (*.perf.ts)
bench/perf/browser/          browser benchmarks (*.perf.ts) and their support modules
bench/oracles/               reference implementations, copied verbatim
bench/runner/                the measurement harness (README)
bench/witnesses/             the host-library witnesses, never published
```
<!-- tests-inventory:end -->

`node scripts/tests-inventory.ts --write` renders the tree; `scripts/tests-inventory.test.ts` fails
when page and repository disagree. It carries no file count: counts changed with every pull request
and made parallel ones conflict (#452).

One rule: **a unit test sits next to the file it tests; every other kind lives under `tests/`**, one
folder per nature — `integration/` (architecture, public contracts), `browser/` (runs in Chromium),
`fixtures/` (test data), `kit/` (one fake GPU device family in `gpu/`, one static server and the
fixture route in `server/`, one bit-exact comparison and one hostile-value list in `assert/`). The
tracked git hooks (`.githooks/`, one-line shims onto `scripts/hooks/*.ts`) are proved in a throwaway
repository by `tests/integration/workflow-gates.test.ts`. A test-only module is named `*.fixture.ts`
and stays out of the build. Benchmarks measure speed, never correctness, under `bench/`, outside
every published package. The compiler's golden fixtures are under `tests/fixtures/formats/`
([README](../tests/fixtures/formats/README.md)); the local corpus of source formats stays off git.
The compiler's own tests stay in its crate (`packages/asset-compiler-rust/src/tests/` by topic,
`tests/` for the CLI).

## 2. The Four Commands

| Command | What it runs |
| --- | --- |
| `pnpm test` | every unit, integration, kit, bench-runner and script test |
| `pnpm run test:gpu` | the GPU correctness probes, then every rendering proof, sequentially |
| `pnpm run perf:all` | every benchmark of `bench/perf/`, then the aggregated report |
| `pnpm run validate` | full pre-merge validation gate |

`pnpm run check:changed`, the one local gate, runs only what changed files touch
(`scripts/affected-tests.ts`); it does not replace `validate`, which the CI runs. A change of
documentation, translations or example thumbnails also runs the tests that read them
(`pnpm run test:docs`, `scripts/docs-tests.ts`), which the CI's `quick` job runs too. It also
type-checks (`tsc --noEmit`) every tracked `tsconfig*.json` project owning a changed TypeScript
file, by listing it or by import (`scripts/ts-projects.ts`); a changed file no project reaches
fails, unless a type-check-only (`noEmit`) project's `include` covers it and its `exclude` takes it
back. A project reading `trillion3d` from `dist/` (the site, the tools) is checked after
`pnpm run build`, against current declarations.

CI ([`quality.yml`](../.github/workflows/quality.yml)) runs `validate` as parallel jobs, one per
group of `scripts/validate-steps.ts` — `quick`, `typescript`, `native` (Clippy and the Rust tests),
`unit` — the last split into shards of one file list (`TRILLION3D_TEST_SHARD=i/n`, passed to
`node --test --test-shard`). No test is skipped by path. The single required check, `validate`,
needs every job; it runs on every pull request, on `develop`, and on every push of an issue branch
(`<issue>-<name>`). Push and pull request runs never share a concurrency group, so a push never
cancels the run proving the merge with `develop`.

### Unit and Integration Tests

Algorithms, package boundaries and public contracts; no graphics device, run anywhere. A test
checks a result — a value, a buffer, an image, an output read cell by cell — never the literal
text of a generated shader or report: such a test breaks on a rewrite that keeps the same image
and proves nothing about the image. What a shader computes is proved on a device
(`tests/browser/`).

### Mutation Measurement

`pnpm run test:mutation` measures whether the unit tests of `packages/sdk-core/src` would catch a
bug: Stryker (`scripts/test-mutation.ts`) makes small changes to its sources — a mutant, such as a
`<` turned into `<=` or a branch emptied — and runs against each the test files of that package
that `pnpm test` runs and that reach the changed code, every one of them (no stop at the first
failure). A mutant a test fails on is killed; one every test passes on survives. It is a
measurement, never a gate, and the CI does not run it: an hour or more at the lowest priority on a
quarter of the cores (`TRILLION3D_MUTATION_CONCURRENCY` overriding), and a second run retests
only what changed. `--out <dir>` (default `.mesure/out/mutation/`) receives the score and the
lists in `summary.md`, the mutants each test file kills in `kills.tsv`, every surviving mutant by
file in `survivors.md`, and Stryker's `mutation.html` and `mutation.json`; `--mutate <glob>`
narrows the run to some sources.

A test file that kills no mutant catches no bug of the package's sources: it is strengthened until
it kills one, or deleted. A surviving mutant is a change no test notices: a test is added that
fails on it, or the mutant is equivalent (the change keeps every result) and the reason is written
beside the code.

### GPU Correctness Probes

`tests/browser/probes/` checks what the device computes: WGSL shader precision, error floors,
projection matrices, texel coordinates, readbacks. A probe's name contains a hyphen; the folder's
other files are its support modules, never run alone. `tests/browser/renders/` renders frames in
real Chromium and compares them. Both are found **by rule, never by a hand-curated list** (every
`tests/browser/renders/*.browser.ts` runs; explicit kebab-case names like `held-gpu-cut`,
`lighting-normal-small-scale`, as for benchmarks) and run together via `pnpm run test:gpu`
(`tests/browser/test-gpu.ts`). `tests/browser/test-gpu.test.ts` keeps **launched ∪ skipped == disk**
in each folder, and no exclusion outlives the file it names: no proof stops running unnoticed.

```bash
pnpm run test:gpu                                  # run all
node tests/browser/test-gpu.ts tests/browser/probes/reflection-cone.ts   # run single target
```

What cannot run is **declared** in `BROWSER_ECARTES` (`tests/browser/test-gpu.ts`) with category and
reason, printed before starting — never in silence:

- **montage** (setup) — the proof is valid but the machine is not ready: assets in `.mesure/assets/`
  need recompiling, `timestamp-query` unavailable.
- **regression** — the proof fails on an open issue: a debt fixed in the engine.
- **stale-double** — the proof keeps a manual copy of a contract that drifted in the source: read
  the contract instead of duplicating it.

`BROWSER_ECARTES` is empty: every render proof runs.

- `scene-webgpu` reads the compiled cache of `DEFAULT_SCENE` (`sponza-derived`) under
  `.mesure/assets/`, off git; a sibling worktree has none: point `TRILLION3D_ASSETS` at the shared
  folder, else the proof stops by name on the missing cache and `pnpm run test:gpu` fails loudly.
- `geometry-network` reads the same cache over Chrome's emulated network (60 ms, 30 Mb/s) and
  asserts orderings, never durations: geometry page reads overlap, the pool admits the same pages,
  the view ahead grows with the round trip, cache objects arrive brotli-encoded;
  `NETWORK_PROOF_DIST=<other>/dist` runs another build's engine against it.
- `witness-materials` needs no asset: fixtures are built in the page and served from
  `tests/browser/support/`, the SDK from `dist/`, so `pnpm run build` precedes it.
- `tests/browser/probes/public-scenes.ts` needs no GPU or browser: in a tenth of a second it asserts
  what each public scene's cache guarantees — a DAG climbing above level 0 wherever a primitive
  holds more than one cluster, a mirrored mapping locking no vertex. It never builds caches: without
  `node bench/runner/assets.ts` and a facade (`node bench/runner/scenes/facade.ts --seed 7`, then
  `node bench/runner/assets.ts --only facade-7`) it fails by name on the missing cache.
- `page-tangents` compares a normal-mapped surface with authored and mirrored tangents drawn from
  its geometry pages and from its source buffers, on WebGPU: to the pixel when blended, recorded
  when opaque (its header says why). `node bench/runner/scenes/tangentScenes.ts` writes its four
  scenes derived from `normal-tangent-mirror-test` and prints the `assets.ts --only` line compiling
  them; `node tests/browser/test-gpu.ts tests/browser/renders/page-tangents.browser.ts` runs it. The
  acceptance session runs it on `develop` after the merge (AGENTS.md rule 2).

`node bench/runner/assets.ts` fetches and compiles every scene the proofs read
([Assets](../bench/runner/README.md#assets)).

#### Known failures of `test:gpu`, and where they were read

`test:gpu` drives a real GPU, so its result belongs to a machine: a batch declares the failures it
inherited, not those it caused, against this written baseline. Last read on an Apple M2 Max
(Mac14,6), macOS 27.0, Chrome headless, `TRILLION3D_ASSETS` on the shared `.mesure/assets/`,
2026-09-23, head of #281: **2 fail** of 64 (before #281: 10 fail, 54 pass, at `ea7e3ecf4` and the
head of #322).

- `shadow-camera-stop`: at the stop, with 198 shadow pages pending under the 0.01 ms budget, 57 705
  of 876 096 pixels (6.6 %, bound 5 %) shade otherwise than at rest — lit arches far from the camera
  read as shadowed. Publishing the current extent's matrix with the wrap origin of an undrawn slid
  cascade moved this by under 0.2 % and was not kept; the cause is not isolated.
- `explorer-startup`: failed through the geometry-garden lesson's own mounting (a 300 × 150 buffer
  under a 488 × 20 px CSS box, no animation frame in 1.5 s); that lesson left the portal (#327,
  `18ce55b5b`, with `explorerStartupGarden.ts`) and the proof now drives the engine's interactive
  session; #492 showed the engine resizes and schedules a grown canvas
  (`world/session/interactive.test.ts`). It leaves this list once the acceptance session re-reads it
  passing.

A batch leaving exactly these failing changed nothing here; one adding a failure owns it. The pass
count moves with the number of proof files. The failures are not portable, only the method: re-read
the baseline on your own machine.

### Site proofs

The portal under `site/` has its own proofs, run on demand in system Chrome. The two
`scripts/docs-*.browser.ts` and `tests/browser/renders/explorer-startup.browser.ts` build the site
into `dist/site/` first (no committed bundle); CI has no GPU and runs none, the acceptance session
runs them on `develop`. `scripts/docs-examples.browser.ts` opens every page of `site/examples/` on
WebGPU and WebGL2 (`navigator.gpu` hidden) and fails on any error a page raises or logs — a failed
import, a 404, the engine's own failures — except those `DECLARED_ERRORS` names
(`scripts/docs/examples/capture.ts`), each with its reason. A behaviour-neutral site change is
proved by `node scripts/site-diff.browser.ts <beforeDir> <afterDir>`: every portal route (entries
and examples in every language, examples index, API index, reports, not found) served from two built
trees, settled, its DOM compared after normalising what is dynamic (canvas contents and sizes,
`disabled`, stat values, generated ids, frame metrics).
`node scripts/site-first-load.ts <siteDir> [route ...]` measures a route's first load
(DOMContentLoaded, settled, requests, bytes) over cold contexts: a measurement, not a proof.

### Performance Benchmarks

A benchmark measures a package computation on named cases and **compares it to an oracle**: the
pre-optimization implementation, copied verbatim under `bench/oracles/`. Each line gives median,
p95, nanoseconds per element, operations per second, baseline difference, witness difference and the
oracle verdict. `mesure()` refuses to run if the file a benchmark reports as measured does not
exist.

A **witness** (`temoin` in `mesure()`) is a second calculation of the same thing — the host library,
a rejected candidate — timed on the same input and settings; the row keeps its statistics under
`temoin`, and "vs witness" reads the median relative to it as "vs baseline" does to the baseline. A
witness is a comparison, never a regression gate: the column carries no icon.

Three verdict types, never silence:

- **✓ / ✗** — bitwise equality (`diff.ts`: `-0`, `NaN`, typed arrays, `Map`, `Set`), or declared
  tolerance (`differences` + `tolere`, in ULPs by `ulp.ts`).
- **published diff** (`ecartPublie`) — the benchmark measures a _rejected_ candidate and quantifies
  the displacement instead of expecting equality: C1 (`raster-tampon`) and C3 (`pages-anneau`).
- **reason** — no oracle exists; the line says why and where correctness is held. A stale oracle is
  declared, never silently removed.

**The reference-library duels** (`bench/perf/core/three-vs-core-*.perf.ts`, `pnpm run perf:core`)
run the host library and the engine on the same seeded inputs, one row per calculation family, Three
the witness and its result read untimed as the oracle; they refuse an engine that differs by a bit
or runs slower, and the `duel` helper's own `node:test` enforces each family's declared ceiling. The
four `three-vs-core-batch-*.perf.ts` — `volumes` (frustum, spheres, unions, points, directions),
`matrices` (invert, normal, compose), `instances` (per-instance points, decompose, transformed
union), `colors` (the two curves) — pit the reference's `for` loop over 200 000 elements against one
batch call. A line: both medians, the ratio, the verdict — bit for bit, or within the tolerance it
declares once (the sRGB curves), and under a declared ceiling where the sides compute different
things (`Matrix4.invert`, `NormalMatrix3`: the engine keeps its singularity policy). `docs/MATHS.md` §
"Batch functions" carries the ratios of one published run.

## 3. Baselines and Report

`pnpm run perf:all` writes one fragment per domain into `.mesure/perf/`;
`bench/runner/perf/aggregate.ts` joins them into `.mesure/out/perf/perf-<date>.md` and `.json`.
`pnpm run perf:baseline` turns fragments into baselines under `.mesure/baselines/`, one per domain,
keyed by measurement/case — **off git and machine-specific**. Without one, "vs baseline" shows `—`
and the report says no baseline exists on this machine, never zero regression. Fragments and
baselines carry `version: 3` (rows keyed `name` / `size`, in English); an older file is ignored and
`pnpm run perf:baseline` records it again. The report flags machine load above 4: timings are then
inconclusive.

### What Benchmarks Do Not Measure

Timers run in the process that just ran the oracle, after warmup: enough to track regressions
between batches on one machine, not a campaign. A publishable campaign uses the `bench/runner/`
harness under the rules of [Measure before
optimising](../CONTRIBUTING.md#measure-before-optimising).

## 4. Quality Gates

| Command | Role |
| --- | --- |
| `pnpm run check:lines` | Maximum 200 physical lines per maintained JS/TS/Rust file |
| `pnpm run check:duplicates` | No duplicated blocks ≥ 8 lines and ≥ 64 tokens |
| `pnpm run check:helpers` | No small helper copied into a second module of the same package |
| `pnpm run check:english` | No new French word in the code: a count per package that only goes down |
| `pnpm run check:translations` | No translation left behind when its English changes |
| `pnpm run check:thumbnails` | Report, not a gate: the examples the recette still has to capture |
| `pnpm run check:structure` | sdk-core typed without DOM; the boundary tests run in the unit suite |
| `pnpm run check:unused` | Dead exports and files (`knip`) |
| `pnpm run check:no-js` | No JavaScript source under `site/`: the site is TypeScript |
| `pnpm run check:docs-three` | Three.js named only in witness, benchmark, measurement or migration sections |
| `pnpm run check:docs-bundles` | No build product of the site (`dist/site/`) is tracked by git |
| `pnpm run check:site-types` | The site under `site/` type-checks (`tsconfig.site.json`, `allowJs` off) |
| `pnpm run validate` | Complete gate: formatting, linting, tests, builds, structure, links |

`check:english` counts per package the French words of `scripts/french-words.ts` in every source
file's identifiers, comments and strings (strings a program reads, named there, excepted); above
`scripts/english-baseline.json` fails, below is written there, committed with the renaming.
`check:translations` fails when an entry's English changed and a language's translation did not,
against the hashes of `site/content/i18n/translation-sources.json`;
`pnpm run check:translations --write` records new hashes after translating. An English change no
translation needs (a typo) is accepted by name once each translation was checked:
`pnpm run check:translations --accept <entry> [<entry>…]` (as the gate names it,
`portal:nav.primary`) records the new English hash and keeps the translations', so the acceptance
shows in the diff; an unchanged entry is refused. Both records start from `--write`.

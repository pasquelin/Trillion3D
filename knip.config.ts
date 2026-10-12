// The SDK's source entries are public; the GPU proofs run on the bench, outside pnpm test.
// `pageWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import; so do `physicsWorker.ts`, the physics session,
// and `animationWorker.ts`, the animation samples taken ahead.
import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // The root project alone: the other workspaces, the compiler's platform packages
  // (`packages/compiler/*`, #1352), are a `package.json` each and carry no source.
  workspaces: {
    '.': {
      entry: [
        // Served to a bench page as `../runtime/kit.js` (`bench/dawn/page.ts`).
        'bench/kit/index.ts',
        // The report format the site reads from a pinned engine checkout: a public contract.
        'bench/kit/report/*.ts',
        'packages/sdk-browser/src/page/work/pageWorker.ts',
        'packages/sdk-browser/src/page/integration/pageIntegrationWorker.ts',
        'packages/sdk-browser/src/physics/physicsWorker.ts',
        'packages/sdk-browser/src/animation/animationWorker.ts',
        // The public API's source (`scripts/sdk-api-model.ts`, `ENTRIES`): the facade below is
        // generated from these three entries, so every name they export is public.
        'packages/sdk-core/src/index.ts',
        'packages/sdk-browser/src/index.ts',
        'packages/sdk-node/src/index.mts',
        'packages/sdk/{index,browser,node}.{ts,mts}',
        // The second pass of `check:unused` (`scripts/check-unused.ts`), read by knip itself.
        'knip.production.config.ts',
        // Every unit test runs by `node --test`: an entry by rule.
        '{packages,bench,tests,scripts}/**/*.test.ts',
        // The scripts `package.json` and the workflows run are found by knip itself. Any other
        // script is dead.
        // Run by hand: the area-light table fit (`ltcTable.ts`).
        'scripts/ltc-fit.ts',
        // Run by `scripts/build.ts`, steps of `pnpm run build`.
        'scripts/{build-witnesses,copy-resources}.ts',
        // Run by git through the one-line shims of `.githooks/`.
        'scripts/hooks/{delegate,pre-commit,pre-push}.ts',
        // Run by the pre-commit hook.
        'scripts/format-staged.ts',
        'bench/runner/bench.ts',
        // The GPU bench in Node (`pnpm run bench:gpu`, `bench:gpu:suite`), its recorder, and the
        // first module of its worker threads, started by URL (`bench/dawn/worker.ts`).
        'bench/dawn/{run,suite,recorder,workerBoot}.ts',
        // The cost model's command lines: the scale laws' sweeps, the model itself.
        'bench/dawn/{laws/sweep,laws/cook,laws/table,model/run}.ts',
        // The water and anisotropy costs on Dawn, launched by hand.
        'bench/dawn/{waterCost,anisotropyCost}.ts',
        'bench/runner/trajectory/trajectory.ts',
        'bench/runner/references/reference.ts',
        // Compiled by path by the public types audit (`public-types-audit.test.ts`), never imported.
        'tests/integration/public-types-union.fixture.ts',
        // Served to the harness page and imported by URL, never by local import.
        'bench/runner/series/cutPage.ts',
        'bench/runner/harness/explorerPage.ts',
        'bench/runner/lighting/lightingPage.ts',
        'bench/runner/references/referencePage.ts',
        'bench/runner/trajectory/trajectoryPage.ts',
        'bench/runner/trajectory/poses.ts',
        'bench/runner/witness/threeBarePage.ts',
        'bench/runner/witness/threeLodPage.ts',
        'bench/runner/harness/measurePage.ts',
        'bench/runner/fluids/fluidsPage.ts',
        // Recette imports these measurement/reference modules by URL (bench/runner/README.md).
        'bench/runner/witness/deformationWitness.ts',
        'bench/runner/gaze/gazeNetworkPage.ts',
        'bench/runner/harness/limits.ts',
        'bench/runner/screenError/screenErrorPage.ts',
        // The witness entry: bundled into `dist/witnesses/measurement.js` and imported by URL by those
        // pages; it re-exports the engine's measurement seam.
        'bench/witnesses/measurement.ts',
        // The report's export, launched manually.
        'bench/runner/summary/summaryGlobal.ts',
        'bench/runner/counts/pageQuantization.ts',
        'bench/runner/references/oracle.ts',
        // What the public scenes' caches guarantee (`node --test`, off the unit suite: no assets).
        'bench/runner/screenError/screenError.ts',
        'bench/perf/*/*.perf.ts',
        'bench/runner/perf/*.ts',
        // The GPU proofs (render proofs and kebab-case probes), the page modules they load by path,
        // and the public-API fixtures the type-check test compiles by path. Kit, support and fixture
        // helpers are not entries: an export no test imports is reported.
        'tests/gpu/**/*.gpu.ts',
        'tests/gpu/**/*.chrome.ts',
        'tests/gpu/**/*Page.ts',
        'tests/fixtures/public/*.{ts,mts}',
      ],
      project: [
        'packages/**/*.{ts,mts}',
        'scripts/**/*.{ts,mts}',
        'tests/**/*.{ts,mts}',
        'bench/**/*.{ts,mts}',
        '*.{ts,mts}',
      ],
      paths: {
        '/packages/sdk-browser/*': ['packages/sdk-browser/*'],
      },
      // The harness server maps this browser URL to the page entry above.
      ignoreUnresolved: ['/runner/feedback/feedbackTargetPage.ts'],
      // Rust and its formatter, CMake, Emscripten and the C++ compiler (a regex: knip reads `c++` as
      // one) are platform tools. The tap runner is a Stryker plugin, loaded by name
      // (`scripts/test-mutation.ts`).
      ignoreDependencies: ['@stryker-mutator/tap-runner'],
      // `ioreg` and `sips`: macOS's own, the GPU bench reads how busy other programs keep the GPU
      // and decodes the images its pages load.
      ignoreBinaries: [
        'rustc',
        'rustfmt',
        'emcmake',
        'cmake',
        'em-config',
        /^c\+\+$/,
        'ioreg',
        'sips',
      ],
    },
  },
}

export default config

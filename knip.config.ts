// The SDK's source entries are public; the GPU proofs run on the bench, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import; so do `physicsWorker.ts`, the physics session,
// and `animationWorker.ts`, the animation samples taken ahead.
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // The root project alone: the other workspaces, the compiler's platform packages
  // (`packages/compiler/*`, #1352), are a `package.json` each and carry no source.
  workspaces: {
    '.': {
      entry: [
        'site/app/main.tsx',
        'site/examples/kit/index.ts',
        'packages/sdk-browser/src/page/decode/pageDecodeWorker.ts',
        'packages/sdk-browser/src/page/integration/pageIntegrationWorker.ts',
        'packages/sdk-browser/src/physics/physicsWorker.ts',
        'packages/sdk-browser/src/math/animationWorker.ts',
        // The public API's source (`scripts/sdk-api-model.ts`, `ENTRIES`): the facade below is
        // generated from these three entries, so every name they export is public.
        'packages/sdk-core/src/index.ts',
        'packages/sdk-browser/src/index.ts',
        'packages/sdk-node/src/index.mts',
        'packages/sdk/{index,browser,node}.{ts,mts}',
        'packages/page-codec/src/geometryPage.ts',
        // The second pass of `check:unused` (`scripts/check-unused.ts`), read by knip itself.
        'knip.production.config.ts',
        'packages/**/*.test.ts',
        // The scripts `package.json` and the workflows run are found by knip itself; the tests, run
        // by `node --test`, are entries by rule. Any other script is dead.
        'scripts/**/*.test.ts',
        // Run by hand: the example scenes' sources and thumbnails (`docs/LEARNING_PORTAL.md`), the
        // first-load proof of the site (`docs/TESTS.md`), the area-light table fit (`ltcTable.ts`),
        // the Install page walkthrough (#1355, the recette's Chrome proof).
        'scripts/docs/examples-assets.ts',
        'scripts/docs/examples-thumbnails.ts',
        'scripts/site-first-load.ts',
        'scripts/ltc-fit.ts',
        'scripts/prove-install-page.ts',
        // Run by `scripts/build.ts`, steps of `pnpm run build`.
        'scripts/{build-witnesses,copy-resources}.ts',
        // Run by git through the one-line shims of `.githooks/`.
        'scripts/hooks/{delegate,pre-commit,pre-push}.ts',
        'bench/runner/bench.ts',
        // The GPU bench in Node (`pnpm run bench:gpu`, `bench:gpu:suite`), its recorder, and the
        // first module of its worker threads, started by URL (`bench/dawn/worker.ts`).
        'bench/dawn/{run,suite,recorder,workerBoot}.ts',
        'bench/runner/feedbackTargetAb.ts',
        'bench/runner/trajectory.ts',
        'bench/runner/reference.ts',
        // Compiled by path by the public types audit (`public-types-audit.test.ts`), never imported.
        'tests/integration/public-types-union.fixture.ts',
        // Served to the harness page and imported by URL, never by local import.
        'bench/runner/series/cutPage.ts',
        'bench/runner/witnessPage.ts',
        'bench/runner/explorerPage.ts',
        'bench/runner/lightingPage.ts',
        'bench/runner/referencePage.ts',
        'bench/runner/trajectoryPage.ts',
        'bench/runner/poses.ts',
        'bench/runner/threeBarePage.ts',
        'bench/runner/threeLodPage.ts',
        'bench/runner/measurePage.ts',
        'bench/runner/fluidsPage.ts',
        // Recette imports these measurement/reference modules by URL (bench/runner/README.md).
        'bench/runner/deformationEnvelope.ts',
        'bench/runner/deformationWitness.ts',
        'bench/runner/feedbackTargetPage.ts',
        'bench/runner/gazeNetworkPage.ts',
        'bench/runner/limits.ts',
        'bench/runner/screenErrorPage.ts',
        // The witness entry: bundled into `dist/witnesses/measurement.js` and imported by URL by those
        // pages; it re-exports the engine's measurement seam.
        'bench/witnesses/measurement.ts',
        // Full campaign and its report, launched manually.
        'bench/runner/campaign.ts',
        'bench/runner/summary/summaryGlobal.ts',
        'bench/runner/pageQuantization.ts',
        'bench/runner/oracle.ts',
        'bench/runner/lampFixture.ts',
        'bench/runner/anisotropyCost.ts',
        // What the public scenes' caches guarantee (`node --test`, off the unit suite: no assets).
        'bench/runner/waterCost.ts',
        'bench/runner/screenError.ts',
        'bench/perf/*/*.perf.ts',
        'bench/runner/perf/*.ts',
        // Tests by rule: unit and integration tests, the GPU proofs (render proofs and kebab-case
        // probes), the page modules they load by path, and the public-API fixtures
        // the type-check test compiles by path. Kit, support and fixture helpers are not entries: an
        // export no test imports is reported.
        'tests/**/*.test.ts',
        'tests/gpu/**/*.gpu.ts',
        'tests/gpu/**/*.chrome.ts',
        'tests/gpu/**/*Page.ts',
        'tests/fixtures/public/*.{ts,mts}',
      ],
      project: [
        'site/**/*.{ts,tsx}',
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
      ignoreUnresolved: ['/runner/feedbackTargetPage.ts'],
      // Rust, CMake, Emscripten and the C++ compiler (a regex: knip reads `c++` as one) are platform
      // tools; DaisyUI is loaded by Tailwind; the site build copies SVG files of
      // flag-icons by path (`scripts/docs/build-flags.ts`), importing no module of it.
      // The tap runner is a Stryker plugin, loaded by name (`scripts/test-mutation.ts`).
      ignoreDependencies: ['daisyui', 'flag-icons', '@stryker-mutator/tap-runner'],
      // `ioreg` and `sips`: macOS's own, the GPU bench reads how busy other programs keep the GPU
      // and decodes the images its pages load.
      ignoreBinaries: ['rustc', 'emcmake', 'cmake', 'em-config', /^c\+\+$/, 'ioreg', 'sips'],
    },
  },
};

export default config;

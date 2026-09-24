// The SDK's source entries are public; browser probes are launched by the host, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import; so does `physicsWorker.ts`, the physics session.
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'site/app/main.tsx',
    'site/examples/kit/index.ts',
    'packages/sdk-browser/src/page/decode/pageDecodeWorker.ts',
    'packages/sdk-browser/src/page/integration/pageIntegrationWorker.ts',
    'packages/sdk-browser/src/physics/physicsWorker.ts',
    'packages/sdk-node/src/index.mts',
    'packages/sdk/{index,browser,node}.{ts,mts}',
    'packages/page-codec/geometryPage.ts',
    'packages/**/*.test.ts',
    // The scripts `package.json` and the workflows run are found by knip itself; the tests and
    // the browser proofs, run by `node --test`, are entries by rule. Any other script is dead.
    'scripts/*.test.ts',
    'scripts/*.browser.ts',
    // Run by hand: the example scenes' sources and thumbnails (`docs/LEARNING_PORTAL.md`), the
    // first-load proof of the site (`docs/TESTS.md`), the area-light table fit (`ltcTable.ts`).
    'scripts/docs-examples-assets.ts',
    'scripts/docs-examples-thumbnails.ts',
    'scripts/site-first-load.ts',
    'scripts/ltc-fit.ts',
    'bench/runner/bench.ts',
    // Served to the harness page and imported by URL, never by local import.
    'bench/runner/cutPage.ts',
    'bench/runner/witnessPage.ts',
    'bench/runner/explorerPage.ts',
    'bench/runner/lightingPage.ts',
    'bench/runner/poses.ts',
    'bench/runner/threeBarePage.ts',
    'bench/runner/threeLodPage.ts',
    'bench/runner/measurePage.ts',
    // The measurement entry: served as `measurement.js` and imported by URL by those pages.
    'packages/sdk-browser/src/measurement/measurement.ts',
    // Full campaign and its report, launched manually.
    'bench/runner/campaign.ts',
    'bench/runner/summaryGlobal.ts',
    'bench/runner/pageQuantization.ts',
    'bench/runner/oracle.ts',
    'bench/runner/lampFixture.ts',
    'bench/runner/anisotropyCost.ts',
    'bench/perf/*/*.perf.ts',
    'bench/runner/perf/*.ts',
    // Tests by rule: unit and integration tests, the browser proof runners (render proofs and
    // kebab-case probes), the pages and modules they serve by URL, and the public-API fixtures
    // the type-check test compiles by path. Kit, support and fixture helpers are not entries: an
    // export no test imports is reported.
    'tests/**/*.test.ts',
    'tests/browser/renders/*.browser.ts',
    'tests/browser/probes/*-*.ts',
    'tests/browser/**/*Page.ts',
    'tests/browser/support/drawRun.ts',
    'tests/fixtures/public*.{ts,mts}',
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
  // Rust is a platform tool; DaisyUI is loaded by Tailwind; the site build copies SVG files of
  // flag-icons by path (`scripts/docs/build-flags.ts`), importing no module of it.
  ignoreDependencies: ['daisyui', 'flag-icons'],
  ignoreBinaries: ['rustc', 'emcmake', 'cmake', 'em-config'],
  // These specifiers are harness server URLs resolved by the browser, not local Node modules.
  ignoreUnresolved: ['/runner/witnessPage.ts'],
};

export default config;

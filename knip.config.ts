// The SDK's source entries are public; browser probes are launched by the host, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import.
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'site/app/main.tsx',
    'site/demos/engine.ts',
    'packages/sdk-browser/src/page/decode/pageDecodeWorker.ts',
    'packages/sdk-browser/src/page/integration/pageIntegrationWorker.ts',
    'packages/sdk-node/src/index.mts',
    'packages/sdk/{index,browser,node}.{ts,mts}',
    'scripts/generate-sdk-facade.ts',
    'packages/page-codec/geometryPage.ts',
    'packages/**/*.test.ts',
    'scripts/*.ts',
    'bench/runner/banc.ts',
    // Served to the harness page and imported by URL, never by local import.
    'bench/runner/pageCoupe.ts',
    'bench/runner/pageTemoin.ts',
    'bench/runner/pageExplorateur.ts',
    'bench/runner/pageEclairage.ts',
    'bench/runner/poses.ts',
    'bench/runner/pageThreeNu.ts',
    'bench/runner/pageThreeLod.ts',
    'bench/runner/pageMesure.ts',
    // The measurement entry: served as `measurement.js` and imported by URL by those pages.
    'packages/sdk-browser/src/measurement/measurement.ts',
    // Full campaign and its report, launched manually.
    'bench/runner/campagne.ts',
    'bench/runner/rapportGlobal.ts',
    'bench/runner/quantificationPages.ts',
    'bench/runner/oracle.ts',
    'bench/runner/fixtureLampes.ts',
    'bench/perf/*/*.perf.ts',
    'bench/runner/perf/*.ts',
    // Every test module: probes, render proofs and the pages they serve by URL.
    'tests/**/*.{ts,mts}',
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
  // Rust is a platform tool; DaisyUI is loaded by Tailwind.
  ignoreDependencies: ['daisyui'],
  ignoreBinaries: ['rustc'],
  // These specifiers are harness server URLs resolved by the browser, not local Node modules.
  ignoreUnresolved: ['/mesure/pageTemoin.ts'],
};

export default config;

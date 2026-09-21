// The SDK's source entries are public; browser probes are launched by the host, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import.
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'site/app/main.tsx',
    'site/demos/engine.ts',
    'packages/sdk-browser/pageDecodeWorker.ts',
    'packages/sdk-browser/pageIntegrationWorker.ts',
    'packages/sdk-node/{index,cli}.mts',
    'packages/sdk/{index,browser,node}.{ts,mts}',
    'scripts/generate-sdk-facade.ts',
    'packages/page-codec/geometryPage.ts',
    'packages/**/*.test.ts',
    'scripts/*.ts',
    'scripts/mesure/banc.ts',
    // Served to the harness page and imported by URL, never by local import.
    'scripts/mesure/pageCoupe.ts',
    'scripts/mesure/pageTemoin.ts',
    'scripts/mesure/pageExplorateur.ts',
    'scripts/mesure/pageEclairage.ts',
    'scripts/mesure/poses.ts',
    'scripts/mesure/pageThreeNu.ts',
    'scripts/mesure/pageThreeLod.ts',
    'scripts/mesure/pageMesure.ts',
    // Full campaign and its report, launched manually.
    'scripts/mesure/campagne.ts',
    'scripts/mesure/rapportGlobal.ts',
    'scripts/mesure/oracle.ts',
    'scripts/mesure/fixtureLampes.ts',
    'packages/*/bench/*.perf.ts',
    'test/justesse/*.ts',
    'scripts/mesure/perf/*.ts',
    'test/integration/*.test.ts',
    'test/browser/*.browser.ts',
  ],
  project: [
    'site/**/*.{ts,tsx}',
    'packages/**/*.{ts,mts}',
    'scripts/**/*.{ts,mts}',
    'test/**/*.{ts,mts}',
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

// The SDK's source entries are public; browser probes are launched by the host, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import.
export default {
  entry: [
    'docs/react/main.jsx',
    'scripts/docs/highlight-entry.mjs',
    'packages/sdk-browser/pageDecodeWorker.ts',
    'packages/sdk-browser/pageIntegrationWorker.ts',
    'packages/sdk-node/{index,cli}.mts',
    'packages/page-codec/geometryPage.mjs',
    'packages/**/*.test.{ts,mjs}',
    'scripts/*.mjs',
    'scripts/mesure/banc.mjs',
    // Served to the harness page and imported by URL, never by local import.
    'scripts/mesure/pageCoupe.mjs',
    'scripts/mesure/pageTemoin.mjs',
    'scripts/mesure/pageExplorateur.mjs',
    'scripts/mesure/pageEclairage.mjs',
    'scripts/mesure/poses.mjs',
    'scripts/mesure/pageThreeNu.mjs',
    'scripts/mesure/pageThreeLod.mjs',
    'scripts/mesure/pageMesure.mjs',
    // Full campaign and its report, launched manually.
    'scripts/mesure/campagne.mjs',
    'scripts/mesure/rapportGlobal.mjs',
    'scripts/mesure/oracle.mjs',
    'scripts/mesure/fixtureLampes.mjs',
    'packages/*/bench/*.perf.mjs',
    'test/justesse/*.mjs',
    'scripts/mesure/perf/*.mjs',
    'test/integration/*.test.mjs',
    'test/browser/*.browser.mjs',
  ],
  project: [
    'docs/react/**/*.jsx',
    'packages/**/*.{ts,mts,mjs,js}',
    'scripts/**/*.{ts,mts,mjs,js}',
    'test/**/*.{ts,mts,mjs,js}',
    'types/**/*.{ts,mts}',
    '*.{js,mjs,ts,mts}',
  ],
  paths: {
    '/packages/sdk-browser/*': ['packages/sdk-browser/*'],
  },
  // Rust and the image utility are platform tools; DaisyUI is loaded by Tailwind.
  ignoreDependencies: ['daisyui'],
  ignoreBinaries: ['rustc'],
  // These specifiers are harness server URLs resolved by the browser, not local Node modules.
  ignoreUnresolved: ['/mesure/poses.mjs', '/__wg-fixture/drawRun.mjs'],
};

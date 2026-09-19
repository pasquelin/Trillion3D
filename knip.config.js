// The SDK's source entries are public; browser probes are launched by the host, outside pnpm test.
// `pageDecodeWorker.ts` and `pageIntegrationWorker.ts` are worker entry points: the pool and the
// integration lane load them by URL, never by import.
export default {
  entry: [
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
    'packages/**/*.{ts,mts,mjs,js}',
    'scripts/**/*.{ts,mts,mjs,js}',
    'test/**/*.{ts,mts,mjs,js}',
    'types/**/*.{ts,mts}',
    '*.{js,mjs,ts,mts}',
  ],
  paths: {
    '/packages/sdk-browser/*': ['packages/sdk-browser/*'],
  },
  // `scripts/build-wasm.mjs` queries the Rust toolchain installed by rustup, not an npm package;
  // `sips` is the macOS image tool called by the global report for its JPEGs.
  ignoreBinaries: ['rustc', 'sips'],
  // These specifiers are Vite/Render Tech Lab runtime URLs, not local Node modules.
  ignoreUnresolved: [
    '/.vite/deps/three.js',
    '/15-virtualized-integration/implementation/engines.ts',
    '/src/lab/modelCampaign.ts',
    '/__wg-fixture/presentationRun.mjs',
    '/__wg-fixture/beautyRun.mjs',
    '/__wg-fixture/drawRun.mjs',
  ],
};

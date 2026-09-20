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
    // Servis à la page du harnais et importés par leur URL, jamais par un import local.
    'scripts/mesure/pageCoupe.mjs',
    'scripts/mesure/pageTemoin.mjs',
    'scripts/mesure/pageExplorateur.mjs',
    'scripts/mesure/pageEclairage.mjs',
    'scripts/mesure/poses.mjs',
    'scripts/mesure/pageThreeNu.mjs',
    'scripts/mesure/pageThreeLod.mjs',
    'scripts/mesure/pageMesure.mjs',
    // La campagne complète et son rapport, lancés à la main.
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
  // `scripts/build-wasm.mjs` interroge la chaîne Rust installée par rustup, pas un paquet npm ;
  // `sips` est l'outil d'image de macOS, que le rapport global appelle pour ses JPEG.
  ignoreBinaries: ['rustc', 'sips'],
  // These specifiers are harness server URLs resolved by the browser, not local Node modules.
  ignoreUnresolved: ['/mesure/poses.mjs', '/__wg-fixture/drawRun.mjs'],
};

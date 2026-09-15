// The SDK's source entries are public; browser probes are launched by the host, outside npm test.
// `pageDecodeWorker.ts` is a worker entry point: the pool loads it by URL, never by import.
export default {
  entry: [
    'packages/sdk-browser/pageDecodeWorker.ts',
    'packages/sdk-node/{index,cli}.mts',
    'packages/page-codec/geometryPage.mjs',
    'packages/**/*.test.{ts,mjs}',
    'scripts/*.mjs',
    'scripts/mesure/banc.mjs',
    'scripts/mesure/oracle.mjs',
    'scripts/mesure/fixtureLampes.mjs',
    'packages/*/bench/*.bench.mjs',
    'scripts/mesure/calculs/agrege*.mjs',
    'test/*.test.mjs',
    'test/*.browser.mjs',
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
  // `scripts/build-wasm.mjs` interroge la chaîne Rust installée par rustup, pas un paquet npm.
  ignoreBinaries: ['rustc'],
  // These specifiers are Vite/Render Tech Lab runtime URLs, not local Node modules.
  ignoreUnresolved: [
    '/.vite/deps/three.js',
    '/15-virtualized-integration/implementation/engines.ts',
    '/src/lab/modelCampaign.ts',
    '/__wg-fixture/presentationRun.mjs',
    '/__wg-fixture/smallTrianglesRun.mjs',
    '/__wg-fixture/beautyRun.mjs',
    '/__wg-fixture/captureRun.mjs',
    '/__wg-fixture/drawRun.mjs',
  ],
};

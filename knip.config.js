// The SDK's source entries are public; browser probes are launched by the host, outside npm test.
export default {
  entry: [
    'packages/sdk-node/{index,cli}.mts',
    'packages/page-codec/geometryPage.mjs',
    'packages/**/*.test.{ts,mjs}',
    'scripts/*.mjs',
    'scripts/mesure/banc.mjs',
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
  // `uptime` is a system binary the harness reads the machine load from, not an npm dependency.
  ignoreBinaries: ['uptime'],
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

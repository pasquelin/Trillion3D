import { runInstalledBrowser } from './installed-package-browser.mjs';

const canvases = '<canvas id="primer"></canvas><canvas id="replay"></canvas>';

export function proveInstalledBrowser({ fixture, packageName, browserEntry, ...urls }) {
  const imports = {
    [packageName]: `/node_modules/${packageName}/${browserEntry}`,
    three: '/node_modules/three/build/three.module.js',
    'three/addons/': '/node_modules/three/examples/jsm/',
    'three/': '/node_modules/three/',
    meshoptimizer: '/node_modules/meshoptimizer/index.module.js',
  };
  return runInstalledBrowser({
    root: fixture,
    html: `<!doctype html>${canvases}<script type="importmap">${JSON.stringify({ imports })}</script>`,
    moduleName: packageName,
    decodeWorkerPath: `/node_modules/${packageName}/dist/sdk-browser/pageDecodeWorker.js`,
    integrationWorkerPath: `/node_modules/${packageName}/dist/sdk-browser/pageIntegrationWorker.js`,
    commonWorkerPath: '/common-worker.js',
    allowNodeModules: true,
    ...urls,
  });
}

export function proveBundledInstalledBrowser({ outputRoot, ...urls }) {
  return runInstalledBrowser({
    root: outputRoot,
    html: `<!doctype html>${canvases}<script type="module" src="/explorer.js"></script>`,
    moduleName: null,
    decodeWorkerPath: '/pageDecodeWorker.js',
    integrationWorkerPath: '/pageIntegrationWorker.js',
    commonWorkerPath: '/common-worker.js',
    ...urls,
  });
}

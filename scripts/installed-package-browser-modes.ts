import { runInstalledBrowser } from './installed-package-browser.ts';
import type { InstalledBrowserProof } from './installed-package-browser-result.ts';

const canvases = '<canvas id="primer"></canvas><canvas id="replay"></canvas>';

interface CacheUrls {
  manifestUrl: string;
  replayUrl: string;
}

export function proveInstalledBrowser({
  fixture,
  packageName,
  browserEntry,
  ...urls
}: {
  fixture: string;
  packageName: string;
  browserEntry: string;
} & CacheUrls): Promise<InstalledBrowserProof> {
  const imports = {
    [packageName]: `/node_modules/${packageName}/${browserEntry}`,
    meshoptimizer: '/node_modules/meshoptimizer/index.module.js',
  };
  return runInstalledBrowser({
    root: fixture,
    html: `<!doctype html>${canvases}<script type="importmap">${JSON.stringify({ imports })}</script>`,
    moduleName: packageName,
    decodeWorkerPath: `/node_modules/${packageName}/dist/sdk-browser/src/page/decode/pageDecodeWorker.js`,
    integrationWorkerPath: `/node_modules/${packageName}/dist/sdk-browser/src/page/integration/pageIntegrationWorker.js`,
    commonWorkerPath: '/common-worker.js',
    allowNodeModules: true,
    ...urls,
  });
}

export function proveBundledInstalledBrowser({
  outputRoot,
  ...urls
}: {
  outputRoot: string;
} & CacheUrls): Promise<InstalledBrowserProof> {
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

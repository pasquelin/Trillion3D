import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launchChrome } from './mesure/chrome.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

function serverAt(root, html, requests) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture');
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (!relative) {
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(html);
      return;
    }
    if (relative.startsWith('..')) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(join(root, relative));
      requests.push({ path: url.pathname, status: 200 });
      response.writeHead(200, {
        'content-type': MIME[extname(relative)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      requests.push({ path: url.pathname, status: 404 });
      response.writeHead(404).end();
    }
  });
}

export async function proveInstalledBrowser({ fixture, packageName, browserEntry, manifestUrl }) {
  const imports = {
    [packageName]: `/node_modules/${packageName}/${browserEntry}`,
    three: '/node_modules/three/build/three.module.js',
    'three/': '/node_modules/three/',
    meshoptimizer: '/node_modules/meshoptimizer/index.module.js',
  };
  const html = `<!doctype html><canvas id="viewer"></canvas><script type="importmap">${JSON.stringify({ imports })}</script>`;
  const requests = [];
  const server = serverAt(fixture, html, requests);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser proof server unavailable');
  const browser = await launchChrome({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const metrics = await page.evaluate(
      async ({ packageName, manifestUrl }) => {
        const sdk = await import(packageName);
        const explorer = await sdk.createExplorer('viewer', {
          manifestUrl,
          scope: 'slice',
          interactive: true,
        });
        const deadline = performance.now() + 30_000;
        let value;
        do {
          value = explorer.metrics();
          if (
            value.pagesDecodedOffThread > 0 &&
            value.pagesDecodedWasm > 0 &&
            value.pagesPlannedOffThread > 0
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (performance.now() < deadline);
        explorer.dispose();
        return value;
      },
      { packageName, manifestUrl },
    );
    if (errors.length) throw new Error(`installed browser errors: ${errors.join('; ')}`);
    if (
      metrics.pagesDecodedOffThread < 1 ||
      metrics.pagesDecodedWasm < 1 ||
      metrics.pagesPlannedOffThread < 1
    )
      throw new Error('installed worker/WASM proof did not execute every selected path');
    const failed = requests.filter(({ status }) => status >= 400);
    if (failed.length)
      throw new Error(`installed browser requests failed: ${JSON.stringify(failed)}`);
    return { metrics, requests, errors };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

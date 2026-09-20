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
    response.setHeader('access-control-allow-origin', '*');
    const url = new URL(request.url ?? '/', 'http://fixture');
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (!relative) {
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(html);
      return;
    }
    if (relative === 'favicon.ico') {
      response.writeHead(204).end();
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
const evidenceRequests = (requests) =>
  requests.filter(
    ({ path, status }) =>
      status >= 400 ||
      path.includes('/native-cache') ||
      path.endsWith('Worker.js') ||
      path.endsWith('.wasm'),
  );
export async function proveInstalledBrowser({
  fixture,
  packageName,
  browserEntry,
  manifestUrl,
  replayUrl,
}) {
  const imports = {
    [packageName]: `/node_modules/${packageName}/${browserEntry}`,
    three: '/node_modules/three/build/three.module.js',
    'three/addons/': '/node_modules/three/examples/jsm/',
    'three/': '/node_modules/three/',
    meshoptimizer: '/node_modules/meshoptimizer/index.module.js',
  };
  const html = `<!doctype html><canvas id="primer"></canvas><canvas id="replay"></canvas><canvas id="codec"></canvas><script type="importmap">${JSON.stringify({ imports })}</script>`;
  const requests = [];
  const server = serverAt(fixture, html, requests);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser proof server unavailable');
  let browser;
  const errors = [];
  try {
    browser = await launchChrome({ headless: true });
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(
      async ({ packageName, manifestUrl, replayUrl }) => {
        const sdk = await import(packageName);
        const open = async (target, url) => {
          const explorer = await sdk.createExplorer(target, {
            manifestUrl: url,
            scope: 'slice',
            interactive: true,
          });
          const deadline = performance.now() + 30_000;
          while (!explorer.profiler.lastMetrics?.coverageReady && performance.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 50));
          return explorer;
        };
        const primer = await open('primer', manifestUrl);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const replay = await open('replay', replayUrl);
        const samples = [primer, replay].map((item) => item.profiler.lastMetrics);
        const value = { ...samples[1] };
        for (const key of ['pagesDecodedOffThread', 'pagesDecodedWasm', 'pagesPlannedOffThread'])
          value[key] = Math.max(...samples.map((sample) => sample?.[key] ?? 0));
        const pointerUrl = new URL(manifestUrl, location.href);
        const pointer = await (await fetch(pointerUrl)).json();
        const metadataUrl = new URL(pointer.url, pointerUrl);
        const slim = await (await fetch(metadataUrl)).json();
        const metadata = slim.binary
          ? sdk.decodeManifestBinary(
              slim,
              await (await fetch(new URL(slim.binary.url, metadataUrl))).arrayBuffer(),
            )
          : slim;
        const geometry = metadata.primitives
          .flatMap((primitive) => primitive.pages)
          .find((item) => item.geometry)?.geometry;
        if (!geometry) throw new Error('installed cache carries no geometry page');
        replay.dispose();
        primer.dispose();
        return { metrics: value, geometryUrl: new URL(geometry.url, metadataUrl).href };
      },
      {
        packageName,
        manifestUrl,
        replayUrl: `http://localhost:${address.port}${replayUrl}`,
      },
    );
    const { metrics, geometryUrl } = result;
    const workers = await page.evaluate(
      async ({ pageUrl, decodeWorkerUrl, integrationWorkerUrl }) => {
        const run = (workerUrl, request, transfer) => {
          const worker = new Worker(workerUrl, { type: 'module' });
          return new Promise((resolve, reject) => {
            worker.onerror = () => reject(new Error(`installed worker failed: ${workerUrl}`));
            worker.onmessage = ({ data }) => {
              worker.terminate();
              resolve(data);
            };
            worker.postMessage(request, transfer);
          });
        };
        const source = await (await fetch(pageUrl)).arrayBuffer();
        const decode = await run(
          decodeWorkerUrl,
          { protocol: 3, id: 1, op: 'decode', source, maxDecodedBytes: 16 * 1024 * 1024 },
          [source],
        );
        const specs = new Int32Array([0, 1, 7]);
        const integration = await run(
          integrationWorkerUrl,
          { protocol: 1, id: 1, url: 'installed-proof', words: 3, specs: specs.buffer },
          [specs.buffer],
        );
        return { decode, integration };
      },
      {
        pageUrl: geometryUrl,
        decodeWorkerUrl: `http://127.0.0.1:${address.port}/node_modules/${packageName}/dist/sdk-browser/pageDecodeWorker.js`,
        integrationWorkerUrl: `http://127.0.0.1:${address.port}/node_modules/${packageName}/dist/sdk-browser/pageIntegrationWorker.js`,
      },
    );
    const { decode: workerDecode, integration: workerIntegration } = workers;
    if (errors.length) throw new Error(`installed browser errors: ${errors.join('; ')}`);
    if (
      !(metrics?.pagesDecodedOffThread > 0) ||
      !workerDecode?.ok ||
      !workerDecode.wasm ||
      !workerIntegration?.ok ||
      workerIntegration.count !== 1 ||
      workerIntegration.pageCount !== 1
    )
      throw new Error(
        `installed worker/WASM proof did not execute every selected path: ${JSON.stringify({ metrics, workers })}`,
      );
    const failed = requests.filter(({ status }) => status >= 400);
    if (failed.length)
      throw new Error(`installed browser requests failed: ${JSON.stringify(failed)}`);
    return {
      metrics,
      workerDecode: {
        wasm: workerDecode.wasm,
        vertexCount: workerDecode.decoded?.vertexCount ?? null,
        taskMs: workerDecode.taskMs,
      },
      workerIntegration: {
        count: workerIntegration.count,
        pageCount: workerIntegration.pageCount,
        taskMs: workerIntegration.taskMs,
      },
      requests: evidenceRequests(requests),
      moduleRequestCount: requests.length,
      errors,
    };
  } catch (error) {
    const evidence = JSON.stringify(evidenceRequests(requests));
    throw new Error(`${String(error)}; requests=${evidence}; errors=${JSON.stringify(errors)}`, {
      cause: error,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

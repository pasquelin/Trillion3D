import { launchChrome } from './mesure/chrome.mjs';
import { installedBrowserResult } from './installed-package-browser-result.mjs';
import { evidenceRequests, installedServer } from './installed-package-server.mjs';
import { runInstalledWorkers } from './installed-package-workers.mjs';
export async function runInstalledBrowser({
  root,
  html,
  moduleName,
  decodeWorkerPath,
  integrationWorkerPath,
  commonWorkerPath,
  allowNodeModules = false,
  manifestUrl,
  replayUrl,
}) {
  const requests = [];
  const server = installedServer(root, html, requests, allowNodeModules);
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
      async ({ moduleName, manifestUrl, replayUrl, commonWorkerPath }) => {
        const deadline = performance.now() + 10_000;
        while (!moduleName && !globalThis.__installedSdk && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25));
        const sdk = moduleName ? await import(moduleName) : globalThis.__installedSdk;
        if (!sdk) throw new Error('installed explorer bundle did not start');
        const count = 2;
        const views = (buffer, stride) =>
          Array.from({ length: count }, (_, index) =>
            buffer.subarray(index * stride, (index + 1) * stride),
          );
        const world = new Float64Array(count * sdk.MATRIX_VALUES);
        sdk.hierarchyUpdateBatch(
          views(world, sdk.MATRIX_VALUES),
          views(new Float64Array([2, 3, 4, 5, 7, 11]), sdk.POSITION_VALUES),
          views(new Float64Array([0, 0, 0, 1, 0, 0, 0, 1]), sdk.QUATERNION_VALUES),
          views(new Float64Array(6).fill(1), sdk.POSITION_VALUES),
          new Uint32Array([sdk.HIERARCHY_ROOT, 0]),
          count,
          new Float64Array(sdk.MATRIX_VALUES),
        );
        const hierarchy = { world: Array.from(world.subarray(28, 31)), parent: 0 };
        if (hierarchy.world.join(',') !== '7,10,15')
          throw new Error('installed browser hierarchy did not execute');
        const commonWorker = await new Promise((resolve, reject) => {
          const worker = new Worker(commonWorkerPath, { type: 'module' });
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('installed common worker timed out'));
          }, 30_000);
          worker.onmessage = ({ data }) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve(data);
          };
          worker.onerror = (event) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(event.message));
          };
        });
        const open = async (target, url) => {
          const explorer = await sdk.createExplorer(target, {
            manifestUrl: url,
            scope: 'slice',
            interactive: false,
            pixelError: 1_000,
          });
          const readyBy = performance.now() + 30_000;
          while (!explorer.profiler.lastMetrics?.coverageReady && performance.now() < readyBy)
            await new Promise((resolve) => setTimeout(resolve, 50));
          await new Promise((resolve) => setTimeout(resolve, 250));
          explorer.setPose(explorer.pointsOfInterest()[0].pose);
          explorer.setPixelError(0);
          explorer.invalidate();
          await explorer.awaitPages();
          explorer.render();
          await explorer.flush();
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
        const capture = replay.capture();
        replay.render();
        await replay.flush();
        const repeated = replay.capture();
        let aaDifferentPixels = 0;
        for (let index = 0; index < capture.length; index += 4)
          if (
            capture[index] !== repeated[index] ||
            capture[index + 1] !== repeated[index + 1] ||
            capture[index + 2] !== repeated[index + 2] ||
            capture[index + 3] !== repeated[index + 3]
          )
            aaDifferentPixels++;
        const hash = async (bytes) =>
          [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
        const captureEvidence = {
          sha256: await hash(capture),
          repeatedSha256: await hash(repeated),
          aaDifferentPixels,
          byteLength: capture.byteLength,
          width: replay.canvas.width,
          height: replay.canvas.height,
          dpr: devicePixelRatio,
          pixelError: 0,
          camera: replay.pointsOfInterest()[0].pose,
          capabilities: replay.capabilities,
        };
        value.drawnTriangles ??= value.submittedTriangles;
        value.uncoveredTriangles ??= value.selectedTriangles - value.drawnTriangles;
        replay.dispose();
        primer.dispose();
        return {
          metrics: value,
          capture: captureEvidence,
          geometryUrl: new URL(geometry.url, metadataUrl).href,
          hierarchy,
          commonWorker,
        };
      },
      {
        moduleName,
        manifestUrl,
        replayUrl: `http://localhost:${address.port}${replayUrl}`,
        commonWorkerPath,
      },
    );
    const { geometryUrl } = result;
    const workers = await page.evaluate(runInstalledWorkers, {
      pageUrl: geometryUrl,
      decodeWorkerUrl: `http://127.0.0.1:${address.port}${decodeWorkerPath}`,
      integrationWorkerUrl: `http://127.0.0.1:${address.port}${integrationWorkerPath}`,
    });
    return installedBrowserResult({
      result,
      workers,
      requests,
      evidence: evidenceRequests(requests),
      allowNodeModules,
      browserVersion: browser.version(),
      errors,
    });
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

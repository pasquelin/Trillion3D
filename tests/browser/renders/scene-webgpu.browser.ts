import { sceneProvenance, MEASURE_WIDTH, MEASURE_HEIGHT } from '../support/sceneProvenance.ts';
import { routeBaseline } from '../support/sceneBaseline.ts';
import assert from 'node:assert/strict';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { startServer, serverPort } from '../../kit/server/staticServer.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/scene.ts';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runOnPage } from '../support/scenePageRun.ts';
import { measureOutput } from '../../../bench/core/paths.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const run = process.argv[2] ?? new Date().toISOString().replaceAll(':', '-');
const out = measureOutput('webgpu-visual', run);
// The harness page and its import map, the trajectory under `/runner/`, and the engine this run
// proves — `routeBaseline` intercepts `/dist/sdk-browser/`, so the engine keeps that prefix.
const mounts = [...resolveMounts(ROOT, []), { prefix: '/dist/', dir: resolve(ROOT, 'dist') }];
const server = await startServer({ port: 0, mounts, captures: new Map() });
const harnessUrl = `http://127.0.0.1:${serverPort(server)}`;
const provenance = await sceneProvenance(harnessUrl),
  taa = process.env.WEBGPU_TAA !== 'off';
await mkdir(out, { recursive: true });
const browser = await launchChrome({ headless: true });
try {
  // The window holds the measurement resolution, whether the canvas is sized explicitly or not.
  const viewport = { width: MEASURE_WIDTH, height: MEASURE_HEIGHT };
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  if (process.env.WEBGPU_BASELINE_DIR)
    await routeBaseline(page, out, provenance, process.env.WEBGPU_BASELINE_DIR);
  await page.goto(harnessUrl + '/');
  await page.exposeFunction('saveImage', async (name: string, data: string) => {
    await writeFile(out + '/' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
    console.log('captured', name);
  });
  const result = await page.evaluate(runOnPage, {
    sdkUrl: '/dist/sdk-browser/src/measurement/measurement.js',
    posesUrl: '/runner/poses.ts',
    manifestUrl: assetsManifest(DEFAULT_SCENE, true),
    // `WEBGPU_TAA=off` yields the `--avant` of the Lumiere 16 batch, with no jitter and no history.
    temporalAntialiasing: taa,
    ...viewport,
  });
  const finalResult = { ...result, provenance, errors };
  await writeFile(out + '/result.json', JSON.stringify(finalResult, null, 2));
  console.log(
    JSON.stringify(
      finalResult.results.map((x) => ({
        id: x.id,
        segment: x.segment,
        captureMax: x.captureMax,
        diff: x.diff,
      })),
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  assert.equal(finalResult.results.length, 20);
  assert.ok(
    !finalResult.events.some((event) => /failed|gpu-device-lost/.test(event.phase)),
    'render diagnostic failure: inspect result.json',
  );
  if (!process.env.WEBGPU_BASELINE_DIR)
    assert.ok(
      finalResult.events.some(
        (event) => event.phase === 'render-capabilities' && event.context.visibilityBuffer,
      ),
      'real visibility buffer required',
    );
} finally {
  await browser.close();
  server.close();
}

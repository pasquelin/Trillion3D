import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeBrowserFixtures } from '../appui/browserFixtureServer.mjs';
import { drainPageArray, writeCaptureReport } from '../appui/captureReport.mjs';
import { checkCaptureTimings } from '../appui/captureTimingChecks.mjs';
const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'browserFixtures');
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Diagnostic execution on the Lab's real engine/assets/path; no performance verdict.
const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
const out = resolve(
  'benchmark-runs/webgpu-capture',
  process.argv[2] ?? new Date().toISOString().replaceAll(':', '-'),
);
await mkdir(out, { recursive: true });
const hashes = {};
for (const name of [
  'index',
  'webgpuPages',
  'pageSelection',
  'gpuSelection',
  'awaitBackendPages',
  'streamingPages',
  'gpuPages',
  'gpuPresentation',
  'visibilityBuffer',
  'deferredLighting',
  'surfaceBuffer',
  'sceneLighting',
  'gpuTiming',
  'gpuHiz',
  'gpuDraw',
])
  hashes[name] = createHash('sha256')
    .update(await readFile(resolve('dist/sdk-browser', name + '.js')))
    .digest('hex');
const pageBudget = Number(process.env.GPU_PAGE_SLOTS ?? 100000);
assert.ok(Number.isSafeInteger(pageBudget) && pageBudget > 0);
const stableCaptures = process.env.STABLE_CAPTURE === '1',
  unculledControl = process.env.UNCULLED_CONTROL === '1';
// Deux modes de preuve. `flush` force tous les transferts avant chaque capture : c'est la référence
// A/A du dépôt. `live` ne force rien pendant le parcours — la pompe avance image par image sous le
// budget, comme en exploration libre — et ne force qu'après la dernière image, pour lire l'image
// déjà rendue. Sans le second mode, une régression qui n'apparaît qu'en boucle d'images passe.
const mode = process.env.CAPTURE_MODE ?? 'flush';
assert.ok(mode === 'flush' || mode === 'live', 'CAPTURE_MODE vaut flush ou live');
// Image du parcours où le mode `live` capture ; par défaut la dernière, celle du segment 9.
const captureFrame = process.env.LIVE_CAPTURE_FRAME
  ? Number(process.env.LIVE_CAPTURE_FRAME)
  : undefined;
const result = {
  startedAt: new Date().toISOString(),
  purpose: 'capture-regression-only',
  pageBudget,
  hashes,
  stableCaptures,
  unculledControl,
  mode,
  errors: [],
  events: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  if (unculledControl)
    await page.route('**/dist/sdk-browser/webgpuPages.js*', async (route) => {
      const response = await route.fetch(),
        original = await response.text();
      const condition = 'item.bounds && !blendFrustum.intersectsBox(item.bounds)';
      assert.ok(
        original.includes(condition),
        'control must disable exactly the transparent frustum condition',
      );
      const body = original.replace(condition, 'false /* diagnostic unculled control */');
      result.controlOverrideSha256 = createHash('sha256').update(body).digest('hex');
      await writeFile(resolve(out, 'webgpuPages.control.js'), body);
      await route.fulfill({ response, body });
    });
  page.on('pageerror', (error) => result.errors.push(error.message));
  await page.exposeFunction('captureProgress', (message) => console.log(message));
  // Une capture est une candidate : elle porte ce nom, et son état réel est consigné à côté d'elle.
  await page.exposeFunction('saveCapture', async (segment, bytes) =>
    writeFile(resolve(out, `segment-${segment}.candidate.rgba`), Buffer.from(bytes, 'base64')),
  );
  await page.exposeFunction('saveCaptureState', async (segment, state) =>
    writeFile(resolve(out, `segment-${segment}.candidate.json`), state),
  );
  await page.goto(
    (process.env.LAB_URL ?? 'http://localhost:5174') + '/?test=15-virtualized-integration',
  );
  await routeBrowserFixtures(page, fixtureDirectory);
  Object.assign(
    result,
    await page.evaluate(
      (args) => import('/__wg-fixture/captureRun.mjs').then((module) => module.run(args)),
      {
        sdkUrl: '/@fs' + resolve('dist/sdk-browser/index.js'),
        stableCaptures,
        pageBudget,
        mode,
        captureFrame,
      },
    ),
  );
  result.events = await drainPageArray(page, 'events');
  result.samples = await drainPageArray(page, 'samples');
  if (unculledControl) assert.ok(result.controlOverrideSha256, 'control override was not served');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.gpuErrors, []);
  assert.ok(
    !result.events.some((event) => /failed|uncaptured-error|device-lost/.test(event.phase)),
  );
  // En mode `live` la couverture se construit pendant le parcours, comme en exploration libre :
  // c'est l'image capturée, la dernière, qui doit être complète.
  const covered = mode === 'live' ? result.samples.slice(-1) : result.samples;
  assert.ok(
    covered.every((sample) => sample.coverageReady === true && !sample.streamingError),
    'all Emerald frames need complete coverage without a loading failure',
  );
  if (mode === 'flush') {
    if (pageBudget === 100000)
      assert.ok(result.samples.every((sample) => !sample.coverageBudgetLimited));
    else
      assert.ok(
        result.samples.some((sample) => sample.coverageBudgetLimited),
        'reduced budget must exercise detail admission',
      );
  }
  if (mode === 'live') {
    assert.equal(
      result.captures.length,
      1,
      'le mode live capture une image, à la pose du segment 9',
    );
    const live = result.captures[0];
    assert.equal(live.textureSkipped, 0, 'aucune texture abandonnée en boucle d’images');
    if (captureFrame === undefined)
      assert.equal(
        live.texturePending,
        0,
        `la pompe n’a pas convergé en ${live.framesBeforeCapture} images : ` +
          JSON.stringify({
            texturePending: live.texturePending,
            textureUploaded: live.textureUploaded,
            textureLevelsUploaded: live.textureLevelsUploaded,
          }),
      );
    console.log(
      'PASS live: convergence à l’image ' +
        result.convergedAtFrame +
        ' sur ' +
        result.frames +
        ', capture segment ' +
        live.segment,
    );
  } else {
    assert.equal(result.frames, 600);
    assert.equal(result.captures.length, 10);
  }
  assert.ok(!result.fallbackReason);
  if (mode === 'live') {
    result.status = 'passed';
    console.log('PASS: mode live, ' + result.frames + ' images sans flush, 1 capture');
  } else {
    checkCaptureTimings(result);
    result.status = 'passed';
    console.log('PASS: GPU overlap, 10 A/A controls, 600 Emerald frames, 10 captures');
  }
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  throw error;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeCaptureReport(resolve(out, 'result.json'), result);
  await browser.close();
}

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeBrowserFixtures } from './browserFixtureServer.mjs';
import { drainPageArray, writeCaptureReport } from './captureReport.mjs';
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
const result = {
  startedAt: new Date().toISOString(),
  purpose: 'capture-regression-only',
  pageBudget,
  hashes,
  stableCaptures,
  unculledControl,
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
      { sdkUrl: '/@fs' + resolve('dist/sdk-browser/index.js'), stableCaptures, pageBudget },
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
  assert.ok(
    result.samples.every((sample) => sample.coverageReady === true && !sample.streamingError),
    'all Emerald frames need complete coverage without a loading failure',
  );
  if (pageBudget === 100000)
    assert.ok(result.samples.every((sample) => !sample.coverageBudgetLimited));
  else
    assert.ok(
      result.samples.some((sample) => sample.coverageBudgetLimited),
      'reduced budget must exercise detail admission',
    );
  assert.equal(result.frames, 600);
  assert.equal(result.captures.length, 10);
  assert.ok(!result.fallbackReason);
  const status = result.events.find(
    (event) => event.stage === 'emerald' && event.phase === 'gpu-timing-status',
  );
  assert.ok(status, 'timing availability must be reported');
  if (status.context.available) {
    const timings = result.events.filter(
      (event) => event.stage === 'emerald' && event.phase === 'gpu-timing',
    );
    assert.ok(timings.length >= 6, 'real timestamp samples required');
    assert.ok(
      !result.events.some((event) => event.phase === 'gpu-timing-unavailable'),
      'timestamp readback failed',
    );
    assert.ok(
      timings.every((event) =>
        event.context.passes.every((pass) =>
          pass.gpuMs === null
            ? pass.reason === 'invalid-timestamps'
            : Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0,
        ),
      ),
    );
    assert.ok(
      timings.some((event) => event.context.sumPassMs !== null),
      'at least one complete GPU sample required',
    );
    for (const label of [
      'WG visibility primary',
      'WG material surfaces v1',
      'WG deferred lighting',
      'WG transparents',
      'WG HDR composition + present',
    ])
      assert.ok(
        timings.some((event) =>
          event.context.passes.some((pass) => pass.name === label && pass.gpuMs !== null),
        ),
        label + ' valid timestamp missing',
      );
    assert.ok(
      timings.every(
        (event) => !event.context.passes.some((pass) => pass.name === 'WG direct present'),
      ),
      'normal rendering must not copy the composed image in a second presentation pass',
    );
    console.log('PASS: ' + timings.length + ' real GPU pass timing samples');
  }
  const cpuSamples = result.events
    .filter((event) => event.stage === 'emerald')
    .flatMap((event) =>
      event.phase === 'cpu-timing'
        ? [event.context]
        : event.phase === 'frame' && event.context?.cpu
          ? [event.context.cpu]
          : [],
    );
  assert.ok(cpuSamples.length, 'CPU stages required in trace frames or summary timing events');
  for (const sample of cpuSamples)
    for (const field of [
      'totalMs',
      'lightsMs',
      'selectionMs',
      'residencyScheduleAndTargetsMs',
      'encodeSubmitMs',
      'transparentEncodeMs',
    ]) {
      assert.ok(
        Number.isFinite(sample[field]) && sample[field] >= 0,
        `CPU ${field} must be a measured nonnegative duration`,
      );
    }
  result.status = 'passed';
  console.log('PASS: GPU overlap, 10 A/A controls, 600 Emerald frames, 10 captures');
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  throw error;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeCaptureReport(resolve(out, 'result.json'), result);
  await browser.close();
}

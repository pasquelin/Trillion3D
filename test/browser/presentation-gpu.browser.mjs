import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchChrome } from '../../scripts/mesure/chrome.mjs';
import { dirname, resolve } from 'node:path';
import { adresseDuLab, routeBrowserFixtures } from '../appui/browserFixtureServer.mjs';

// Real GPU presentation/capture regression fixtures, outside timed beauty runs.
// Start the Lab (`LAB_URL`) and build this SDK before running. No performance claim is made.
const labUrl = adresseDuLab();
const sdkRoot = resolve(process.env.PRESENTATION_SDK_ROOT ?? '.');
const distRoot = resolve(process.env.WEBGPU_DIST_DIR ?? resolve(sdkRoot, 'dist'));
const out = resolve(
  process.env.PRESENTATION_RESULT ?? 'benchmark-runs/gpu-presentation/result.json',
);
const hashes = {};
for (const name of ['webgpuPages', 'deferredLighting', 'gpuPresentation', 'visibilityBuffer'])
  hashes[name] = createHash('sha256')
    .update(await readFile(resolve(distRoot, 'sdk-browser', name + '.js')))
    .digest('hex');
const report = {
  version: 1,
  startedAt: new Date().toISOString(),
  purpose: 'presentation-regression-only',
  distRoot,
  hashes,
  servedHashes: {},
  errors: [],
  checks: [],
};
const browser = await launchChrome({ headless: true });
try {
  const page = await browser.newPage();
  // Use Lab's module server without starting its dashboard or another renderer.
  await page.route('**/__wg-presentation-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>WebGeometry GPU presentation regression</title>',
    }),
  );
  await page.route(/\/dist\/(?:sdk-browser|sdk-core)\//, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const relative = path.match(/\/dist\/((?:sdk-browser|sdk-core)\/[\w./-]+\.js)$/)?.[1];
    assert.ok(
      relative && !relative.split('/').includes('..'),
      'Unexpected SDK module path: ' + path,
    );
    const original = await readFile(resolve(distRoot, relative), 'utf8');
    report.servedHashes[relative] = createHash('sha256').update(original).digest('hex');
    const body = original.replace(/\bfrom\s*(['"])three\1/g, "from '/.vite/deps/three.js'");
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(labUrl + '/__wg-presentation-fixture');
  await routeBrowserFixtures(page);
  Object.assign(
    report,
    await page.evaluate(
      (args) => import('/__wg-fixture/presentationRun.mjs').then((module) => module.run(args)),
      { sdkBase: '/@fs' + resolve(sdkRoot, 'dist/sdk-browser') },
    ),
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.gpuErrors, []);
  assert.ok(report.checks.length >= 50, 'All presentation cases must execute');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify({
    status: report.status,
    adapter: report.adapter,
    checks: report.checks.length,
    result: out,
  }),
);

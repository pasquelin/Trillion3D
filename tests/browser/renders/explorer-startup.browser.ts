import { startupSite } from '../support/explorerStartupSite.ts';
import { startupTargets } from '../support/explorerStartupTargets.ts';
// Standalone public startup proof using an original repository fixture and system Chrome.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, serverPort } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { sdkMounts, threeStackMounts } from '../support/renderHarness.ts';
import { buildSite, SITE_OUTPUT } from '../../../scripts/docs/site.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/measurement/measurement.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts';

declare global {
  var framesRequested: number;
  var sdk: typeof import('../../../packages/sdk-browser/src/measurement/measurement.ts');
  var diagnostics: BackendDiagnostic[];
  var explorer: MeasuredWorld;
}

interface TargetsResult {
  differences: number[];
  triangles: [number, number][];
  hasImage: boolean;
  disposedOnAbort: boolean;
  invalidLayout: string;
  missing: string;
  wrong: string;
  unsupported: string;
  overrides: number[];
  cancelled: string;
}

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'benchmark-runs/explorer-startup');
await mkdir(out, { recursive: true });
const cacheMounts = threeStackMounts(root, out);
await buildSite();
const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [...sdkMounts(root), ...cacheMounts, { prefix: '/site/', dir: SITE_OUTPUT }],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 480, height: 320 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${serverPort(server)}`);
  await page.evaluate(() => {
    document.body.innerHTML +=
      '<canvas id="viewer" style="width:100%;height:70vh;display:block"></canvas>';
    const request = window.requestAnimationFrame.bind(window);
    window.framesRequested = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      window.framesRequested++;
      return request(callback);
    };
  });
  const opened = await page.evaluate(async (sdkUrl) => {
    const sdk = await import(sdkUrl);
    window.sdk = sdk;
    window.diagnostics = [];
    window.explorer = await sdk.openMeasuredWorld('viewer', {
      manifestUrl: '/cache/city/manifest.json',
      scope: 'full',
      interactive: true,
      onDiagnostic: (e: BackendDiagnostic) => window.diagnostics.push(e),
    });
    const e = window.explorer;
    return {
      width: e.canvas.width,
      height: e.canvas.height,
      backend: e.backend,
      controlsReused: e.controls() === e.controls(),
      coverageReady: e.backends[0].metrics().coverageReady,
    };
  }, '/sdk/sdk-browser/src/measurement/measurement.js');
  assert.deepEqual([opened.width, opened.height], [960, 448]);
  assert.equal(opened.backend, 'webgpu-page-raster');
  assert.equal(opened.controlsReused, true);
  assert.equal(opened.coverageReady, true);
  const settle = async () => {
    await page.waitForFunction(() => window.explorer.backends[0].metrics().frameHeld, {
      timeout: 30000,
    });
    const before = await page.evaluate(() => window.framesRequested);
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => window.framesRequested),
      before,
      'no scheduled work in a still scene',
    );
  };
  await settle();
  await page.screenshot({ path: resolve(out, 'startup.png') });
  const pose = () => {
    const { x, y, z } = window.explorer.camera.position;
    return [x, y, z];
  };
  const initial = await page.evaluate(pose);
  await page.mouse.move(230, 100);
  await page.mouse.down();
  await page.mouse.move(290, 125, { steps: 4 });
  await page.mouse.up();
  await settle();
  assert.notDeepEqual(await page.evaluate(pose), initial);
  await page.setViewportSize({ width: 560, height: 400 });
  await page.waitForFunction(
    () => window.explorer.canvas.width === 1120 && window.explorer.canvas.height === 560,
  );
  await settle();
  const dpr = await page.evaluate(async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    window.dispatchEvent(new Event('resize'));
    return [window.explorer.canvas.width, window.explorer.canvas.height];
  });
  assert.deepEqual(dpr, [560, 280]);
  await settle();
  const lifecycle = await page.evaluate(async () => {
    const e = window.explorer,
      canvas = e.canvas;
    canvas.style.display = 'none';
    await new Promise((r) => setTimeout(r, 80));
    const hidden = [canvas.width, canvas.height];
    canvas.style.display = 'block';
    e.invalidate();
    e.dispose();
    const before = window.framesRequested;
    canvas.style.width = '200px';
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 80));
    return { hidden, retained: canvas.isConnected, stopped: before === window.framesRequested };
  });
  assert.deepEqual(lifecycle, { hidden: [560, 280], retained: true, stopped: true });
  const targets = (await page.evaluate(startupTargets)) as TargetsResult;
  assert.deepEqual(targets.differences, [0, 0]);
  for (const [submitted, selected] of targets.triangles) assert.equal(submitted, selected);
  assert.ok(targets.hasImage);
  assert.equal(targets.disposedOnAbort, true);
  assert.match(targets.invalidLayout, /INVALID_CANVAS_LAYOUT/);
  assert.match(targets.missing, /No canvas/);
  assert.match(targets.wrong, /must be a canvas/);
  assert.match(targets.unsupported, /WEBGPU_UNAVAILABLE/);
  assert.deepEqual(targets.overrides, [240, 160]);
  assert.equal(targets.cancelled, 'cancelled');
  assert.deepEqual(errors, []);
  const diagnostics = await page.evaluate(() =>
    window.diagnostics.filter((e) => /interactive-/.test(e.phase)),
  );
  assert.deepEqual(diagnostics, []);
  await startupSite(page, `http://127.0.0.1:${serverPort(server)}`, out);
  assert.deepEqual(errors, []);
  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    opened,
    lifecycle,
    targets,
    errors,
    diagnostics,
    cpuFrameMs: null,
    gpuFrameMs: null,
  };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

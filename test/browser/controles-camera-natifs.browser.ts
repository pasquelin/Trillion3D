// Standalone proof of the native camera controllers in system Chrome: every gesture is a real
// pointer, wheel or key event, no module of the host library's addons is ever fetched, and a
// gesture undone brings the image back to the byte.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, serverPort } from '../../scripts/mesure/serveur.ts';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import {
  beginGesture,
  endGesture,
  loadedModules,
  openProbe,
  stepGesture,
} from '../appui/cameraControlsPage.ts';
import type { Explorer } from '../../packages/sdk-browser/index.ts';
import type { Page } from 'playwright';

declare global {
  var sdk: typeof import('../../packages/sdk-browser/index.ts');
}

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'benchmark-runs/controles-camera-natifs');
await mkdir(out, { recursive: true });
const fixture = resolve(root, 'packages/asset-compiler-rust/fixtures/coplanar/three-stack');
const compiler =
  process.env.WG_COMPILER ??
  resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
execFileSync(compiler, [fixture, resolve(out, 'cache'), 'full', '150000', '/fixture/'], {
  stdio: 'pipe',
});
const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
    { prefix: '/vendor/meshoptimizer/', dir: resolve(root, 'node_modules/meshoptimizer') },
    { prefix: '/cache/city/', dir: resolve(out, 'cache/native/full') },
    { prefix: '/cache/objects/', dir: resolve(out, 'cache/native/objects') },
    { prefix: '/fixture/', dir: fixture },
  ],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
const centre = { x: 120, y: 80 };

/** A straight drag of `(dx, dy)` pixels from the middle of the canvas, on the named button. */
async function drag(page: Page, dx: number, dy: number, button: 'left' | 'right' = 'left') {
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down({ button });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 4 });
  await page.mouse.up({ button });
}

/** Wheel notches over the middle of the canvas; a drag leaves the pointer off it. */
async function wheel(page: Page, delta: number) {
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, delta);
}

/** Holds a key for one integration step of half a second, as a host's frame loop would. */
async function hold(page: Page, key: string) {
  await page.keyboard.down(key);
  await page.evaluate(stepGesture, 0.5);
  await page.keyboard.up(key);
}

try {
  const context = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${serverPort(server)}`);
  await page.evaluate(() => {
    document.body.innerHTML +=
      '<canvas id="viewer" style="width:240px;height:160px;display:block"></canvas>';
  });
  const backend = await page.evaluate(async (sdkUrl) => {
    window.sdk = await import(sdkUrl);
    return true;
  }, '/sdk/sdk-browser/index.js');
  assert.equal(backend, true);
  assert.equal(await page.evaluate(openProbe), 'webgpu-page-raster');
  type Gesture = Awaited<ReturnType<typeof endGesture>> & { home: number[]; moved: number[] };
  const gestures: Record<string, Gesture> = {};
  /** Each gesture moves the camera, reports the pose it reached, then undoes itself. */
  const run = async (kind: string, gesture: () => Promise<number[]>) => {
    const home = await page.evaluate(beginGesture, kind);
    const moved = await gesture();
    const result = await page.evaluate(endGesture);
    gestures[kind] = { ...result, home, moved };
    assert.ok(result.changes > 0, `${kind} emitted no change`);
    assert.ok(result.bytes > 0, `${kind} drew nothing`);
    assert.notDeepEqual(moved, home, `${kind} did not move the camera`);
    // The gesture and its reverse leave the very image the pose started from.
    assert.equal(result.differences, 0, `${kind} did not come back to its pose`);
    assert.deepEqual(result.pose, home, `${kind} did not come back to its pose`);
  };
  await run('controls', async () => {
    await drag(page, 120, 0);
    await wheel(page, 300);
    await drag(page, 60, 0, 'right');
    const moved = await page.evaluate(stepGesture, 0);
    await drag(page, -60, 0, 'right');
    await wheel(page, -300);
    await drag(page, -120, 0);
    return moved;
  });
  await run('trackballControls', async () => {
    await drag(page, 90, 0);
    await wheel(page, 200);
    const moved = await page.evaluate(stepGesture, 0);
    await wheel(page, -200);
    await drag(page, -90, 0);
    return moved;
  });
  await run('panZoomControls', async () => {
    await drag(page, 70, 30);
    await wheel(page, -200);
    const moved = await page.evaluate(stepGesture, 0);
    await wheel(page, 200);
    await drag(page, -70, -30);
    return moved;
  });
  await run('flyControls', async () => {
    await hold(page, 'w');
    const moved = await page.evaluate(stepGesture, 0);
    await hold(page, 's');
    await drag(page, 80, 0);
    await page.evaluate(stepGesture, 0);
    await drag(page, -80, 0);
    await page.evaluate(stepGesture, 0);
    return moved;
  });
  // A locked pointer turns the head on every move, button or not, so the look here is one
  // press, out and back, rather than two drags that would each reposition the cursor first.
  await run('firstPersonControls', async () => {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 80, centre.y, { steps: 4 });
    const moved = await page.evaluate(stepGesture, 0);
    await page.mouse.move(centre.x, centre.y, { steps: 4 });
    await page.mouse.up();
    await page.evaluate(stepGesture, 0);
    await hold(page, 'w');
    await hold(page, 's');
    return moved;
  });
  const modules = await page.evaluate(loadedModules);
  const addons = modules.filter((url) => /examples\/jsm|OrbitControls|FlyControls/.test(url));
  assert.deepEqual(addons, [], 'no addon of the host library may be fetched');
  assert.deepEqual(errors, []);
  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    gestures,
    addons,
    modules: modules.length,
    errors,
    cpuFrameMs: null,
    gpuFrameMs: null,
  };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

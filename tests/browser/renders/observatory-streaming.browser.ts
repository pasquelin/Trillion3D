// The streamed observatory refines while it loads (#836), as `site/examples/observatory-streamed`
// opens it through the public API: a world, its loop, pixel error 0. Its first cut is the coarse
// cover and asks for every page; the frames drawn while the WebGPU residency loads them must show
// the view refining page by page — not the coarse cover until the last page lands, nor a loop that
// pauses on its settle limit before the view is full.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { galleryMounts } from '../support/renderHarness.ts';
import { manifestUrlOf } from '../../kit/scenes/caches.ts';

/** Frames whose page count lies strictly between the coarse cover and the full view: a view that
 *  jumps from one to the other at the job's end draws none. */
const REFINING_FRAMES = 8;
/** Once the loop has drawn nothing for this long, the view is what it settled on: a loop that
 *  draws nothing that long while its pages load fails the proof, as the defect it is. */
const QUIET_MS = 2000;

const root = resolve(import.meta.dirname, '../../..');
const { server, port } = await startServer({ mounts: galleryMounts(root) });
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 520 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  const counts = await page.evaluate(
    async ({ sdkUrl, manifestUrl, quietMs }) => {
      document.body.replaceChildren();
      document.body.style.margin = '0';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:800px;height:520px;display:block';
      document.body.append(canvas);
      const { createWorld, pose } = await import(sdkUrl);
      const world = createWorld(canvas, { controls: 'orbit' });
      const counts: number[] = [];
      let last = performance.now();
      world.onFrame(({ metrics }: { metrics: { residentPages?: number | null } }) => {
        counts.push(metrics.residentPages ?? 0);
        last = performance.now();
      });
      world.pixelError = 0;
      const model = await world.scene.load(manifestUrl);
      const framing = pose.fromBounds(model.bounds);
      world.camera.set(framing);
      world.controls.target.set(...framing.target);
      world.camera.position.lerp(world.controls.target, 0.4);
      world.invalidate();
      const opened = performance.now();
      while (performance.now() - last < quietMs || performance.now() - opened < quietMs)
        await new Promise((wait) => setTimeout(wait, 100));
      world.dispose();
      return counts;
    },
    {
      sdkUrl: '/sdk/sdk/browser.js',
      manifestUrl: manifestUrlOf('site/assets/gallery/signature-architecture'),
      quietMs: QUIET_MS,
    },
  );
  assert.deepEqual(errors, []);
  const first = counts.find((count) => count > 0) ?? 0,
    full = Math.max(...counts);
  assert.ok(
    first > 0 && full > 10 * first,
    `the view loads past its coarse cover: ${first} → ${full}`,
  );
  assert.equal(counts.at(-1), full, 'the loop pauses only once the view is full');
  const refining = counts.filter((count) => count > first && count < full).length;
  console.log(JSON.stringify({ frames: counts.length, first, full, refining }));
  assert.ok(
    refining >= REFINING_FRAMES,
    `frames drawn while the pages land show them: ${refining} between ${first} and ${full}`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

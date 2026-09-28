// The streamed observatory refines while it loads (#836), as `site/examples/observatory-streamed`
// opens it through the public API: a world, its loop, pixel error 0 (its light and panel left out:
// they change nothing that loads). Its first cut is the coarse
// cover and asks for every page; the frames drawn while the WebGPU residency loads them must show
// the view refining page by page — not the coarse cover until the last page lands, nor a loop that
// pauses on its settle limit before the view is full.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { galleryMounts } from '../support/renderHarness.ts';
import { manifestUrlOf } from '../../kit/scenes/caches.ts';

/** Once the loop has drawn nothing for this long, the view is what it settled on: a loop that
 *  draws nothing that long while its pages load fails the proof, as the defect it is. About the
 *  scheduler's 120-frame settle limit at 60 Hz. */
const QUIET_MS = 2000;
/** The longest the loop may keep drawing before it must go quiet: past it the proof fails. */
const LIMIT_MS = 60_000;

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
  const { counts, resident } = await page.evaluate(
    async ({ sdkUrl, manifestUrl, quietMs, limitMs }) => {
      document.body.replaceChildren();
      document.body.style.margin = '0';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:800px;height:520px;display:block';
      document.body.append(canvas);
      const { createWorld, pose } = await import(sdkUrl);
      const world = createWorld(canvas, { controls: 'orbit' });
      const counts: number[] = [];
      // Resolves once the loop has drawn nothing for `quietMs`, each frame restarting the wait;
      // rejects if it never goes quiet within `limitMs`, so a loop that never pauses fails the
      // proof instead of hanging it (neither Playwright's evaluate nor `node --test` times out).
      let settled = () => {},
        quiet: ReturnType<typeof setTimeout> | undefined;
      const rearm = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => settled(), quietMs);
      };
      const idle = () =>
        new Promise<void>((done, fail) => {
          const limit = setTimeout(
            () => fail(new Error(`the loop never went quiet within ${limitMs} ms`)),
            limitMs,
          );
          settled = () => {
            clearTimeout(limit);
            done();
          };
          rearm();
        });
      world.onFrame(({ metrics }: { metrics: { residentPages?: number | null } }) => {
        counts.push(metrics.residentPages ?? 0);
        rearm();
      });
      world.pixelError = 0;
      const model = await world.scene.load(manifestUrl);
      const framing = pose.fromBounds(model.bounds);
      world.camera.set(framing);
      world.controls.target.set(...framing.target);
      world.camera.position.lerp(world.controls.target, 0.4);
      world.invalidate();
      await idle();
      const drawn = counts.length;
      // One more frame asked once idle shows what is resident now: a loop paused mid-load draws
      // more pages than its last frame showed.
      world.invalidate();
      await idle();
      world.dispose();
      return { counts: counts.slice(0, drawn), resident: counts.at(-1) };
    },
    {
      sdkUrl: '/sdk/sdk/browser.js',
      manifestUrl: manifestUrlOf('site/assets/gallery/signature-architecture'),
      quietMs: QUIET_MS,
      limitMs: LIMIT_MS,
    },
  );
  assert.deepEqual(errors, []);
  const first = counts.find((count) => count > 0) ?? 0,
    full = counts.at(-1) ?? 0;
  assert.ok(full > first, `the view loads past its coarse cover: ${first} → ${full}`);
  assert.equal(full, resident, 'the loop pauses only once the view is full');
  const refining = counts.filter((count) => count > first && count < full).length;
  console.log(JSON.stringify({ frames: counts.length, first, full, refining }));
  assert.ok(
    refining > 0,
    `frames drawn while the pages land show them: ${refining} between ${first} and ${full}`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

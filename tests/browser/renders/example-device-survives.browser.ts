// #1364: a headless run of an example keeps its WebGPU device. The audit of 30 Sept. timed
// `spin-an-astrolabe` and `orbit-around-a-clockwork` in Playwright's own headless shell, which
// composites a WebGPU canvas it cannot read: "[Invalid Texture]" right after the first frame, the
// device lost, no pass timed. The one launcher opens the system Chrome whatever it is asked
// (`launchChrome`); this proof asks for the shell as the audit did, and each example must still
// draw 600 frames on its device, `gpuFrameMs` reported, no loss named in its metrics.
//
//   pnpm run test:gpu tests/browser/renders/example-device-survives.browser.ts
import assert from 'node:assert/strict';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { startDocsServer } from '../../../scripts/docs-serve.ts';

const EXAMPLES = ['spin-an-astrolabe', 'orbit-around-a-clockwork'];
const FRAMES = 600;
/** How long an example may take to open and draw its frames, loading included. */
const PATIENCE_MS = 180_000;

/** What the page keeps of each frame: its GPU time and the loss its metrics name. */
type Kept = { gpu: number | null; lost: string | null };

/** The example's module, the world's frames recorded in `__kept` from its first. */
const recording = (html: string) =>
  html.replace(
    /(const world = createWorld\([^;]*\);)/,
    '$1 globalThis.__kept = []; world.onFrame(({ metrics }) => globalThis.__kept.push(' +
      '{ gpu: metrics.gpuFrameMs ?? null, lost: metrics.gpuDeviceLost ?? null }));',
  );

const { server, port } = await startDocsServer();
// The shell the audit opened: the launcher must give the system Chrome all the same.
const browser = await launchChrome({ headless: true, channel: 'chromium' } as never);
const found: string[] = [];
try {
  for (const id of EXAMPLES) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.route(`**/examples/${id}.html`, async (route) => {
      const response = await route.fetch();
      const body = recording(await response.text());
      if (!body.includes('__kept')) found.push(`${id}: its world was not found to record`);
      await route.fulfill({ response, body });
    });
    await page.goto(`http://127.0.0.1:${port}/examples/${id}.html`);
    // Until the frames are drawn, or one names the loss that would stop them.
    await page.waitForFunction(
      (frames) => {
        const kept = (globalThis as { __kept?: Kept[] }).__kept ?? [];
        return kept.length >= frames || kept.some((frame) => frame.lost !== null);
      },
      FRAMES,
      { polling: 500, timeout: PATIENCE_MS },
    );
    const kept = await page.evaluate(() => (globalThis as unknown as { __kept: Kept[] }).__kept);
    const lost = kept.find((frame) => frame.lost !== null)?.lost;
    const timed = kept.filter((frame) => typeof frame.gpu === 'number').length;
    console.log(`${id}: ${kept.length} frames, ${timed} with gpuFrameMs, lost: ${lost ?? 'no'}`);
    if (lost) found.push(`${id}: device lost (${lost})`);
    if (!kept.slice(-60).some((frame) => typeof frame.gpu === 'number'))
      found.push(`${id}: no gpuFrameMs in its last 60 frames`);
    found.push(...errors.map((error) => `${id}: ${error}`));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
assert.deepEqual(found, []);
console.log(`OK: both examples kept their device for ${FRAMES} frames, GPU time reported`);

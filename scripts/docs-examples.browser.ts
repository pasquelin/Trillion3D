import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { openExample, RENDER_ONLY } from './docs/examples/capture.ts';
import { readyEntries as ready } from '../site/app/examples/list.ts';

/** The examples that turn physics on: the only pages that fetch the physics session's code, the
 *  worker and Jolt's module. */
const PHYSICS = new Set([
  'falling-boxes',
  'floating-crates',
  'ten-thousand-bodies',
  'rolling-on-terrain',
  'a-walker-among-balls',
  'walk-with-collisions',
  'walk-through-a-temple',
  'create-and-dispose',
  'hinges-and-joints',
]);

/** The centre of the render, the kit's panels outside it. */
const centre = (page: Page) =>
  page.screenshot({ clip: { x: 330, y: 200, width: 300, height: 200 }, style: RENDER_ONLY });

/**
 * The example kit: a colour picked in the panel changes the render, and the page hosting the
 * example hides and shows the panel by message.
 */
async function controlsDriveTheRender(browser: Browser, port: number) {
  const entry = ready.find(({ id }) => id === 'shapes-on-a-turntable');
  assert.ok(entry);
  const { page, errors } = await openExample(browser, port, entry, { width: 960, height: 600 });
  const panel = page.locator('[data-example-overlay] details');
  const spin = panel.getByRole('checkbox');
  await spin.uncheck();
  await page.waitForTimeout(500);
  const before = await centre(page);
  await panel.locator('input[type=color]').fill('#2fd4ff');
  await page.waitForTimeout(1000);
  assert.notDeepEqual(await centre(page), before, 'the picked colour reaches the render');
  await page.evaluate(() => postMessage({ type: 'trillion3d:controls', visible: false }, '*'));
  await panel.waitFor({ state: 'hidden' });
  await page.evaluate(() => postMessage({ type: 'trillion3d:controls', visible: true }, '*'));
  await panel.waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  await page.close();
}

test('every example file renders an image on its own, fetching Jolt only when it has physics, and the portal page fills with it', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const [entry] = ready;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/examples/${entry.id}`);
    const frame = page.locator('[data-demo] iframe');
    // The portal hands the example its language (#327).
    assert.equal(await frame.getAttribute('src'), `${entry.file}?lang=en`);
    // The live render is the page: the iframe takes most of the height under the header.
    const view = await frame.boundingBox();
    assert.ok(view && view.height > 900 * 0.7, `the demo fills the content area (${view?.height})`);
    await page.close();
    // #276: with the machine's WebGPU device, then with none — a published example renders on
    // both, since it names no backend and the engine reads the machine it was opened on. Every
    // page is opened before the verdict, so the list names every example that stayed blank.
    const blank: string[] = [],
      jolt: string[] = [];
    for (const gpu of [true, false])
      for (const example of ready) {
        const opened = await openExample(
          browser,
          port,
          example,
          { width: 960, height: 600 },
          0.1,
          gpu,
        );
        if (opened.errors.length > 0 || opened.drawn < 0.1)
          blank.push(
            `${example.id} ${gpu ? 'with' : 'without'} WebGPU drew ${opened.drawn}${opened.errors[0] ? `: ${opened.errors[0]}` : ''}`,
          );
        // #395, #397: Jolt, and the page's code that drives it, are fetched by a page that turns
        // physics on, and by no other.
        const fetched = opened.requests.some((url) =>
          /physicsWorker\.js|joltPhysics\w*\.wasm|\/session-\w+\.js/.test(url),
        );
        if (fetched !== PHYSICS.has(example.id))
          jolt.push(`${example.id} ${fetched ? 'fetched' : 'did not fetch'} the physics`);
        await opened.page.close();
      }
    assert.deepEqual(jolt, []);
    assert.deepEqual(blank, []);
    await controlsDriveTheRender(browser, port);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

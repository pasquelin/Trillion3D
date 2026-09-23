import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { openExample, RENDER_ONLY } from './docs/examples/capture.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const ready = roadmap.entries.filter(({ file }) => file);

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
  await page.evaluate(() => postMessage({ type: 'wg:controls', visible: false }, '*'));
  await panel.waitFor({ state: 'hidden' });
  await page.evaluate(() => postMessage({ type: 'wg:controls', visible: true }, '*'));
  await panel.waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  await page.close();
}

test('every example file renders an image on its own, and the portal page frames it', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const [entry] = ready;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/examples/${entry.id}`);
    const source = page.locator('[data-code-block]');
    await source.getByText("from '../runtime/engine.js';").first().waitFor();
    const frame = page.locator('.render-frame iframe');
    assert.equal(await frame.getAttribute('src'), entry.file);
    const [code, view] = await Promise.all([source.boundingBox(), frame.boundingBox()]);
    assert.ok(code);
    assert.ok(view);
    assert.ok(code.x + code.width <= view.x, 'source left, render right');
    await page.getByRole('button', { name: 'Copy code' }).click();
    await page.getByRole('status').getByText('Copied').waitFor();
    // #276: with the machine's WebGPU device, then with none — a published example renders on
    // both, since it names no backend and the engine reads the machine it was opened on. Every
    // page is opened before the verdict, so the list names every example that stayed blank.
    const blank: string[] = [];
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
        await opened.page.close();
      }
    assert.deepEqual(blank, []);
    await controlsDriveTheRender(browser, port);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

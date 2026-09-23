import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { drawnShare } from './docs/examples/capture.ts';

// #79: the right-hand program of the migration page runs as written, from the built site, and
// draws its scene without a console error. The capture lands under `.mesure/out/79-migration/`.
const output = new URL('../.mesure/out/79-migration/', import.meta.url);

test('the engine side of the migration page renders its scene with no console error', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/examples/migrating-from-three.html`);
    let drawn = 0;
    for (let attempt = 0; attempt < 30 && drawn < 0.5; attempt++) {
      await page.waitForTimeout(500);
      drawn = await drawnShare(page);
    }
    // The model streams in: a few more frames let its pages settle before the capture.
    await page.waitForTimeout(3000);
    await mkdir(output, { recursive: true });
    await page
      .locator('canvas')
      .screenshot({ path: new URL('migrating-from-three.png', output).pathname });
    assert.deepEqual(errors, []);
    assert.ok(drawn >= 0.5, `drew ${drawn} of the canvas`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.mjs';
import { startDocsServer } from './docs-serve.mjs';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const ready = roadmap.entries.filter(({ file }) => file);

/** The share of the canvas capture that differs from its top-left pixel: 0 on a blank canvas. */
async function drawnShare(page) {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let drawn = 0;
      for (let at = 0; at < data.length; at += 4)
        if (data[at] !== data[0] || data[at + 1] !== data[1] || data[at + 2] !== data[2]) drawn++;
      return drawn / (data.length / 4);
    },
    [...png],
  );
}

test('every example file renders an image on its own, and the portal page frames it', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    for (const entry of ready) {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/${entry.file}`);
      let share = 0;
      for (let attempt = 0; attempt < 30 && share < 0.1; attempt++) {
        await page.waitForTimeout(500);
        share = await drawnShare(page);
      }
      assert.deepEqual(errors, [], entry.id);
      assert.ok(share >= 0.1, `${entry.id} drew ${share}`);
      await page.close();
    }
    const [entry] = ready;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/examples/${entry.id}`);
    const source = page.locator('[data-code-block]');
    await source.getByText("import { createExplorer } from '../runtime/engine.js';").waitFor();
    const frame = page.locator('iframe.example-frame');
    assert.equal(await frame.getAttribute('src'), entry.file);
    const [code, view] = await Promise.all([source.boundingBox(), frame.boundingBox()]);
    assert.ok(code.x + code.width <= view.x, 'source left, render right');
    await page.getByRole('button', { name: 'Copy code' }).click();
    await page.getByRole('status').getByText('Copied').waitFor();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

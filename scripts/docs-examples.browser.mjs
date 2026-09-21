import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.mjs';
import { startDocsServer } from './docs-serve.mjs';
import { openExample } from './docs/examples/capture.mjs';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const ready = roadmap.entries.filter(({ file }) => file);

test('every example file renders an image on its own, and the portal page frames it', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    for (const entry of ready) {
      const { page, errors, drawn } = await openExample(browser, port, entry, {
        width: 960,
        height: 600,
      });
      assert.deepEqual(errors, [], entry.id);
      assert.ok(drawn >= 0.1, `${entry.id} drew ${drawn}`);
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

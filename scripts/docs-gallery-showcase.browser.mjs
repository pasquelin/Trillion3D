import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.mjs';
import { createDocsServer } from './docs-serve.mjs';

test('gallery showcase keeps both pilots visible and makes the selected scene the main link', async () => {
  const server = await createDocsServer();
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${address.port}/#/en/examples`);
    const showcase = page.locator('[data-gallery-showcase]');
    await showcase.waitFor();
    const box = await showcase.boundingBox();
    assert.ok(box.width >= 850, `showcase width ${box.width}`);
    assert.ok((await showcase.getByRole('button').count()) === 2);
    assert.ok(
      (await showcase.getByRole('heading', { name: 'Cross the observatory' }).boundingBox()).y <
        420,
    );
    await showcase.getByRole('button', { name: /Direct the shadow theatre/ }).click();
    const main = showcase.getByRole('link');
    assert.equal(await main.getAttribute('href'), '#/en/examples/shadow-casting-switch');
    assert.match(await main.innerText(), /Try the shadow switch/);
    assert.match(await main.locator('img').getAttribute('src'), /shadow-casting-switch\.png$/);

    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await showcase.boundingBox();
    assert.ok(narrow.width < 390);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

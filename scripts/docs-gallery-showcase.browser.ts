import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.ts';
import { startDocsServer } from './docs-serve.ts';

test('gallery showcase keeps both pilots visible and makes the selected scene the main link', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/lessons`);
    const showcase = page.locator('[data-gallery-showcase]');
    await showcase.waitFor();
    const box = await showcase.boundingBox();
    assert(box);
    assert.ok(box.width >= 850, `showcase width ${box.width}`);
    assert.ok((await showcase.getByRole('button').count()) === 2);
    const headingBox = await showcase
      .getByRole('heading', { name: 'Cross the observatory' })
      .boundingBox();
    assert(headingBox);
    assert.ok(headingBox.y < 420);
    await showcase.getByRole('button', { name: /Direct the shadow theatre/ }).click();
    const main = showcase.getByRole('link');
    assert.equal(await main.getAttribute('href'), '#/en/lessons/shadow-casting-switch');
    assert.match(await main.innerText(), /Try the shadow switch/);
    const imgSrc = await main.locator('img').getAttribute('src');
    assert(imgSrc);
    assert.match(imgSrc, /shadow-casting-switch\.png$/);

    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await showcase.boundingBox();
    assert(narrow);
    assert.ok(narrow.width < 390);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

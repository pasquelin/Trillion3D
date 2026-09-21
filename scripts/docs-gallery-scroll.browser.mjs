import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.mjs';
import { startDocsServer } from './docs-serve.mjs';

test('gallery progressively loads a bounded window and restores navigation state', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/lessons`);
    const list = page.locator('[data-progressive-list]');
    await list.waitFor();
    assert.equal(await list.getAttribute('data-mounted-items'), '24');
    assert.equal(await page.getByLabel('Pagination').count(), 0);

    const more = () => page.getByRole('button', { name: 'Load more results' });
    await more().scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => document.querySelector('[data-progressive-list]')?.dataset.mountedItems === '48',
    );
    await more().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('[data-progressive-list]')?.dataset.mountedItems === '72',
    );
    await more().click();
    assert.ok((await page.locator('[data-progressive-page]').count()) <= 3);

    const search = page.getByRole('searchbox', { name: 'Search examples' });
    await search.fill('quaternion');
    await search.fill('reflection');
    await search.fill('matrix');
    assert.match(await page.getByRole('status').first().innerText(), /^\d+ results shown/);
    assert.equal(await page.locator('[data-progressive-page]').count(), 1);
    const titles = await page.locator('[data-progressive-page] h2').allTextContents();
    assert.equal(new Set(titles).size, titles.length);

    await search.fill('');
    await more().click();
    await page.waitForFunction(
      () => Number(document.querySelector('[data-progressive-list]')?.dataset.mountedItems) >= 48,
    );
    await page.locator('[data-progressive-page]').last().scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      y: scrollY,
      count: document.querySelector('[data-progressive-list]')?.dataset.mountedItems,
    }));
    await page.evaluate(() => {
      location.hash = '#/en/playground/compose-transform';
    });
    await page.waitForSelector('[data-gallery]', { state: 'detached' });
    await page.goBack();
    await page.waitForSelector('[data-gallery]');
    await page.waitForFunction((y) => Math.abs(scrollY - y) < 80, before.y);
    assert.equal(await list.getAttribute('data-mounted-items'), before.count);

    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => {
      const pages = [...document.querySelectorAll('[data-progressive-page]')];
      return Number(pages.at(-1)?.dataset.progressivePage) >= 20;
    });
    assert.ok((await page.locator('[data-progressive-page]').count()) <= 3);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(
      () => document.querySelector('[data-progressive-page]')?.dataset.progressivePage === '0',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.locator('[data-progressive-page]').count()) <= 3);
    assert.equal(
      (await page.locator('[data-progressive-page]').first().boundingBox()).width < 390,
      true,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

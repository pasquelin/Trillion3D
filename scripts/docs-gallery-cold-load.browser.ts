import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openDocsBrowser } from './docs-gallery-browser-fixture.ts';

test('a cold observatory load settles without user input', async () => {
  const { port, browser, close } = await openDocsBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let delayed = 0;
    await page.route('**/signature-architecture/**/*.bin', async (route) => {
      delayed++;
      await delay(600);
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/#/en/examples/runtime-pixel-error`);
    const lesson = page.locator('[data-renderer-lesson="runtime-pixel-error"]');
    await lesson.waitFor();
    await lesson.locator('canvas:not([aria-busy])').waitFor({ timeout: 40_000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-renderer-lesson="runtime-pixel-error"]')
          ?.textContent?.includes('Paused'),
      undefined,
      { timeout: 40_000 },
    );
    await delay(2_000);
    const triangles = async () =>
      Number((await lesson.innerText()).match(/Drawn triangles\s*(\d+)/)?.[1]);
    const coldTriangles = await triangles();
    const tolerance = page.getByLabel('Detail tolerance');
    await tolerance.fill('0');
    await page.waitForFunction(
      () => {
        const text = document.querySelector(
          '[data-renderer-lesson="runtime-pixel-error"]',
        )?.textContent;
        return text?.includes('Paused') && text.includes('Drawn triangles91352');
      },
      undefined,
      { timeout: 40_000 },
    );
    await tolerance.fill('1');
    await page.waitForFunction(
      (expected) => {
        const text = document.querySelector(
          '[data-renderer-lesson="runtime-pixel-error"]',
        )?.textContent;
        return text?.includes('Paused') && text.includes(`Drawn triangles${expected}`);
      },
      coldTriangles,
      { timeout: 40_000 },
    );
    const resetTriangles = await triangles();
    assert.ok(delayed > 1, `expected streamed requests, observed ${delayed}`);
    assert.equal(coldTriangles, resetTriangles);
  } finally {
    await close();
  }
});

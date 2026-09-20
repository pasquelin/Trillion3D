import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererCodeFor } from '../docs/js/gallery/rendererLessonCode.js';
import { rendererInitialState, rendererLessons } from '../docs/js/gallery/rendererLessons.js';
import { launchChrome } from './mesure/chrome.mjs';
import { createDocsServer } from './docs-serve.mjs';

test('the published observatory snippet runs in Chrome until its streamed frame settles', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'runtime-pixel-error'),
    server = createDocsServer();
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
  const moduleUrl = `http://127.0.0.1:${address.port}/runtime/engine.js`,
    source = rendererCodeFor(lesson, rendererInitialState(lesson)).replace(
      "'@web-geometry/sdk/browser'",
      `'${moduleUrl}'`,
    ),
    browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async (code) => {
      const canvas = document.createElement('canvas');
      canvas.id = 'garden';
      canvas.style.cssText = 'width:960px;height:540px;display:block';
      document.body.replaceChildren(canvas);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        await import(url);
        return { width: canvas.width, height: canvas.height };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, source);
    assert.deepEqual(result, { width: 960, height: 540 });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

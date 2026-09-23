import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererCodeFor } from '../site/lessons/rendererLessonCode.ts';
import { rendererInitialState, rendererLessons } from '../site/lessons/rendererLessons.ts';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';

interface CanvasSize {
  width: number;
  height: number;
}

test('the published observatory snippet runs in Chrome until its streamed frame settles', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'runtime-pixel-error');
  assert(lesson);
  const { server, port } = await startDocsServer();
  const moduleUrl = `http://127.0.0.1:${port}/runtime/engine.js`,
    source = rendererCodeFor(lesson, rendererInitialState(lesson)).replace(
      "'web-geometry'",
      `'${moduleUrl}'`,
    ),
    browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(async (code: string): Promise<CanvasSize> => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

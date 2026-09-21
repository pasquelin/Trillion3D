import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { launchChrome } from './mesure/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import type {
  RendererRuntimeModule,
  RendererLessonsModule,
} from './docs-gallery-renderer-runtime-types.ts';
import type { RendererMetrics } from '../site/lessons/rendererLessonSessionTypes.ts';

const LESSON = '[data-renderer-lesson="runtime-pixel-error"]';

const lessonText = async (page: Page): Promise<string> => {
  const text = await page.evaluate(
    (selector) => document.querySelector(selector)?.textContent,
    LESSON,
  );
  if (text === null || text === undefined) throw new Error('lesson text not found');
  return text;
};
// The runtime reports `idle` as "Paused" once its frames settle: a mode or camera change is
// proven by the viewport leaving that state, then reaching it again.
const paused = (page: Page) =>
  page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent?.includes('Paused'),
    LESSON,
    { timeout: 40_000 },
  );
const drawing = (page: Page) =>
  page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent?.includes('Paused') === false,
    LESSON,
    { timeout: 10_000 },
  );

test('the viewport select drives the runtime mode and follows the mode the lesson sets', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/lessons/runtime-pixel-error`);
    const lesson = page.locator(LESSON),
      select = lesson.locator('[data-renderer-diagnostic]');
    await lesson.locator('canvas:not([aria-busy])').waitFor({ timeout: 40_000 });
    await paused(page);
    assert.equal(await select.inputValue(), 'beauty');
    const beautyTriangles = (await lessonText(page)).match(/Drawn triangles\s*(\d+)/)?.[1];

    await select.selectOption('clusters');
    await drawing(page);
    await paused(page);
    assert.equal(await select.inputValue(), 'clusters');

    // The lesson's own control sets the diagnostic through `update()`: the select follows it.
    await page.getByLabel('Show detail levels').check();
    await drawing(page);
    await paused(page);
    assert.equal(await select.inputValue(), 'lod');
    assert.equal((await lessonText(page)).match(/Drawn triangles\s*(\d+)/)?.[1], beautyTriangles);

    // Wheel zoom on the canvas: the runtime draws again (it stayed paused before this batch).
    const box = await lesson.locator('canvas').boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -240);
    await drawing(page);
    await paused(page);
    assert.equal(await select.inputValue(), 'lod');
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface DiagnosticModes {
  before: (RendererMetrics['diagnostic'] | undefined)[];
  after: (RendererMetrics['diagnostic'] | undefined)[];
}

test('setDiagnostic on the lesson runtime draws a frame that reports the new mode', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const modes = await page.evaluate(
      async ({ runtimeUrl, lessonsUrl }): Promise<DiagnosticModes> => {
        const [{ createRendererLessonRuntime }, { rendererInitialState, rendererLessonById }] =
          (await Promise.all([import(runtimeUrl), import(lessonsUrl)])) as [
            RendererRuntimeModule,
            RendererLessonsModule,
          ];
        const lesson = rendererLessonById('runtime-pixel-error');
        if (!lesson) throw new Error('runtime-pixel-error lesson not found');
        const canvas = document.createElement('canvas'),
          reports: RendererMetrics['diagnostic'][] = [];
        canvas.style.cssText = 'width:800px;height:450px;display:block';
        document.body.replaceChildren(canvas);
        let settled: (() => void) | undefined;
        const runtime = await createRendererLessonRuntime({
          canvas,
          lesson,
          state: rendererInitialState(lesson),
          report: (next) => {
            reports.push(next.diagnostic);
            if (next.idle) settled?.();
          },
        });
        const started = reports.length;
        const idle = new Promise<void>((resolve) => (settled = resolve));
        runtime.setDiagnostic('clusters');
        await idle;
        runtime.dispose();
        return { before: [...new Set(reports.slice(0, started))], after: reports.slice(started) };
      },
      {
        runtimeUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessonRuntime.js`,
        lessonsUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessons.js`,
      },
    );
    assert.deepEqual(modes.before, ['beauty']);
    assert.ok(modes.after.length > 0, 'setDiagnostic must draw at least one frame');
    assert.deepEqual([...new Set(modes.after)], ['clusters']);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

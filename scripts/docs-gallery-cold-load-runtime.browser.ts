import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { launchChrome } from './mesure/chrome.mjs';
import { startDocsServer } from './docs-serve.mjs';

async function openDocsBrowser() {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  return {
    port,
    browser,
    close: async () => {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

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
    await page.goto(`http://127.0.0.1:${port}/#/en/lessons/runtime-pixel-error`);
    const lesson = page.locator('[data-renderer-lesson="runtime-pixel-error"]');
    await lesson.waitFor();
    await lesson.locator('canvas:not([aria-busy])').waitFor({ timeout: 40_000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-renderer-lesson="runtime-pixel-error"]')
          ?.textContent.includes('Paused'),
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

test('disposing rejects overlapping public updates by name', async () => {
  const { port, browser, close } = await openDocsBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const names = await page.evaluate(
      async ({ runtimeUrl, lessonsUrl }) => {
        const [{ createRendererLessonRuntime }, { rendererInitialState, rendererLessonById }] =
          await Promise.all([import(runtimeUrl), import(lessonsUrl)]);
        const lesson = rendererLessonById('runtime-pixel-error'),
          state = rendererInitialState(lesson),
          canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:800px;height:450px;display:block';
        document.body.replaceChildren(canvas);
        const runtime = await createRendererLessonRuntime({
          canvas,
          lesson,
          state,
          report() {},
        });
        const first = runtime.update({ ...state, pixelError: 0 }),
          second = runtime.update({ ...state, pixelError: 2 });
        runtime.dispose();
        return (await Promise.allSettled([first, second])).map((result) => result.reason?.name);
      },
      {
        runtimeUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessonRuntime.js`,
        lessonsUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessons.js`,
      },
    );
    assert.deepEqual(names, ['AbortError', 'AbortError']);
  } finally {
    await close();
  }
});

test('a never-ending binary response exhausts one global startup deadline', async () => {
  const { port, browser, close } = await openDocsBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(
      async ({ runtimeUrl, lessonsUrl }) => {
        const nativeFetch = globalThis.fetch,
          nativeRequestFrame = globalThis.requestAnimationFrame,
          nativeCancelFrame = globalThis.cancelAnimationFrame,
          frames = new Set();
        let pendingBinaries = 0;
        globalThis.requestAnimationFrame = (callback) => {
          const id = nativeRequestFrame((time) => {
            frames.delete(id);
            callback(time);
          });
          frames.add(id);
          return id;
        };
        globalThis.cancelAnimationFrame = (id) => {
          frames.delete(id);
          nativeCancelFrame(id);
        };
        globalThis.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          if (!new URL(url, location.href).pathname.endsWith('.bin'))
            return nativeFetch(input, init);
          const signal = init?.signal ?? input.signal;
          pendingBinaries++;
          return new Promise((_, reject) => {
            const cancel = () => {
              pendingBinaries--;
              reject(signal.reason);
            };
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
          });
        };
        const [{ createRendererLessonRuntime }, { rendererInitialState, rendererLessonById }] =
          await Promise.all([import(runtimeUrl), import(lessonsUrl)]);
        const lesson = rendererLessonById('runtime-pixel-error'),
          state = rendererInitialState(lesson),
          canvas = document.createElement('canvas'),
          started = performance.now();
        canvas.style.cssText = 'width:800px;height:450px;display:block';
        document.body.replaceChildren(canvas);
        let name;
        try {
          await createRendererLessonRuntime({ canvas, lesson, state, report() {} });
        } catch (error) {
          name = error.name;
        }
        await new Promise((resolve) => setTimeout(resolve));
        return { name, elapsed: performance.now() - started, pendingBinaries, frames: frames.size };
      },
      {
        runtimeUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessonRuntime.js`,
        lessonsUrl: `http://127.0.0.1:${port}/js/gallery/rendererLessons.js`,
      },
    );
    assert.equal(result.name, 'TimeoutError');
    assert.ok(result.elapsed >= 30_000 && result.elapsed < 34_000, `elapsed ${result.elapsed}`);
    assert.equal(result.pendingBinaries, 0);
    assert.equal(result.frames, 0);
  } finally {
    await close();
  }
});

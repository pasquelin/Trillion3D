// Split from docs-gallery-cold-load.browser.ts (responsibility, not the DOM-mounted proof):
// these two drive the renderer lesson runtime module directly through `page.evaluate`, proving
// its dispose contract and its one global startup deadline.
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDocsBrowser } from './docs-gallery-browser-fixture.ts';
import type {
  RendererRuntimeModule,
  RendererLessonsModule,
} from './docs-gallery-renderer-runtime-types.ts';

interface RuntimeModuleUrls {
  runtimeUrl: string;
  lessonsUrl: string;
}

test('disposing rejects overlapping public updates by name', async () => {
  const { port, browser, close } = await openDocsBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const names = await page.evaluate(
      async ({ runtimeUrl, lessonsUrl }: RuntimeModuleUrls) => {
        const [{ createRendererLessonRuntime }, { rendererInitialState, rendererLessonById }] = (
          await Promise.all([import(runtimeUrl), import(lessonsUrl)])
        ) as [RendererRuntimeModule, RendererLessonsModule];
        const lesson = rendererLessonById('runtime-pixel-error');
        if (!lesson) throw new Error('runtime-pixel-error lesson not found');
        const state = rendererInitialState(lesson),
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
        return (await Promise.allSettled([first, second])).map((result) =>
          result.status === 'rejected' && result.reason instanceof Error
            ? result.reason.name
            : undefined,
        );
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

interface StartupDeadlineResult {
  name: string | undefined;
  elapsed: number;
  pendingBinaries: number;
  frames: number;
}

test('a never-ending binary response exhausts one global startup deadline', async () => {
  const { port, browser, close } = await openDocsBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(
      async ({ runtimeUrl, lessonsUrl }: RuntimeModuleUrls): Promise<StartupDeadlineResult> => {
        const nativeFetch = globalThis.fetch,
          nativeRequestFrame = globalThis.requestAnimationFrame,
          nativeCancelFrame = globalThis.cancelAnimationFrame,
          frames = new Set<number>();
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
          const url =
            typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
          if (!new URL(url, location.href).pathname.endsWith('.bin'))
            return nativeFetch(input, init);
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          pendingBinaries++;
          return new Promise((_, reject) => {
            const cancel = () => {
              pendingBinaries--;
              reject(signal?.reason);
            };
            if (signal?.aborted) cancel();
            else signal?.addEventListener('abort', cancel, { once: true });
          });
        };
        const [{ createRendererLessonRuntime }, { rendererInitialState, rendererLessonById }] = (
          await Promise.all([import(runtimeUrl), import(lessonsUrl)])
        ) as [RendererRuntimeModule, RendererLessonsModule];
        const lesson = rendererLessonById('runtime-pixel-error');
        if (!lesson) throw new Error('runtime-pixel-error lesson not found');
        const state = rendererInitialState(lesson),
          canvas = document.createElement('canvas'),
          started = performance.now();
        canvas.style.cssText = 'width:800px;height:450px;display:block';
        document.body.replaceChildren(canvas);
        let name: string | undefined;
        try {
          await createRendererLessonRuntime({ canvas, lesson, state, report() {} });
        } catch (error) {
          name = error instanceof Error ? error.name : undefined;
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

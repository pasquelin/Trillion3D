import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendPresenter } from './explorerComposeSurface.ts';
import { createExplorerCapture } from './explorerCapture.ts';
import type { RenderBackend } from './backendTypes.ts';

/** A live context that answers everything and records the calls that carry the copy. */
function fakeContext(calls: string[], lost = false) {
  const fixed: Record<string, unknown> = {
    canvas: { addEventListener: () => {}, removeEventListener: () => {} },
    isContextLost: () => lost,
  };
  return new Proxy(
    {},
    {
      get: (_target, name: string) =>
        name in fixed
          ? fixed[name]
          : /^[A-Z0-9_]+$/.test(name)
            ? 1
            : (...args: unknown[]) => {
                calls.push(name);
                return name.startsWith('get') ? true : args.length ? undefined : {};
              },
    },
  ) as unknown as WebGL2RenderingContext;
}

const surface = { width: 4, height: 4 } as HTMLCanvasElement;

test('an engine that presented its own surface is copied from it, and says so', () => {
  const calls: string[] = [];
  const present = createBackendPresenter(fakeContext(calls));
  assert.equal(present({ presentedSurface: surface }), true);
  assert.ok(calls.includes('texImage2D'), 'the presented surface was not uploaded');
  assert.ok(calls.includes('drawArrays'), 'the copy was not drawn');
  const built = calls.filter((call) => call === 'linkProgram').length;
  present({ presentedSurface: surface });
  assert.equal(calls.filter((call) => call === 'linkProgram').length, built, 'one program');
  present.dispose();
  assert.ok(calls.includes('deleteProgram'), 'the program leaves with the presenter');
});

test('a lost context draws nothing and keeps no program of the dead one', () => {
  const calls: string[] = [];
  const present = createBackendPresenter(fakeContext(calls, true));
  assert.equal(present({ presentedSurface: surface }), true);
  assert.deepEqual(calls, []);
});

test('an engine that draws on the host surface is left to the composer: nothing is copied', () => {
  const calls: string[] = [];
  const present = createBackendPresenter(fakeContext(calls));
  assert.equal(present({}), false);
  assert.deepEqual(calls, []);
});

/** The explicit capture reads the host composition, so it must compose it the same way a frame
 *  does, on the page's drawing buffer: bound first, drawn, then read. */
test('the explicit capture composes the presented surface instead of drawing the scene', () => {
  for (const presented of [true, false]) {
    const steps: string[] = [];
    const capture = createExplorerCapture({
      canvas: { width: 2, height: 2 } as HTMLCanvasElement,
      camera: {} as never,
      context: {
        bindFramebuffer: (_target: number, framebuffer: unknown) =>
          steps.push(`bind:${framebuffer}`),
        viewport: () => {},
        readPixels: () => steps.push('read'),
        drawingBufferWidth: 2,
        drawingBufferHeight: 2,
      } as unknown as WebGL2RenderingContext,
      options: {} as never,
      directGpu: false,
      presentBackend: () => presented,
      state: {
        active: { id: 'engine', render: () => {} } as unknown as RenderBackend,
        measuring: false,
      },
      check: () => {},
      diagnose: () => {},
      compose: Object.assign(() => void steps.push('compose'), { dispose() {} }),
    });
    capture();
    assert.deepEqual(
      steps,
      presented ? ['read', 'bind:null', 'read'] : ['read', 'bind:null', 'compose', 'read'],
    );
  }
});

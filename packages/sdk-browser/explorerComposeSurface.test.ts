import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendPresenter } from './explorerComposeSurface.ts';
import { createExplorerCapture } from './explorerCapture.ts';
import type { RenderBackend } from './backendTypes.ts';

/** A live context that answers everything and records the calls that carry the copy. */
function fakeContext(calls: string[], lost = false) {
  const fixed: Record<string, unknown> = {
    canvas: { addEventListener: () => {} },
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
  const context = fakeContext(calls);
  const present = createBackendPresenter({
    getContext: () => context,
    resetState: () => calls.push('resetState'),
  });
  assert.equal(present({ presentedSurface: surface }), true);
  assert.ok(calls.includes('texImage2D'), 'the presented surface was not uploaded');
  assert.ok(calls.includes('drawArrays'), 'the copy was not drawn');
  assert.ok(calls.includes('resetState'), 'the host renderer was not told to forget the state');
  assert.ok(
    calls.indexOf('drawArrays') < calls.indexOf('resetState'),
    'the state was reset before the copy was drawn',
  );
});

test('a lost context draws nothing and keeps no program of the dead one', () => {
  const calls: string[] = [];
  const context = fakeContext(calls, true);
  const present = createBackendPresenter({
    getContext: () => context,
    resetState: () => calls.push('resetState'),
  });
  assert.equal(present({ presentedSurface: surface }), true);
  assert.deepEqual(calls, []);
});

test('an engine that hands over a scene is left to the host: nothing is copied', () => {
  const calls: string[] = [];
  const present = createBackendPresenter({
    getContext: () => fakeContext(calls),
    resetState: () => calls.push('resetState'),
  });
  assert.equal(present({}), false);
  assert.deepEqual(calls, []);
});

/** The explicit capture reads the host composition, so it must compose it the same way a frame
 *  does: reading a scene an engine no longer draws returns the clear colour. */
test('the explicit capture composes the presented surface instead of drawing the scene', () => {
  for (const presented of [true, false]) {
    const rendered: string[] = [];
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      render: () => rendered.push('scene'),
      getContext: () => ({ readPixels: () => {} }),
    };
    const capture = createExplorerCapture({
      canvas: { width: 2, height: 2 } as HTMLCanvasElement,
      camera: {} as never,
      renderer: renderer as never,
      options: {} as never,
      directGpu: false,
      presentBackend: () => presented,
      state: { active: { id: 'engine', render: () => {} } as unknown as RenderBackend },
      check: () => {},
      diagnose: () => {},
    });
    capture();
    assert.deepEqual(rendered, presented ? [] : ['scene']);
  }
});

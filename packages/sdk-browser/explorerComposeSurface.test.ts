import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendPresenter } from './explorerComposeSurface.ts';
import { createExplorerCapture } from './explorerCapture.ts';
import type { RenderBackend } from './backendTypes.ts';
import { createTestContext } from './webglTestContext.ts';

const surface = { width: 4, height: 4 } as HTMLCanvasElement;

test('an engine that presented its own surface is copied from it, and says so', () => {
  const { gl, of, names } = createTestContext();
  const present = createBackendPresenter(gl);
  assert.equal(present({ presentedSurface: surface }), true);
  assert.ok(names().includes('texImage2D'), 'the presented surface was not uploaded');
  assert.ok(names().includes('drawArrays'), 'the copy was not drawn');
  present({ presentedSurface: surface });
  assert.equal(of('linkProgram').length, 1, 'one program for every copy');
  present.dispose();
  assert.equal(of('deleteProgram').length, 1, 'the program leaves with the presenter');
});

test('a lost context draws nothing and keeps no program of the dead one', () => {
  const { gl, calls } = createTestContext({ lost: true });
  const present = createBackendPresenter(gl);
  assert.equal(present({ presentedSurface: surface }), true);
  assert.deepEqual(calls, []);
});

test('an engine that draws on the host surface is left to the composer: nothing is copied', () => {
  const { gl, calls } = createTestContext();
  const present = createBackendPresenter(gl);
  assert.equal(present({}), false);
  assert.deepEqual(calls, []);
});

/** The explicit capture reads the host composition, so it must compose it the same way a frame
 *  does, on the page's drawing buffer: bound first, the visible sample, the composition, the
 *  read — and no visible sample while a campaign measures on its own target. */
test('the explicit capture binds the drawing buffer, samples it, composes, then reads', () => {
  for (const measuring of [false, true]) {
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
      state: {
        active: { id: 'engine', render: () => steps.push('render') } as unknown as RenderBackend,
        measuring,
      },
      check: () => {},
      diagnose: () => {},
      compose: Object.assign(() => void steps.push('compose'), { dispose() {} }),
    });
    capture();
    assert.deepEqual(
      steps,
      measuring
        ? ['bind:null', 'render', 'compose', 'read']
        : ['bind:null', 'read', 'render', 'compose', 'read'],
    );
  }
});

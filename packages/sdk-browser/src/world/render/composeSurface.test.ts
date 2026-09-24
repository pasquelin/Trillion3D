import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendPresenter } from './composeSurface.ts';
import { createExplorerCapture } from '../capture/capture.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';

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

/** The presentation diagnostics a capture raises when the engine cleared to `0x2244ff`, the
 *  session having opened on red. */
function presentation(options: object, background: unknown) {
  const found: Record<string, unknown>[] = [];
  const capture = createExplorerCapture({
    canvas: { width: 2, height: 2 } as HTMLCanvasElement,
    camera: {} as never,
    context: {
      bindFramebuffer: () => {},
      viewport: () => {},
      // What the active engine actually cleared to, after the background changed in place.
      readPixels: (
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        _f: number,
        _t: number,
        pixels: Uint8Array,
      ) => pixels.set([0x22, 0x44, 0xff, 0xff]),
      drawingBufferWidth: 2,
      drawingBufferHeight: 2,
    } as unknown as WebGL2RenderingContext,
    // The colour the session opened on: stale the moment the background changes in place.
    options: { clearColor: 0xff0000, ...options } as never,
    directGpu: false,
    state: {
      active: { id: 'engine', render: () => {}, scene: { background } } as unknown as RenderBackend,
      measuring: false,
    },
    check: () => {},
    diagnose: (_phase, _message, context) => found.push((context ?? {}) as Record<string, unknown>),
    compose: Object.assign(() => {}, { dispose() {} }),
  });
  capture();
  const raised = found.filter((entry) => entry.kind === 'presentation');
  assert.ok(raised.length > 0, 'no presentation diagnostic was raised');
  return raised;
}

/** A background changed after the session opened is written in place on the active engine's own
 *  scene (`hostBackground`), never on `options.clearColor`: the presentation diagnostic must
 *  read that live colour, or a background changed without a reopen reads as a false mismatch
 *  (#342). */
test('the presentation diagnostic follows a changed background, not the colour the session opened on', () => {
  for (const entry of presentation({}, { getHex: () => 0x2244ff })) {
    assert.equal(entry.clearColor, '#2244ff', 'read the stale, opened-on colour');
    assert.equal(entry.matchesClearAtTopLeft, true, 'a changed background read as a mismatch');
  }
});

// #402: the WebGPU engine keeps its background as a linear record without `getHex`, so the
// diagnostic fell back to the colour the session opened on: it reads the world's colour now.
test('the presentation diagnostic reads the world’s colour whatever record the engine keeps', () => {
  const record = { isColor: true, r: 0.016, g: 0.058, b: 1 };
  for (const entry of presentation({ currentClearColor: () => 0x2244ff }, record)) {
    assert.equal(entry.clearColor, '#2244ff', 'read the stale, opened-on colour');
    assert.equal(entry.matchesClearAtTopLeft, true);
  }
  // A background removed after opening clears with the default, never the opened-on colour.
  for (const entry of presentation({ currentClearColor: () => undefined }, null))
    assert.equal(entry.clearColor, '#171d28', 'a removed background read the opened-on colour');
});

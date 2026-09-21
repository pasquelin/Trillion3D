import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebglSurface, WEBGL_CONTEXT_ATTRIBUTES } from './webglSurface.ts';

function fixture() {
  const listeners = new Map<string, EventListener>();
  let losses = 0,
    widthWrites = 0,
    heightWrites = 0,
    width = 0,
    height = 0;
  const context = {
    isContextLost: () => false,
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext: () => losses++ } : null,
  } as unknown as WebGL2RenderingContext;
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      widthWrites++;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      heightWrites++;
    },
    getContext: (kind: string, attributes: WebGLContextAttributes) => {
      assert.equal(kind, 'webgl2');
      assert.deepEqual(attributes, WEBGL_CONTEXT_ATTRIBUTES);
      return context;
    },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    context,
    listeners,
    losses: () => losses,
    writes: () => [widthWrites, heightWrites],
  };
}

test('engine surface owns context size, loss, restoration, and disposal', () => {
  const f = fixture();
  let lost = 0,
    restored = 0,
    prevented = 0;
  const surface = createWebglSurface(f.canvas, {
    onLost: () => lost++,
    onRestored: () => restored++,
  });
  assert.equal(surface.context, f.context);
  surface.resize(641, 359, 1.5);
  assert.deepEqual(surface.size, {
    width: 641,
    height: 359,
    pixelRatio: 1.5,
    drawingWidth: 961,
    drawingHeight: 538,
  });
  surface.resize(641, 359, 1.5);
  assert.deepEqual(f.writes(), [1, 1]);
  f.listeners.get('webglcontextlost')!({
    preventDefault: () => prevented++,
  } as unknown as Event);
  assert.equal(surface.lost, true);
  assert.equal(lost, 1);
  assert.equal(prevented, 1);
  f.listeners.get('webglcontextrestored')!(new Event('webglcontextrestored'));
  assert.equal(surface.lost, false);
  assert.equal(restored, 1);
  surface.dispose();
  surface.dispose();
  assert.equal(surface.disposed, true);
  assert.equal(f.losses(), 1);
  assert.deepEqual([...f.listeners], []);
  assert.throws(() => surface.resize(1, 1), /disposed/);
});

test('engine surface rejects a missing WebGL2 context', () => {
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
  assert.throws(() => createWebglSurface(canvas), /WebGL2 unavailable/);
});

test('engine surface reports a loss the context knows before its event arrives', () => {
  let lost = false;
  const canvas = {
    getContext: () => ({ isContextLost: () => lost, getExtension: () => null }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  const surface = createWebglSurface(canvas);
  assert.equal(surface.lost, false);
  lost = true;
  assert.equal(surface.lost, true);
});

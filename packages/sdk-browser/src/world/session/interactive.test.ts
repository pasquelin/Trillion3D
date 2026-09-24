import test from 'node:test';
import assert from 'node:assert/strict';
import { startInteractiveExplorer } from './interactive.ts';

test('a frame that throws after the first stops the loop and says so on the console', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const view = {
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
  };
  const canvas = { clientWidth: 4, clientHeight: 4, ownerDocument: { defaultView: view } };
  let frames = 0;
  const explorer = {
    render() {
      if (++frames > 1) throw new Error('WEBGPU_LOST');
      return {};
    },
    resize() {},
  };
  const runtime = {
    canvas,
    options: { width: 4, height: 4, pixelRatio: 1 },
    hostedControls: [],
    state: { disposed: false },
    pendingFrame: async () => false,
  };
  const events = { emit() {}, diagnose() {} };
  const invalidate = startInteractiveExplorer(
    explorer as never,
    runtime as never,
    { ownControls: false, pixelRatio: 1, onFrame() {} } as never,
    events,
  );
  invalidate();
  await new Promise((wake) => setTimeout(wake, 10));
  assert.equal(frames, 2);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /Automatic rendering stopped/);
  assert.match(String(logged.mock.calls[0].arguments[1]), /WEBGPU_LOST/);
});

test('the first image is drawn at start even for a host with no frame hook', async () => {
  let frames = 0;
  const view = {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
  };
  const canvas = { clientWidth: 4, clientHeight: 4, ownerDocument: { defaultView: view } };
  startInteractiveExplorer(
    { render: () => (frames++, {}), resize() {} } as never,
    {
      canvas,
      options: { width: 4, height: 4, pixelRatio: 1 },
      hostedControls: [],
      state: { disposed: false },
      pendingFrame: async () => false,
    } as never,
    { ownControls: false, pixelRatio: 1 } as never,
    { emit() {}, diagnose() {} },
  );
  assert.equal(frames, 1);
});

test('a canvas whose box grows after start is resized and scheduled a frame (#492)', (t) => {
  let observed: (() => void) | undefined;
  Object.assign(globalThis, {
    ResizeObserver: class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'ResizeObserver'));
  const frames: (() => void)[] = [];
  const view = {
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    cancelAnimationFrame() {},
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 2,
  };
  // The box the lesson's canvas had when its world opened: 488 × 20 px.
  const canvas = { clientWidth: 488, clientHeight: 20, ownerDocument: { defaultView: view } };
  const sizes: number[][] = [];
  startInteractiveExplorer(
    { render: () => ({}), resize: (w: number, h: number) => sizes.push([w, h]) } as never,
    {
      canvas,
      options: { width: 488, height: 20, pixelRatio: 2 },
      hostedControls: [],
      state: { disposed: false },
      pendingFrame: async () => false,
    } as never,
    { ownControls: false, interactive: true } as never,
    { emit() {}, diagnose() {} },
  );
  frames.shift()!();
  canvas.clientHeight = 300;
  observed!();
  assert.deepEqual(sizes, [[488, 300]]);
  assert.equal(frames.length, 1, 'the grown box schedules a frame');
});

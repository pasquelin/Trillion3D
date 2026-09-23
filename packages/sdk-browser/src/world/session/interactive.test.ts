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

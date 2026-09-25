import test from 'node:test';
import assert from 'node:assert/strict';
import { startInteractiveExplorer } from './interactive.ts';
import type { MeasuredWorldOptions } from './options.ts';

const listeners = { addEventListener() {}, removeEventListener() {} };
/** A browser frame queue that runs nothing by itself: each test calls what it asked. */
const queued = (frames: (() => void)[]) => ({
  requestAnimationFrame: (callback: () => void) => frames.push(callback),
  cancelAnimationFrame() {},
});

/** Starts the loop on a stub window and a canvas of `width` × `height` CSS pixels. */
function start(
  explorer: object,
  schedule: {
    requestAnimationFrame: (callback: () => void) => unknown;
    cancelAnimationFrame: (id: number) => void;
  },
  {
    width = 4,
    height = 4,
    pixelRatio = 1,
    config = { ownControls: false, pixelRatio: 1 },
  }: {
    width?: number;
    height?: number;
    pixelRatio?: number;
    /** The host's options the loop reads; the rest of a world's options stays out of it. */
    config?: Partial<MeasuredWorldOptions>;
  } = {},
) {
  const view = {
    ...schedule,
    ...listeners,
    matchMedia: () => listeners,
    devicePixelRatio: pixelRatio,
  };
  const canvas = { clientWidth: width, clientHeight: height, ownerDocument: { defaultView: view } };
  const runtime = {
    canvas,
    options: { width, height, pixelRatio },
    hostedControls: [],
    state: { disposed: false },
    pendingFrame: async () => false,
  };
  const invalidate = startInteractiveExplorer(
    explorer as never,
    runtime as never,
    config as never,
    {
      emit() {},
      diagnose() {},
    },
  );
  return { canvas, invalidate };
}

test('a frame that throws after the first stops the loop and says so on the console', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  let frames = 0;
  const explorer = {
    render() {
      if (++frames > 1) throw new Error('WEBGPU_LOST');
      return {};
    },
    resize() {},
  };
  const { invalidate } = start(
    explorer,
    {
      requestAnimationFrame: (callback) => setTimeout(callback, 0),
      cancelAnimationFrame: (id) => clearTimeout(id),
    },
    { config: { ownControls: false, pixelRatio: 1, onFrame() {} } },
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
  start(
    { render: () => (frames++, {}), resize() {} },
    { requestAnimationFrame: () => 0, cancelAnimationFrame() {} },
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
  const sizes: number[][] = [];
  // The box the lesson's canvas had when its world opened: 488 × 20 px.
  const { canvas } = start(
    { render: () => ({}), resize: (w: number, h: number) => sizes.push([w, h]) },
    queued(frames),
    { width: 488, height: 20, pixelRatio: 2, config: { ownControls: false, interactive: true } },
  );
  frames.shift()!();
  canvas.clientHeight = 300;
  observed!();
  assert.deepEqual(sizes, [[488, 300]]);
  assert.equal(frames.length, 1, 'the grown box schedules a frame');
});

test('a capture, colour or surface, asks the idle loop for the view it put back (#349)', async () => {
  const frames: (() => void)[] = [];
  let taken: Promise<Uint8Array> = Promise.resolve(new Uint8Array(4));
  const explorer = {
    render: () => ({}),
    resize() {},
    captureView: () => taken,
    captureSurfaceView: () => taken,
  };
  start(explorer, queued(frames));
  frames.shift()!();
  await new Promise((wake) => setImmediate(wake));
  assert.equal(frames.length, 0, 'the loop is idle');
  await explorer.captureView();
  assert.equal(frames.length, 1, 'a colour capture asks a frame');
  frames.shift()!();
  await new Promise((wake) => setImmediate(wake));
  await explorer.captureSurfaceView();
  assert.equal(frames.length, 1, 'a surface capture asks a frame');
  frames.shift()!();
  await new Promise((wake) => setImmediate(wake));
  taken = Promise.reject(new Error('CAPTURE_NOT_READY'));
  await assert.rejects(explorer.captureView(), /CAPTURE_NOT_READY/);
  assert.equal(frames.length, 1, 'a failed capture put the view back too');
});

test('the frame a capture asks waits while the next capture draws (#349)', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const frames: (() => void)[] = [];
  const turn = () => new Promise((wake) => setImmediate(wake));
  // An image drawn during a capture is refused, as the engines refuse it.
  let busy = false,
    drawn = 0,
    finish = () => {};
  const taking = () => {
    busy = true;
    return new Promise<Uint8Array>(
      (done) => (finish = () => ((busy = false), done(new Uint8Array(4)))),
    );
  };
  const explorer = {
    render() {
      if (busy) throw new Error('SURFACE_CAPTURE_BUSY');
      drawn++;
      return {};
    },
    resize() {},
    captureView: taking,
    captureSurfaceView: taking,
  };
  start(explorer, queued(frames));
  frames.shift()!();
  await turn();
  const first = explorer.captureView();
  finish();
  await first;
  assert.equal(frames.length, 1, 'the first capture asks the view back');
  const second = explorer.captureSurfaceView();
  frames.shift()!();
  await turn();
  assert.equal(logged.mock.callCount(), 0, 'the loop still runs');
  assert.equal(frames.length, 0, 'no frame is spent while the capture draws');
  finish();
  await second;
  assert.equal(frames.length, 1, 'the second capture asks the view back');
  const before = drawn;
  frames.shift()!();
  assert.equal(drawn, before + 1, 'the view is drawn again');
});

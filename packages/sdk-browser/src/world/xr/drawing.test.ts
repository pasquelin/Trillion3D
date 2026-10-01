import test from 'node:test';
import assert from 'node:assert/strict';
import { openXrDrawing } from './drawing.ts';
import { XrSessionEmulator, xrFrame } from './session.fixture.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { selectVisiblePages } from '../../page/cut/cut.ts';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';

test('a failed eye release still waits for its peer and releases the native layer once', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'XRGPUBinding');
  let layers = 0,
    eyes = 0,
    complete = false,
    free!: () => void;
  const held = new Promise<void>((resolve) => {
    free = resolve;
  });
  const failure = new Error('left release failed');
  class Binding {
    createProjectionLayer() {
      return {
        destroy: () => {
          layers++;
        },
      };
    }
  }
  Object.defineProperty(globalThis, 'XRGPUBinding', { value: Binding, configurable: true });
  try {
    const drawing = await openXrDrawing(new XrSessionEmulator(), {
      device: {} as GPUDevice,
      context: {} as BackendContext,
      backend: {
        async createXrEye() {
          const index = eyes++;
          return {
            draw() {},
            dispose() {
              if (!index) throw failure;
              return held;
            },
          };
        },
      } as unknown as RenderBackend,
      render() {},
    });
    const releasing = drawing.dispose();
    const rejected = assert.rejects(Promise.resolve(releasing), (error: AggregateError) => {
      complete = true;
      assert.deepEqual(error.errors, [failure]);
      return true;
    });
    assert.equal(drawing.dispose(), releasing);
    await new Promise(setImmediate);
    assert.equal(complete, false);
    assert.equal(layers, 0, 'the borrowed layer survives until both eye releases finish');
    free();
    await rejected;
    assert.equal(layers, 1);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'XRGPUBinding', prior);
    else Reflect.deleteProperty(globalThis, 'XRGPUBinding');
  }
});

test('the XR frame renders both persistent eyes through one host frame and one shared cut, then relinquishes the binding', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'XRGPUBinding');
  const draws: number[] = [],
    releases: number[] = [];
  let layers = 0,
    hostFrames = 0;
  const texture = { createView: () => ({}), width: 2000, height: 1000 };
  class Binding {
    createProjectionLayer() {
      return { destroy: () => layers++ };
    }
    getViewSubImage(_layer: unknown, view: { eye: string }) {
      return {
        colorTexture: texture,
        viewport: { x: view.eye === 'left' ? 0 : 1000, y: 0, width: 1000, height: 1000 },
      };
    }
  }
  Object.defineProperty(globalThis, 'XRGPUBinding', { value: Binding, configurable: true });
  const context = {} as BackendContext;
  const sharedMetrics = { submittedTriangles: 0 };
  let submitted = 0;
  const root = ruleDag(8),
    selected: string[][] = [];
  const backend = {
    async createXrEye() {
      const index = releases.length;
      releases.push(0);
      return {
        draw(camera: Parameters<typeof readCameraWorld>[1]) {
          draws.push(index);
          const engine = readCameraWorld(createEngineCamera(), camera, 1);
          const cut = (context.stereo?.select ?? selectVisiblePages)([root], engine, {
            pixelError: 0,
          });
          selected.push(cut.wanted.map((page) => page.url));
          assert.equal(context.stereo?.views.length, 2);
          sharedMetrics.submittedTriangles = index + 1;
          return sharedMetrics;
        },
        async dispose() {
          releases[index]++;
        },
      };
    },
  } as unknown as RenderBackend;
  const session = new XrSessionEmulator();
  const frame = xrFrame(session);
  const views = frame.getViewerPose(session.space)!.views;
  for (const view of views)
    view.projectionMatrix.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0]);
  try {
    const drawing = await openXrDrawing(session, {
      backend,
      context,
      device: {} as GPUDevice,
      render(draw) {
        hostFrames++;
        submitted = draw(backend).submittedTriangles ?? 0;
      },
    });
    drawing.draw(frame, session.space, views, 1);
    assert.equal(hostFrames, 1);
    assert.equal(submitted, 3, 'per-eye snapshots survive a backend reusing its metrics object');
    assert.deepEqual(draws, [0, 1]);
    assert.deepEqual(selected[0], selected[1]);
    assert.equal(context.stereo, undefined);
    await drawing.dispose();
    await drawing.dispose();
    assert.deepEqual(releases, [1, 1]);
    assert.equal(layers, 1);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'XRGPUBinding', prior);
    else Reflect.deleteProperty(globalThis, 'XRGPUBinding');
  }
});

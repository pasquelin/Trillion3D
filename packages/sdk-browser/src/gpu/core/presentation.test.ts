import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPresenter } from './presentation.ts';
import { claimGpuDevice } from './deviceOwners.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('presentation acquires a fresh canvas target after resizing, shared by fused and copy paths', () => {
  const sizes: number[][] = [],
    views: object[] = [],
    passes: GPURenderPassDescriptor[] = [];
  let configured: GPUCanvasConfiguration | undefined,
    unconfigured = false;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      configure(value: GPUCanvasConfiguration) {
        configured = value;
      },
      getCurrentTexture() {
        sizes.push([canvas.width, canvas.height]);
        return {
          createView() {
            const view = {};
            views.push(view);
            return view;
          },
        };
      },
      unconfigure() {
        unconfigured = true;
      },
    }),
  } as unknown as HTMLCanvasElement;
  const { device } = fakeDevice();
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      passes.push(descriptor);
      return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const presenter = createGpuPresenter(device, canvas);
  try {
    const first = presenter.targetView(32, 24),
      second = presenter.targetView(64, 48);
    assert.notEqual(first, second, 'swapchain views cannot survive a new frame');
    assert.deepEqual(sizes, [
      [32, 24],
      [64, 48],
    ]);
    assert.equal(passes.length, 0, 'acquiring a target must not encode a copy pass');
    presenter.present(encoder, { createView: () => ({}) } as GPUTexture, 16, 12);
    assert.deepEqual(sizes.at(-1), [16, 12]);
    assert.equal(Array.from(passes[0].colorAttachments)[0]?.view, views[2]);
    assert.equal(configured?.format, 'bgra8unorm');
    assert.equal(configured?.alphaMode, 'opaque');
  } finally {
    presenter.dispose();
  }
  assert.equal(unconfigured, true);
});

test("a session's canvas is configured with the device itself, not the session's handle", () => {
  let given: GPUDevice | undefined;
  const canvas = {
    getContext: () => ({
      configure: (value: GPUCanvasConfiguration) => (given = value.device),
      unconfigure() {},
    }),
  } as unknown as HTMLCanvasElement;
  const { device } = fakeDevice();
  const claim = claimGpuDevice(device, { error() {}, closedError() {}, lost() {} });
  createGpuPresenter(claim.device, canvas).dispose();
  assert.equal(given, device);
});

test('a view presents at its rectangle: the canvas keeps its size and what it shows', () => {
  const canvas = {
    width: 64,
    height: 48,
    getContext: () => ({
      configure() {},
      getCurrentTexture: () => ({ createView: () => ({}) }),
      unconfigure() {},
    }),
  } as unknown as HTMLCanvasElement;
  const calls: unknown[][] = [],
    passes: GPURenderPassDescriptor[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, ...args]);
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      passes.push(descriptor);
      const [setViewport, setScissorRect, draw] = ['viewport', 'scissor', 'draw'].map(record);
      return { setPipeline() {}, setBindGroup() {}, setViewport, setScissorRect, draw, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const presenter = createGpuPresenter(fakeDevice().device, canvas);
  const image = { createView: () => ({}) } as GPUTexture;
  presenter.present(encoder, image, 16, 8, { x: 40, y: 44, width: 32, height: 8 });
  assert.deepEqual([canvas.width, canvas.height], [64, 48], 'the canvas is not resized');
  assert.equal(Array.from(passes[0].colorAttachments)[0]?.loadOp, 'load');
  assert.deepEqual(calls, [
    ['viewport', 40, 44, 24, 4, 0, 1],
    ['scissor', 40, 44, 24, 4],
    ['draw', 3, 1, 0, 40 + 44 * 65536],
  ]);
  presenter.present(encoder, image, 16, 8, { x: 64, y: 0, width: 16, height: 8 });
  assert.equal(passes.length, 1, 'a rectangle outside the canvas draws nothing');
  presenter.dispose();
});

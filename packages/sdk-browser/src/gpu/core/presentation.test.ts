import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPresenter } from './presentation.ts';
import { claimGpuDevice } from './deviceOwners.ts';

test('presentation acquires a fresh canvas target after resizing, shared by fused and copy paths', () => {
  Object.assign(globalThis, { GPUShaderStage: { FRAGMENT: 2 } });
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
  const device = {
    createBindGroupLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
  } as unknown as GPUDevice;
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

test("a session's canvas views carry its tag, one descriptor for every frame", () => {
  Object.assign(globalThis, { GPUShaderStage: { FRAGMENT: 2 } });
  const asked: Array<GPUTextureViewDescriptor | undefined> = [];
  let given: GPUDevice | undefined;
  const texture = { createView: (descriptor?: GPUTextureViewDescriptor) => asked.push(descriptor) };
  const canvas = {
    getContext: () => ({
      configure: (value: GPUCanvasConfiguration) => (given = value.device),
      getCurrentTexture: () => texture,
      unconfigure() {},
    }),
  } as unknown as HTMLCanvasElement;
  const made = () => ({});
  const device = {
    lost: new Promise(() => {}),
    createBindGroupLayout: made,
    createShaderModule: made,
    createRenderPipeline: made,
    createPipelineLayout: made,
  } as unknown as GPUDevice;
  const { device: handle, tag } = claimGpuDevice(device, {
    error() {},
    closedError() {},
    lost() {},
  });
  const presenter = createGpuPresenter(handle, canvas);
  presenter.targetView(4, 4);
  presenter.targetView(4, 4);
  presenter.dispose();
  assert.equal(given, device, 'the canvas takes the device itself');
  assert.equal(asked[0]?.label, `Trillion3D canvas ${tag}`);
  assert.equal(asked[1], asked[0]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuPresenter } from './presentation.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { presentDrawnView } from '../../webgpu/pages/state/presentation.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';

test('a rectangular main image starts every canvas frame, including held frames, and other views preserve it', () => {
  const passes: GPURenderPassDescriptor[] = [],
    rects: number[][] = [];
  const texture = () => ({ createView: () => ({}) }) as GPUTexture;
  let current = texture();
  const canvas = {
    width: 600,
    height: 400,
    getContext: () => ({
      configure() {},
      unconfigure() {},
      getCurrentTexture: () => current,
    }),
  } as unknown as HTMLCanvasElement;
  const { device } = fakeDevice();
  const presenter = createGpuPresenter(device, canvas);
  const main = { rect: { x: 0, y: 0, width: 300, height: 400 } };
  const side = { rect: { x: 300, y: 0, width: 300, height: 400 } };
  const rt = {
    gpu: { presenter, displayTexture: texture(), displaySize: [300, 400] },
    views: { main, active: main },
  } as unknown as WebgpuPagesRuntime;
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      passes.push(descriptor);
      return {
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
        setViewport() {},
        setScissorRect(...rect: number[]) {
          rects.push(rect);
        },
      };
    },
  } as unknown as GPUCommandEncoder;
  for (let frame = 0; frame < 2; frame++) {
    current = texture();
    rt.views.active = main as never;
    presentDrawnView(rt, encoder);
    rt.views.active = side as never;
    presentDrawnView(rt, encoder);
    assert.deepEqual(
      [canvas.width, canvas.height],
      [600, 400],
      'a view never resizes the shared canvas',
    );
  }
  assert.deepEqual(
    passes.map((pass) => Array.from(pass.colorAttachments)[0]!.loadOp),
    ['clear', 'load', 'load', 'clear', 'load', 'load'],
  );
  assert.deepEqual(rects, [
    [0, 0, 300, 400],
    [300, 0, 300, 400],
    [0, 0, 300, 400],
    [300, 0, 300, 400],
  ]);
  presenter.dispose();
});

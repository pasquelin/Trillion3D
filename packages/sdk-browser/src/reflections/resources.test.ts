import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createScreenReflection } from './gpu.ts';
import { createWebgpuView } from '../webgpu/pages/state/view.ts';
import { useWebgpuView, releaseWebgpuView } from '../webgpu/pages/state/viewSwitch.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

// The reflection owns only linear colour and its matrix; every receiver reads opaque depth.
test('reflection resources have bounded active/inactive size, use shared depth and release both allocations', () => {
  for (const active of [false, true]) {
    const gpu = fakeDevice(),
      depth = {} as GPUTextureView;
    const reflection = createScreenReflection(gpu.device, 64, 32, depth, active);
    assert.deepEqual(
      gpu.textures[0].size,
      active ? { width: 64, height: 32 } : { width: 1, height: 1 },
    );
    assert.equal(gpu.buffers[0].size, 80);
    assert.equal(Array.from(gpu.bindGroups[0].entries)[1].resource, depth);
    reflection.update(new Float32Array(16), true);
    reflection.dispose();
    assert.equal(gpu.destroyed.length, 2);
  }
});

test('capture release restores the original reflection and its matching depth binding', () => {
  const gpu = fakeDevice(),
    main = createWebgpuView(64, 32),
    capture = createWebgpuView(32, 16);
  const mainDepth = {} as GPUTextureView,
    captureDepth = {} as GPUTextureView;
  main.gpu.reflection = createScreenReflection(gpu.device, 64, 32, mainDepth, true);
  capture.gpu.reflection = createScreenReflection(gpu.device, 32, 16, captureDepth, true);
  main.gpu.depthView = mainDepth;
  capture.gpu.depthView = captureDepth;
  const original = main.gpu.reflection;
  const rt = {
    gpu: { ...main.gpu },
    vis: { ...main.vis },
    run: { ...main.run, cutEpoch: 0, gate: { cam: main.cam, viewReplaced() {} } },
    setup: { viewport: main.viewport },
    capture: {},
    views: { main, active: main },
    services: { releaseView() {} },
  } as unknown as WebgpuPagesRuntime;
  useWebgpuView(rt, capture);
  assert.equal(rt.gpu.reflection, capture.gpu.reflection);
  releaseWebgpuView(rt, capture);
  assert.equal(rt.gpu.reflection, original);
  assert.equal(rt.gpu.depthView, mainDepth);
  assert.equal(gpu.destroyed.length, 2);
  original.dispose();
  assert.equal(gpu.destroyed.length, 4);
});

test('a refused uniform releases the reflection colour allocated before it', () => {
  const gpu = fakeDevice({
    refuse: (descriptor) => ('size' in descriptor && descriptor.size === 80 ? 'throw' : undefined),
  });
  assert.throws(
    () => createScreenReflection(gpu.device, 64, 32, {} as GPUTextureView, true),
    /NO_MEMORY/,
  );
  assert.equal(gpu.destroyed.length, 1);
});

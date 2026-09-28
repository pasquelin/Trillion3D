import { startGrant } from '../gpu/core/errorScope.ts';
import { releaseSettledCapture } from '../webgpu/pages/io/captureAside.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createScreenReflection } from './gpu.ts';
import { createWebgpuView } from '../webgpu/pages/state/view.ts';
import { useWebgpuView } from '../webgpu/pages/state/viewSwitch.ts';
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

test('capture release waits for a late grant, including rejection, before restoring the original reflection', async () => {
  for (const refused of [false, true]) {
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
      run: {
        ...main.run,
        gate: { cam: main.cam, useViewHold: () => undefined },
        pendingHeld: {},
        urlsHeld: {},
        ranksHeld: {},
      },
      setup: { viewport: main.viewport },
      capture: {},
      views: { main, active: main },
      services: { releaseView() {} },
    } as unknown as WebgpuPagesRuntime;
    useWebgpuView(rt, capture);
    assert.equal(rt.gpu.reflection, capture.gpu.reflection);
    let complete!: () => void;
    const work = new Promise<void>((resolve) => {
      complete = resolve;
    }).then(() => {
      assert.equal(rt.views.active, capture, 'late grant completes on its own view');
      if (refused) throw new Error('late target refusal');
    });
    rt.gpu.targetGrant = startGrant(work, { width: 32, height: 16 });
    const cleanup = releaseSettledCapture(rt, capture);
    await Promise.resolve();
    assert.equal(rt.views.active, capture);
    assert.equal(gpu.destroyed.length, 0);
    complete();
    if (refused) await assert.rejects(cleanup, /late target refusal/);
    else await cleanup;
    assert.equal(rt.gpu.reflection, original);
    assert.equal(rt.gpu.depthView, mainDepth);
    assert.equal(gpu.destroyed.length, 2);
    original.dispose();
    assert.equal(gpu.destroyed.length, 4);
  }
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

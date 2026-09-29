import test from 'node:test';
import assert from 'node:assert/strict';
import { probeExplorerCapabilities } from './capabilityProbe.ts';
import { grantedGpuFeatures, requestExplorerDevice } from './gpuDevice.ts';
import { colorBytesPerSample } from '../../gpu/core/colorBytes.ts';
import { waterSurfaceTargets } from '../../webgpu/water/pipelines.ts';
import type { ExplorerSession } from './session.ts';

/** An adapter offering `offered`; its device grants exactly what was asked. */
function adapterOffering(offered: string[], limits: Record<string, number> = {}) {
  const asked: GPUFeatureName[][] = [];
  const limitsAsked: Record<string, number>[] = [];
  const adapter = {
    features: new Set(offered),
    limits,
    requestDevice: async ({ requiredFeatures = [], requiredLimits = {} }: GPUDeviceDescriptor) => {
      asked.push([...requiredFeatures]);
      limitsAsked.push(requiredLimits as Record<string, number>);
      return { features: new Set(requiredFeatures) } as unknown as GPUDevice;
    },
  } as unknown as GPUAdapter;
  return { adapter, asked, limitsAsked };
}

const OFFERED = [
  'shader-f16',
  'float32-filterable',
  'subgroups',
  'texture-compression-bc',
  'depth-clip-control',
];

test('the device asks exactly the optional features the adapter offers, and publishes them', async () => {
  const { adapter, asked } = adapterOffering(OFFERED);
  const device = await requestExplorerDevice(adapter, '?other=1');
  // `float32-filterable` is offered but used by no kernel: it is not asked for.
  assert.deepEqual(asked, [
    ['subgroups', 'shader-f16', 'depth-clip-control', 'texture-compression-bc'],
  ]);
  assert.deepEqual(grantedGpuFeatures(device), asked[0]);
});

test('a feature the URL forces off is neither asked for nor published', async () => {
  const { adapter, asked } = adapterOffering(OFFERED);
  const off = '?trillion3dGpuFeaturesOff=subgroups,%20shader-f16';
  const device = await requestExplorerDevice(adapter, off);
  assert.deepEqual(asked, [['depth-clip-control', 'texture-compression-bc']]);
  assert.deepEqual(grantedGpuFeatures(device), ['depth-clip-control', 'texture-compression-bc']);
});

// #1248: the device carries the adapter's own colour bytes, whatever the engine's widest pass.
test("the device asks the adapter's own colour bytes per sample, above or below the water pass", async () => {
  const water = colorBytesPerSample(waterSurfaceTargets(true).map((target) => target.format));
  assert.ok(water > 32, "the water surface stage writes above WebGPU's default");
  for (const offered of [128, water, 32]) {
    const { adapter, limitsAsked } = adapterOffering([], {
      maxColorAttachmentBytesPerSample: offered,
    });
    await requestExplorerDevice(adapter, '');
    assert.equal(limitsAsked[0].maxColorAttachmentBytesPerSample, offered);
  }
});

test('the session says which optional features its WebGPU device was granted', async () => {
  const canvas = {
    getContext: () => ({ getSupportedExtensions: () => [], getExtension: () => null }),
  };
  const said: [string, Record<string, unknown> | undefined][] = [];
  const session = {
    canvas,
    options: {
      gpuDevice: { features: new Set(['subgroups', 'timestamp-query']) } as unknown as GPUDevice,
    },
    scope: 'test',
    emit: () => {},
    diagnose: (_phase: string, message: string, context?: Record<string, unknown>) =>
      said.push([message, context]),
  } as unknown as ExplorerSession;
  Object.assign(globalThis, { document: { createElement: () => canvas } });
  try {
    await probeExplorerCapabilities(session);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  const granted = said.find(([message]) => message === 'WebGPU device granted');
  assert.deepEqual(granted?.[1]?.features, ['timestamp-query', 'subgroups']);
});

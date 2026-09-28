import test from 'node:test';
import assert from 'node:assert/strict';
import { probeExplorerCapabilities } from './capabilityProbe.ts';
import { gpuFeaturesForcedOff, grantedGpuFeatures, requestExplorerDevice } from './gpuDevice.ts';
import type { ExplorerSession } from './session.ts';

/** An adapter offering `offered`; its device grants exactly what was asked. */
function adapterOffering(offered: string[]) {
  const asked: GPUFeatureName[][] = [];
  const adapter = {
    features: new Set(offered),
    limits: {},
    requestDevice: async ({ requiredFeatures = [] }: GPUDeviceDescriptor) => {
      asked.push([...requiredFeatures]);
      return { features: new Set(requiredFeatures) } as unknown as GPUDevice;
    },
  } as unknown as GPUAdapter;
  return { adapter, asked };
}

const OFFERED = ['shader-f16', 'float32-filterable', 'subgroups', 'texture-compression-bc'];

test('the device asks exactly the optional features the adapter offers, and publishes them', async () => {
  const { adapter, asked } = adapterOffering(OFFERED);
  const device = await requestExplorerDevice(adapter, new Set());
  // `float32-filterable` is offered but used by no kernel: it is not asked for.
  assert.deepEqual(asked, [['subgroups', 'shader-f16', 'texture-compression-bc']]);
  assert.deepEqual(grantedGpuFeatures(device), asked[0]);
});

test('a feature the URL forces off is neither asked for nor published', async () => {
  const off = gpuFeaturesForcedOff('?trillion3dGpuFeaturesOff=subgroups,%20shader-f16');
  assert.deepEqual([...off], ['subgroups', 'shader-f16']);
  assert.equal(gpuFeaturesForcedOff('?other=1').size, 0);
  const { adapter, asked } = adapterOffering(OFFERED);
  const device = await requestExplorerDevice(adapter, off);
  assert.deepEqual(asked, [['texture-compression-bc']]);
  assert.deepEqual(grantedGpuFeatures(device), ['texture-compression-bc']);
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
  await probeExplorerCapabilities(session);
  const granted = said.find(([message]) => message === 'WebGPU device granted');
  assert.deepEqual(granted?.[1]?.features, ['timestamp-query', 'subgroups']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades } from '../../../sdk-core/src/index.ts';
import { ownedProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts';
import { createProbeStorage } from './probeStorage.ts';

test('a refused probe snapshot releases the entire new probe bundle, preserving earlier resources', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  let ceiling = 1e9;
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling });
  const previous = gpu.device.createBuffer({ size: 64, usage: 0 });
  const proxy = ownedProxy();
  const cascades = createBounceCascades(proxy.bounds);
  const originalCreate = gpu.device.createBuffer.bind(gpu.device);
  gpu.device.createBuffer = (descriptor) => {
    if (descriptor.label === 'Trillion3D bounce probes snapshot v2') ceiling = ledger.bytes;
    return originalCreate(descriptor);
  };
  assert.throws(
    () => createProbeStorage(gpu.device, proxy, cascades, 16, 64),
    /GPU_BUDGET_EXCEEDED/,
  );
  assert.equal(ledger.bytes, 64);
  assert.equal(gpu.destroyed.includes(previous), false);
  assert.ok(gpu.buffers.length > 3, 'several successful creations precede the refused snapshot');
  assert.ok(gpu.buffers.slice(1).every((buffer) => gpu.destroyed.includes(buffer)));
  assert.ok(gpu.buffers.every((buffer) => buffer.label !== 'Trillion3D bounce probes snapshot v2'));
});

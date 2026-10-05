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
  const originalCreate = gpu.device.createTexture.bind(gpu.device);
  gpu.device.createTexture = (descriptor) => {
    if (descriptor.label === 'Trillion3D bounce probes snapshot v3') ceiling = ledger.bytes;
    return originalCreate(descriptor);
  };
  assert.throws(
    () => createProbeStorage(gpu.device, proxy, cascades, 16, [11, 1, 1]),
    /GPU_BUDGET_EXCEEDED/,
  );
  assert.equal(ledger.bytes, 64);
  assert.equal(gpu.destroyed.includes(previous), false);
  assert.ok(gpu.buffers.length > 2, 'several successful creations precede the refused snapshot');
  const made = [...gpu.buffers.slice(1), ...gpu.textures];
  assert.ok(made.every((resource) => gpu.destroyed.includes(resource)));
  assert.ok(
    gpu.textures.every((texture) => texture.label !== 'Trillion3D bounce probes snapshot v3'),
  );
});

test('a level is cleared in the probes and in their snapshot by one pass, the two staying equal', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  const proxy = ownedProxy();
  const storage = createProbeStorage(
    gpu.device,
    proxy,
    createBounceCascades(proxy.bounds),
    16,
    [11, 1, 3],
  );
  // The descriptor is reused: each pass's attachments are read as it begins.
  const cleared: unknown[][] = [];
  const encoder = {
    beginRenderPass: (d: GPURenderPassDescriptor) => (
      cleared.push([...d.colorAttachments].map((a) => [a!.view, a!.loadOp])),
      { end() {} }
    ),
  } as unknown as GPUCommandEncoder;
  storage.clearLevels(encoder, 0b101);
  assert.deepEqual(
    cleared,
    [0, 2].map((level) => [
      [storage.views.levels[level], 'clear'],
      [storage.views.snapshotLevels[level], 'clear'],
    ]),
  );
});

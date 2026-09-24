import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice } from './deviceOwners.ts';
import { namesNoSession, sharedGpuDevice, tagsIn, untag } from './sessionHandle.ts';
import { installGpuDeviceLedger } from './deviceLedger.ts';
import { validated } from './errorScope.ts';
import { generateMaterialMips } from '../../texture/mips.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { deviceOwner } from '../../../../../tests/kit/gpu/webgpuDevice.ts';

test('every object a session creates names it; the device names none', () => {
  const gpu = mockGpu();
  const { device: handle, tag } = claimGpuDevice(gpu.device, deviceOwner());
  assert.equal(sharedGpuDevice(handle), gpu.device);
  assert.equal(handle.limits, gpu.device.limits);
  // Detached, a creation still runs on the device, which refuses any other `this`.
  const { createTexture } = handle;
  createTexture({ size: [1, 1], format: 'r8unorm', usage: 0, label: 'hdr' });
  const [label] = gpu.labels;
  assert.equal(label, `hdr ${tag}`);
  assert.equal(untag(label), 'hdr');
  assert.deepEqual(tagsIn(`[TextureView of Texture "${label}"]`), tagsIn(tag));
  handle.createCommandEncoder();
  gpu.device.createBuffer({ size: 4, usage: 0, label: 'raw' });
  assert.deepEqual(gpu.labels.slice(1), [tag, 'raw']);
});

test("the tagged label rides on the caller's own descriptor for the call only", () => {
  const gpu = mockGpu();
  const { device: handle, tag } = claimGpuDevice(gpu.device, deviceOwner());
  const mine = { label: 'frame' },
    unlabelled = { size: 4, usage: 0 };
  handle.createCommandEncoder(mine);
  handle.createBuffer(unlabelled);
  assert.deepEqual(gpu.given, [mine, unlabelled], 'no copy');
  assert.deepEqual(gpu.labels, [`frame ${tag}`, tag]);
  assert.deepEqual([mine, 'label' in unlabelled], [{ label: 'frame' }, false]);
});

test('a released handle is inert: its creations abort, its queue writes nothing', async () => {
  const gpu = mockGpu();
  const claim = claimGpuDevice(gpu.device, deviceOwner());
  const { queue } = claim.device;
  const buffer = claim.device.createBuffer({ size: 4, usage: 0 });
  queue.writeBuffer(buffer, 0, new Uint8Array(4));
  claim.release();
  assert.throws(() => claim.device.createBuffer({ size: 4, usage: 0 }), { name: 'AbortError' });
  assert.throws(() => claim.device.createCommandEncoder(), { name: 'AbortError' });
  queue.writeBuffer(buffer, 0, new Uint8Array(4));
  queue.writeTexture({ texture: buffer as never }, new Uint8Array(4), {}, [1]);
  queue.copyExternalImageToTexture({} as never, {} as never, [1]);
  queue.submit([]);
  // Its teardown may still wait for what it submitted.
  await queue.onSubmittedWorkDone();
  assert.deepEqual([gpu.writes.length, gpu.textureWrites.length, gpu.submits.length], [1, 0, 0]);
});

test("a session released inside a validation scope closes it: the next one's error reaches the device", async () => {
  const gpu = mockGpu();
  const first = claimGpuDevice(gpu.device, deviceOwner());
  const building = validated(first.device, async () => {
    await Promise.resolve();
    return first.device.createBuffer({ size: 4, usage: 0 });
  });
  first.release();
  await assert.rejects(building, { name: 'AbortError' });
  assert.equal(gpu.scopes.length, 0, 'every scope pushed is popped');
  // A released handle opens no scope, and closes none of another's.
  first.device.pushErrorScope('validation');
  assert.equal(await first.device.popErrorScope(), null);
  assert.equal(gpu.scopes.length, 0);
  const next = deviceOwner();
  claimGpuDevice(gpu.device, next);
  gpu.raise('[Queue] Submit failed');
  assert.deepEqual(next.reasons, ['uncaptured-error']);
});

test('the ledger, on the handle, counts by the label as the engine wrote it, the shared caches once', () => {
  installGpuGlobals();
  const gpu = mockGpu();
  const { device: handle } = claimGpuDevice(gpu.device, deviceOwner());
  const caches = installGpuDeviceLedger(gpu.device, { counts: namesNoSession });
  const ledger = installGpuDeviceLedger(handle, { base: caches });
  handle.createBuffer({ size: 8, usage: 0, label: 'page table' });
  const texture = handle.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
  // What the device keeps for every session is created on it, untagged, and counted by its ledger.
  generateMaterialMips(handle, texture, 'rgba8unorm', 4, 4);
  assert.ok(gpu.labels.includes('Trillion3D texture mips uniforms'));
  const { byLabel } = ledger.snapshot();
  assert.equal(byLabel['page table'], 8);
  assert.equal(
    byLabel['Trillion3D texture mips uniforms'],
    2 * 256,
    'one aligned uniform per level',
  );
  assert.deepEqual(Object.keys(caches.snapshot().byLabel), ['Trillion3D texture mips uniforms']);
});

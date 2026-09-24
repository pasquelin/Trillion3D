import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice } from './deviceOwners.ts';
import { sharedGpuDevice, tagsIn, untag } from './sessionHandle.ts';
import { installGpuDeviceLedger } from './deviceLedger.ts';
import { generateMaterialMips } from '../../texture/mips.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { fakeDevice, owner } from './fakeDevice.fixture.ts';

test('every object a session creates names it; the device names none', () => {
  const device = fakeDevice();
  const { device: handle, tag } = claimGpuDevice(device, owner());
  assert.equal(sharedGpuDevice(handle), device);
  assert.equal(handle.limits.minUniformBufferOffsetAlignment, 256);
  // Detached, a creation still runs on the device, which refuses any other `this`.
  const { createTexture } = handle;
  const texture = createTexture({ size: [1, 1], format: 'r8unorm', usage: 0, label: 'hdr' });
  assert.equal(texture.label, `hdr ${tag}`);
  assert.equal(untag(texture.label), 'hdr');
  assert.deepEqual(tagsIn(`[TextureView of Texture "${texture.label}"]`), tagsIn(tag));
  assert.equal(handle.createQuerySet({ type: 'timestamp', count: 2 }).label, tag);
  assert.equal(handle.createCommandEncoder().label, tag);
  assert.equal(device.createBuffer({ size: 4, usage: 0, label: 'raw' }).label, 'raw');
});

test('a descriptor holding only a label is tagged once, then handed again; the caller’s is kept', () => {
  const device = fakeDevice();
  const { device: handle, tag } = claimGpuDevice(device, owner());
  const mine = { label: 'frame' };
  handle.createCommandEncoder(mine);
  handle.createCommandEncoder({ label: 'frame' });
  handle.createBuffer({ size: 4, usage: 0, label: 'frame' });
  const [first, second, copy] = device.given;
  assert.equal(first, second, 'no copy per frame');
  assert.notEqual(copy, first);
  assert.equal(copy?.label, `frame ${tag}`);
  assert.deepEqual(mine, { label: 'frame' });
});

test('a released handle is inert: its creations abort, its queue writes nothing', async () => {
  const device = fakeDevice();
  const claim = claimGpuDevice(device, owner());
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
  assert.deepEqual(device.queued, ['writeBuffer', 'onSubmittedWorkDone']);
});

test('what the device keeps for every session is created on it, untagged', () => {
  installGpuGlobals();
  const device = fakeDevice();
  const { device: handle } = claimGpuDevice(device, owner());
  const texture = handle.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
  device.given.length = 0;
  generateMaterialMips(handle, texture, 'rgba8unorm', 4, 4);
  assert.ok(device.given.some((given) => given?.label === 'Trillion3D texture mips uniforms'));
});

test('the ledger, on the handle, counts by the label as the engine wrote it', () => {
  const device = fakeDevice();
  const { device: handle } = claimGpuDevice(device, owner());
  const ledger = installGpuDeviceLedger(handle);
  handle.createBuffer({ size: 8, usage: 0, label: 'page table' });
  assert.deepEqual(ledger.snapshot().byLabel, { 'page table': 8 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice } from './deviceOwners.ts';
import { sessionLabel, sharedGpuDevice, untaggedLabel } from './sessionHandle.ts';
import { installGpuDeviceLedger } from './deviceLedger.ts';
import { generateMaterialMips } from '../../texture/mips.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { FakeDevice, fakeDevice, owner } from './fakeDevice.fixture.ts';

test('a session handle forwards every member to the device, under the device as `this`', () => {
  const device = fakeDevice();
  const { device: handle } = claimGpuDevice(device, owner());
  // The fake refuses what WebGPU refuses: a member read on anything but the device.
  assert.throws(() => Reflect.get(FakeDevice.prototype, 'queue', handle), /Illegal invocation/);
  assert.equal(handle.queue, device.queue);
  assert.equal(handle.lost, device.lost);
  assert.equal(handle.limits.minUniformBufferOffsetAlignment, 256);
  assert.equal(sharedGpuDevice(handle), device);
  assert.equal(sharedGpuDevice(device), device);
  // Methods, even detached, run on the device.
  const { createBuffer, addEventListener } = handle;
  assert.doesNotThrow(() => createBuffer({ size: 4, usage: 0 }));
  let heard = 0;
  addEventListener('uncapturederror', () => heard++);
  device.raise('[Buffer] is destroyed');
  assert.equal(heard, 1);
});

test('every object a session creates names it, views included; the device names none', () => {
  const device = fakeDevice();
  const { device: handle, tag } = claimGpuDevice(device, owner());
  const texture = handle.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0, label: 'hdr' });
  assert.equal(texture.label, `hdr ${tag}`);
  assert.equal(untaggedLabel(texture.label), 'hdr');
  assert.equal(texture.createView().label, tag);
  assert.equal(texture.createView({ label: 'level 1' }).label, `level 1 ${tag}`);
  assert.equal(handle.createQuerySet({ type: 'timestamp', count: 2 }).label, tag);
  assert.equal(handle.createCommandEncoder().label, tag);
  assert.equal(handle.createBindGroupLayout({ entries: [] }).label, tag);
  assert.equal(device.createBuffer({ size: 4, usage: 0, label: 'raw' }).label, 'raw');
});

test('what the device keeps for every session is created on it, untagged', () => {
  installGpuGlobals();
  const device = fakeDevice();
  const created: string[] = [];
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    created.push(descriptor.label ?? '');
    return createBuffer(descriptor);
  };
  const { device: handle } = claimGpuDevice(device, owner());
  const texture = handle.createTexture({
    size: [4, 4],
    format: 'rgba8unorm',
    usage: 0,
    mipLevelCount: 3,
  });
  generateMaterialMips(handle, texture, 'rgba8unorm', 4, 4);
  assert.deepEqual(created, ['Trillion3D texture mips uniforms']);
});

test('the ledger counts by the label as the engine wrote it', () => {
  const device = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  const { device: handle } = claimGpuDevice(device, owner());
  handle.createBuffer({ size: 8, usage: 0, label: 'page table' });
  handle.createQuerySet({ type: 'timestamp', count: 2 });
  assert.deepEqual(Object.keys(ledger.snapshot().byLabel), ['page table']);
});

test('a member replaced on the device after the claim is what the handle calls', () => {
  const device = fakeDevice();
  const { device: handle, tag } = claimGpuDevice(device, owner());
  const before = handle.createBuffer;
  assert.equal(handle.createBuffer, before, 'bound once per key');
  // The allocation ledger, installed after the session's claim, still counts its creations.
  const ledger = installGpuDeviceLedger(device);
  assert.notEqual(handle.createBuffer, before);
  handle.createBuffer({ size: 16, usage: 0, label: 'late' });
  assert.deepEqual(ledger.snapshot().byLabel, { late: 16 });
  assert.equal(installGpuDeviceLedger(handle), ledger, 'one ledger per device');
  // What the handle does not create, the canvas's views, takes the tag by name.
  assert.equal(sessionLabel(handle, 'canvas'), `canvas ${tag}`);
  assert.equal(sessionLabel(device, 'canvas'), 'canvas');
});

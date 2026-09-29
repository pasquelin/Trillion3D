import { submitColorCopy } from '../../webgpu/pages/render/encoder.ts';
import { settledRt } from '../../webgpu/frame/hold.fixture.ts';
import { deviceAnswer } from '../../webgpu/frame/deviceAnswer.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuDeviceLedger } from './deviceLedger.ts';
import { namesNoSession, sessionHandle } from './sessionHandle.ts';
import { deviceMade, validationScope } from './errorScope.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('buffers and every texture mip are admitted before device creation against the live total', () => {
  const gpu = fakeDevice();
  let ceiling = 128;
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling });
  const previous = gpu.device.createBuffer({ size: 64, usage: 0 });
  assert.throws(() => gpu.device.createBuffer({ size: 65, usage: 0 }), /GPU_BUDGET_EXCEEDED/);
  assert.equal(gpu.buffers.length, 1);
  assert.throws(
    () =>
      gpu.device.createTexture({ size: [4, 4], format: 'rgba8unorm', mipLevelCount: 2, usage: 0 }),
    /GPU_BUDGET_EXCEEDED/,
  );
  assert.equal(gpu.textures.length, 0);
  ceiling = 144;
  const texture = gpu.device.createTexture({
    size: [4, 4],
    format: 'rgba8unorm',
    mipLevelCount: 2,
    usage: 0,
  });
  assert.equal(ledger.bytes, 144);
  texture.destroy();
  assert.equal(ledger.bytes, 64);
  assert.equal(gpu.destroyed.includes(previous), false);
});

test('shared caches and two view targets count once; another session has its own share', async () => {
  const gpu = fakeDevice();
  const base = installGpuDeviceLedger(gpu.device, { counts: namesNoSession });
  const a = sessionHandle(gpu.device, '@t3d:1');
  const b = sessionHandle(gpu.device, '@t3d:2');
  const first = installGpuDeviceLedger(a.device, { base, limit: () => 128 });
  const second = installGpuDeviceLedger(b.device, { base, limit: () => 256 });
  a.device.createBuffer({ label: 'main view', size: 48, usage: 0 });
  a.device.createBuffer({ label: 'capture view', size: 48, usage: 0 });
  b.device.createBuffer({ label: 'other world', size: 128, usage: 0 });
  gpu.device.createBuffer({ label: 'shared cache', size: 32, usage: 0 });
  assert.deepEqual([first.bytes, second.bytes, base.bytes], [128, 160, 32]);
  const count = gpu.buffers.length;
  assert.throws(() => gpu.device.createBuffer({ size: 4, usage: 0 }), /GPU_BUDGET_EXCEEDED/);
  assert.equal(
    gpu.buffers.length,
    count,
    'a shared allocation observes every active owning budget',
  );
  const rt = settledRt();
  rt.gpu.device = b.device;
  await assert.rejects(
    deviceAnswer(rt)!,
    /GPU_BUDGET_EXCEEDED/,
    'the requesting world also cannot omit the shared cache',
  );
  first.releaseAdmission();
  a.release();
  gpu.device.createBuffer({ size: 4, usage: 0 });
  assert.equal(second.bytes, 164, 'a released session cannot constrain later shared allocations');
  second.releaseAdmission();
  b.release();
});

test('a compound allocation refusal releases only its new resources and preserves the previous image', async () => {
  const gpu = fakeDevice();
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => 128 });
  const previous = gpu.device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
  await assert.rejects(
    deviceMade(gpu.device, () => {
      gpu.device.createBuffer({ size: 32, usage: 0 });
      gpu.device.createBuffer({ size: 64, usage: 0 });
      return { destroy() {} };
    }),
    /GPU_BUDGET_EXCEEDED/,
  );
  assert.equal(gpu.buffers.length, 1, 'the rejected second buffer never reaches the device');
  assert.equal(ledger.bytes, 64, 'partial construction was rolled back');
  assert.equal(gpu.destroyed.includes(previous), false);
  assert.equal(gpu.destroyed.includes(gpu.buffers[0]), true);
  await validationScope(gpu.device, () => gpu.device.createBuffer({ size: 64, usage: 0 }));
  assert.equal(ledger.bytes, 128, 'a subsequent valid construction still succeeds');
});

test('an admission refusal prevents an already encoded incomplete image from being submitted', () => {
  const gpu = fakeDevice();
  installGpuDeviceLedger(gpu.device, { limit: () => 1 });
  assert.throws(() => gpu.device.createBuffer({ size: 4, usage: 0 }), /GPU_BUDGET_EXCEEDED/);
  const rt = settledRt();
  rt.gpu.device = gpu.device;
  let finishes = 0,
    submits = 0;
  gpu.device.queue.submit = () => {
    submits++;
  };
  const encoder = {
    finish() {
      finishes++;
      return {};
    },
  } as GPUCommandEncoder;
  assert.throws(() => submitColorCopy(rt, gpu.device, encoder, 4, 4), /GPU_BUDGET_EXCEEDED/);
  assert.deepEqual([finishes, submits, rt.run.imageRevision], [0, 0, 0]);
});

test('an unknown shared texture format cannot bypass a live session admission', () => {
  const gpu = fakeDevice();
  const base = installGpuDeviceLedger(gpu.device, { counts: namesNoSession });
  const handle = sessionHandle(gpu.device, '@t3d:3');
  const ledger = installGpuDeviceLedger(handle.device, { base, limit: () => 128 });
  assert.throws(
    () => gpu.device.createTexture({ size: [1, 1], format: 'r8snorm', usage: 0 }),
    /GPU_BUDGET/,
  );
  assert.equal(gpu.textures.length, 0);
  assert.ok(ledger.refusal);
  ledger.releaseAdmission();
  handle.release();
  assert.equal(base.refusal, undefined, 'released admissions cannot poison the next session');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice, untaggedLabel } from './deviceOwners.ts';
import { installGpuDeviceLedger } from './deviceLedger.ts';

/** A device that hands back its descriptors and raises the errors the test writes. */
function fakeDevice() {
  const events = new EventTarget();
  let lose!: (info: GPUDeviceLostInfo) => void;
  const device = {
    createBuffer: (descriptor: GPUBufferDescriptor) =>
      ({ ...descriptor, destroy() {} }) as unknown as GPUBuffer,
    createTexture: (descriptor: GPUTextureDescriptor) =>
      ({ ...descriptor, destroy() {} }) as unknown as GPUTexture,
    createQuerySet: (descriptor: GPUQuerySetDescriptor) =>
      ({ ...descriptor, destroy() {} }) as unknown as GPUQuerySet,
    lost: new Promise<GPUDeviceLostInfo>((resolve) => (lose = resolve)),
    addEventListener: events.addEventListener.bind(events) as GPUDevice['addEventListener'],
  };
  const raise = (message: string) =>
    events.dispatchEvent(Object.assign(new Event('uncapturederror'), { error: { message } }));
  return { device, raise, lose };
}

/** An owner that records what reaches it. */
function owner() {
  const errors: string[] = [],
    losses: string[] = [];
  return {
    errors,
    losses,
    error: (message: string) => errors.push(message),
    lost: (info: { reason: string }) => losses.push(info.reason),
  };
}

// As Dawn writes it: the object at fault by its type and its label, in quotes.
const destroyed = (label: string) =>
  `[Buffer "${label}"] is destroyed.\n - While calling [Buffer "${label}"].MapAsync(MapMode::Read, 0, 64).`;

test('an error belongs to the session whose object it names, whenever it arrives', (t) => {
  const debug = t.mock.method(console, 'debug', () => {});
  const { device, raise } = fakeDevice();
  const first = owner();
  const firstClaim = claimGpuDevice(device, first);
  const old = device.createBuffer({ size: 4, usage: 0, label: 'DAG readback' }).label;
  assert.equal(old, `DAG readback ${firstClaim.tag}`);
  assert.equal(untaggedLabel(old), 'DAG readback');
  firstClaim.release();
  // Between the sessions, then while the next opens, then long after: always the closed one's.
  raise(destroyed(old));
  const second = owner();
  const secondClaim = claimGpuDevice(device, second);
  raise(destroyed(old));
  const mine = device.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0 }).label;
  assert.equal(mine, secondClaim.tag);
  raise(destroyed(old));
  assert.deepEqual([first.errors, second.errors], [[], []]);
  assert.equal(debug.mock.callCount(), 3, 'each one traced');
  // One of its own objects, or one no tag names: the live session's, as before.
  raise(`[TextureView of Texture "${mine}"] is invalid`);
  raise('[Buffer] is destroyed');
  assert.equal(second.errors.length, 2);
  assert.deepEqual(first.errors, []);
});

test('a loss reaches the live claims only: a released one is no longer held', async () => {
  const { device, lose } = fakeDevice();
  const closed = owner(),
    live = owner();
  claimGpuDevice(device, closed).release();
  claimGpuDevice(device, live);
  lose({ reason: 'destroyed', message: 'gone' } as GPUDeviceLostInfo);
  await Promise.resolve();
  assert.deepEqual([closed.losses, live.losses], [[], ['destroyed']]);
});

test('the ledger installed after the claim keeps the labels as written', () => {
  const { device } = fakeDevice();
  claimGpuDevice(device, owner());
  const ledger = installGpuDeviceLedger(device);
  device.createBuffer({ size: 8, usage: 0, label: 'page table' });
  device.createQuerySet({ type: 'timestamp', count: 2 });
  assert.deepEqual(Object.keys(ledger.snapshot().byLabel), ['page table']);
});
